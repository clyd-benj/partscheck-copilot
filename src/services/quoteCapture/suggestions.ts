import { buildYear, parseAsaProductionDate, parsePartsCheckMthYr } from './buildDate';
import { normaliseDescription, parseEraSide, parseSide } from './normalise';
import { POSITION_TOKENS } from './synonyms';
import type { PartFitment, Vehicle } from '@/types/asacaps';
import type { QuoteMapping, Side } from '@/types/quoteMapping';

/**
 * Suggests ASA CAPS part numbers for the lines of a new PartsCheck quote.
 * Pure: the caller supplies the data (background worker, from IndexedDB).
 *
 * Two sources, in order:
 *  1. "from your quotes" — captured quoteMappings whose repairer wording
 *     matches the line.
 *  2. "from ASA catalogue" — only for lines source 1 has nothing for:
 *     fitments copied in ASA CAPS whose ASA description matches the line's
 *     wording through the same synonym map.
 *
 * Within a vehicle tier, suggestions closest in build date to the quoted
 * vehicle rank first (a ranking factor, never a filter).
 *
 * Either way a candidate must
 *  - match the wording (identical normalised words, or close enough — see
 *    SIMILAR_THRESHOLD — with the same position words),
 *  - fit the side (see sideFits), and
 *  - come from the same vehicle, model code, VIN pattern or model.
 * NA rows and rows flagged as an ERA ordering slip are never suggested.
 */

/** Ranking tiers, best first. */
export type MatchTier = 'vin' | 'modelCode' | 'vinPattern' | 'model';
const TIER_ORDER: readonly MatchTier[] = ['vin', 'modelCode', 'vinPattern', 'model'];

export type SuggestionSource = 'quotes' | 'catalogue';

/** Minimum word-set overlap (Jaccard) for a "similar wording" match. */
const SIMILAR_THRESHOLD = 0.75;
const DEFAULT_LIMIT = 3;

export interface SuggestionVehicle {
  vin?: string;
  model?: string;
  /** From the ASA CAPS catalogue by VIN, if known. */
  modelCode?: string;
  /** Build month of the vehicle being quoted (see buildDate.ts), if known. */
  buildMonth?: number;
}

/** The quoted vehicle as read from the PartsCheck page. */
export interface QuoteVehicle {
  vin?: string;
  model?: string;
  /** PartsCheck "Mth/Yr", e.g. "6/2022". */
  mthYr?: string;
}

export interface SuggestionLine {
  /** PartsCheck draft item id of the requested line. */
  id: string;
  description: string;
}

export interface PartSuggestion {
  partNumber: string;
  source: SuggestionSource;
  /** ERA description (quotes) or ASA description (catalogue). */
  description?: string;
  tier: MatchTier;
  /** 1 = same words; lower = similar wording. */
  wordingScore: number;
  /** Earlier repairer wording this part answered, when not identical to this line (quotes only). */
  similarWording?: string;
  /** Distinct vehicles (by VIN, else quote) in the winning tier. */
  vehicleCount: number;
  /**
   * Months between the quoted vehicle's build and the nearest build this
   * part was used on (winning tier); undefined when either side has no date.
   */
  buildGap?: number;
  /** Matching records across all tiers. */
  timesUsed: number;
  lastSeen: string;
  isAccessory: boolean;
  evidence: string;
}

export interface LineSuggestions {
  id: string;
  description: string;
  side: Side;
  suggestions: PartSuggestion[];
}

/** The ASA CAPS catalogue, as a fallback source. */
export interface CatalogueData {
  fitments: PartFitment[];
  vehicles: Vehicle[];
}

interface SuggestOptions {
  /** Mappings from this quote are ignored (a reopened quote shouldn't suggest itself). */
  excludeQuoteKey?: string;
  limit?: number;
  catalogue?: CatalogueData;
}

/** A stored record that could answer a line, from either source. */
interface Candidate {
  source: SuggestionSource;
  partNumber: string;
  words: Set<string>;
  /** Hand of the part itself: LH/RH, or NONE when it fits either side. */
  partSide: Side;
  vin?: string;
  modelCode?: string;
  model?: string;
  /** What counts as one vehicle when counting evidence. */
  vehicleKey: string;
  /** Build month of the vehicle this record came from, if known. */
  buildMonth?: number;
  /** The wording that matched (repairer text for quotes). */
  wording: string;
  description?: string;
  lastSeen: string;
  isAccessory: boolean;
}

function wordSet(normalised: string): Set<string> {
  return new Set(normalised.split(' ').filter((word) => word.length > 0));
}

function samePositions(a: Set<string>, b: Set<string>): boolean {
  for (const word of POSITION_TOKENS) if (a.has(word) !== b.has(word)) return false;
  return true;
}

/** Word-set overlap (Jaccard), or 0 when the position words differ. */
function wordingScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0 || !samePositions(a, b)) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Handed parts must match the line's side; a line that names both sides
 * accepts either hand. Unhanded parts fit any line. A handed part is never
 * suggested for a line with no side, since the wrong hand is a wrong part.
 */
function sideFits(lineSide: Side, partSide: Side): boolean {
  if (partSide === 'NONE') return true;
  if (partSide === 'BOTH') return lineSide === 'BOTH';
  return lineSide === partSide || lineSide === 'BOTH';
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** VIN up to the check digit (WMI + vehicle descriptor section). */
function vinPattern(vin: string | undefined): string | undefined {
  return vin && vin.length === 17 ? vin.slice(0, 8).toUpperCase() : undefined;
}

function tierFor(vehicle: SuggestionVehicle, candidate: Candidate): MatchTier | null {
  if (sameText(vehicle.vin, candidate.vin)) return 'vin';
  if (sameText(vehicle.modelCode, candidate.modelCode)) return 'modelCode';
  const pattern = vinPattern(vehicle.vin);
  if (pattern && pattern === vinPattern(candidate.vin)) return 'vinPattern';
  if (sameText(vehicle.model, candidate.model)) return 'model';
  return null;
}

function quoteCandidates(mappings: QuoteMapping[], excludeQuoteKey?: string): Candidate[] {
  return mappings
    .filter((m) => !m.noGenuinePart && !m.sideConflict && m.quoteKey !== excludeQuoteKey)
    .map((m): Candidate => ({
      source: 'quotes',
      partNumber: m.partNumber,
      words: wordSet(m.repairerNormalised),
      // The ERA description is the authority on whether the part is handed:
      // repairers write "L/H/F HUB BEARING" for a part ERA lists as unsided.
      partSide: m.eraDescription ? parseEraSide(m.eraDescription) : m.side,
      vin: m.vin,
      modelCode: m.modelCode,
      model: m.model,
      vehicleKey: m.vin ?? m.quoteKey,
      // Mappings captured before build months were stored still have Mth/Yr.
      buildMonth: m.buildMonth ?? parsePartsCheckMthYr(m.mthYr),
      wording: m.repairerDescription,
      description: m.eraDescription,
      lastSeen: m.lastSeen,
      isAccessory: m.isAccessory,
    }));
}

/** Fitments with an ASA description (copied in ASA CAPS); quote-only fitments have none. */
function catalogueCandidates({ fitments, vehicles }: CatalogueData): Candidate[] {
  const vehicleByVin = new Map(vehicles.map((v) => [v.vin, v]));
  return fitments
    .filter((f) => f.description && f.partNumber !== 'NA')
    .map((f): Candidate => {
      const vehicle = vehicleByVin.get(f.vin);
      return {
        source: 'catalogue',
        partNumber: f.partNumber,
        words: wordSet(normaliseDescription(f.description!)),
        partSide: parseSide(f.description!),
        vin: f.vin,
        modelCode: vehicle?.modelCode,
        model: vehicle?.model,
        vehicleKey: f.vin,
        buildMonth: parseAsaProductionDate(vehicle?.productionFrom),
        wording: f.description!,
        description: f.description,
        lastSeen: f.lastCapturedAt,
        isAccessory: f.partNumber.startsWith('MZ'),
      };
    });
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Gaps beyond this many months are flagged: possibly a facelift apart. */
const FAR_BUILD_GAP_MONTHS = 24;

/** The nearest build in `candidates` to the quoted vehicle, as a signed gap in months. */
function nearestBuild(
  vehicle: SuggestionVehicle,
  candidates: Candidate[],
): { gap: number; signed: number } | undefined {
  if (vehicle.buildMonth === undefined) return undefined;
  let nearest: { gap: number; signed: number } | undefined;
  for (const candidate of candidates) {
    if (candidate.buildMonth === undefined) continue;
    const signed = candidate.buildMonth - vehicle.buildMonth;
    if (!nearest || Math.abs(signed) < nearest.gap) nearest = { gap: Math.abs(signed), signed };
  }
  return nearest;
}

/** " built 2021–2022 (older build)" — empty when no record has a build date. */
function describeBuilds(
  candidates: Candidate[],
  nearest: { gap: number; signed: number } | undefined,
): string {
  const years = candidates
    .map((c) => c.buildMonth)
    .filter((month): month is number => month !== undefined)
    .map(buildYear);
  if (years.length === 0) return '';
  const from = Math.min(...years);
  const to = Math.max(...years);
  const range = from === to ? ` built ${from}` : ` built ${from}–${to}`;
  if (!nearest || nearest.gap <= FAR_BUILD_GAP_MONTHS) return range;
  return `${range} (${nearest.signed < 0 ? 'older' : 'newer'} build)`;
}

function describeEvidence(
  source: SuggestionSource,
  tier: MatchTier,
  vehicleCount: number,
  timesUsed: number,
  lastSeen: string,
  winning: Candidate[],
  builds: string,
): string {
  const verb = source === 'quotes' ? 'used' : 'seen in ASA CAPS';
  const last = `last ${day(lastSeen)}`;
  const model = winning.find((c) => c.model)?.model ?? '';
  switch (tier) {
    case 'vin':
      return source === 'quotes'
        ? `used on this vehicle (${plural(timesUsed, 'time')}), ${last}`
        : `seen in ASA CAPS for this vehicle, ${last}`;
    case 'modelCode':
      return `${verb} on ${plural(vehicleCount, 'vehicle')} · ${`${winning[0].modelCode} ${model}`.trim()}${builds}, ${last}`;
    case 'vinPattern':
      return `${verb} on ${plural(vehicleCount, 'vehicle')} with this VIN pattern · ${model}${builds}, ${last}`;
    case 'model':
      return `${verb} on ${plural(vehicleCount, 'vehicle')} · ${model}${builds}, ${last}`;
  }
}

function rank(
  vehicle: SuggestionVehicle,
  lineWords: Set<string>,
  lineSide: Side,
  candidates: Candidate[],
  candidateWords: Set<string>[],
): PartSuggestion[] {
  const byPart = new Map<string, { candidate: Candidate; tier: MatchTier; score: number }[]>();
  candidates.forEach((candidate, i) => {
    const score = wordingScore(lineWords, candidateWords[i]);
    if (score < SIMILAR_THRESHOLD) return;
    if (!sideFits(lineSide, candidate.partSide)) return;
    const tier = tierFor(vehicle, candidate);
    if (!tier) return;
    const hits = byPart.get(candidate.partNumber) ?? [];
    hits.push({ candidate, tier, score });
    byPart.set(candidate.partNumber, hits);
  });

  const suggestions: PartSuggestion[] = Array.from(byPart, ([partNumber, hits]) => {
    const tier = TIER_ORDER.find((t) => hits.some((hit) => hit.tier === t))!;
    const winning = hits.filter((hit) => hit.tier === tier).map((hit) => hit.candidate);
    const vehicleCount = new Set(winning.map((c) => c.vehicleKey)).size;
    const nearest = nearestBuild(vehicle, winning);
    const best = hits.reduce((a, b) => (b.score > a.score ? b : a));
    const latest = hits.reduce((a, b) =>
      b.candidate.lastSeen > a.candidate.lastSeen ? b : a,
    ).candidate;
    return {
      partNumber,
      source: latest.source,
      description: latest.description,
      tier,
      wordingScore: best.score,
      similarWording:
        best.score < 1 && latest.source === 'quotes' ? best.candidate.wording : undefined,
      vehicleCount,
      buildGap: nearest?.gap,
      timesUsed: hits.length,
      lastSeen: latest.lastSeen,
      isAccessory: latest.isAccessory,
      evidence: describeEvidence(
        latest.source,
        tier,
        vehicleCount,
        hits.length,
        latest.lastSeen,
        winning,
        describeBuilds(winning, nearest),
      ),
    };
  });

  // Build-date closeness ranks within a tier but never filters: Mth/Yr is
  // only approximate. Undated suggestions sort after dated ones.
  const gapOrder = (gap: number | undefined) => gap ?? Number.POSITIVE_INFINITY;
  return suggestions.sort(
    (a, b) =>
      TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
      gapOrder(a.buildGap) - gapOrder(b.buildGap) ||
      b.wordingScore - a.wordingScore ||
      b.vehicleCount - a.vehicleCount ||
      b.timesUsed - a.timesUsed ||
      b.lastSeen.localeCompare(a.lastSeen),
  );
}

export function suggestForLines(
  vehicle: SuggestionVehicle,
  lines: SuggestionLine[],
  mappings: QuoteMapping[],
  options: SuggestOptions = {},
): LineSuggestions[] {
  const fromQuotes = quoteCandidates(mappings, options.excludeQuoteKey);
  const fromQuotesWords = fromQuotes.map((c) => c.words);
  const fromCatalogue = options.catalogue ? catalogueCandidates(options.catalogue) : [];
  const fromCatalogueWords = fromCatalogue.map((c) => c.words);

  return lines.map((line) => {
    const side = parseSide(line.description);
    const lineWords = wordSet(normaliseDescription(line.description));

    let suggestions = rank(vehicle, lineWords, side, fromQuotes, fromQuotesWords);
    if (suggestions.length === 0) {
      suggestions = rank(vehicle, lineWords, side, fromCatalogue, fromCatalogueWords);
    }

    return {
      id: line.id,
      description: line.description,
      side,
      suggestions: suggestions.slice(0, options.limit ?? DEFAULT_LIMIT),
    };
  });
}

/**
 * Text for "copy all in order": the top suggestion per line, one per line,
 * with an empty line where there's none so positions still line up with
 * the PartsCheck lines when keying into ERA.
 */
export function copyAllText(lines: Pick<LineSuggestions, 'suggestions'>[]): string {
  return lines.map((line) => line.suggestions[0]?.partNumber ?? '').join('\n');
}
