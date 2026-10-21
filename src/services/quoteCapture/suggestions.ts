import { buildYear, parseAsaProductionDate, parsePartsCheckMthYr } from './buildDate';
import { applyLearnedLinks, wordingKey, type LearnedLink } from './learning';
import { parseDescription } from './normalise';
import { resolvePartSides, type PartSide, type PartSideEvidence } from './partSide';
import { POSITION_TOKENS } from './synonyms';
import type { PartFitment, Vehicle } from '@/types/asacaps';
import type { QuoteMapping, Side } from '@/types/quoteMapping';

/**
 * Suggests ASA CAPS part numbers for the lines of a new PartsCheck quote.
 * Pure: the caller supplies the data (background worker, from IndexedDB).
 *
 * Goal: trustworthy enough not to double-check. Showing nothing beats
 * showing a wrong part, so every suggestion carries a confidence level:
 *
 * CONFIRMED — all of:
 *  - wording: the line's normalised words equal those of a wording already
 *    linked to the part (a past repairer line answered by it, or its ASA
 *    description), with exactly the same position words;
 *  - side: the part's own side (partSide.ts: ERA, repairer lines, ASA,
 *    part-number parity) is the line's side, or the part fits either side;
 *    a conflicting or unknown part side is never offered;
 *  - vehicle: used on this VIN; or on the same model code (ASA catalogue,
 *    or inferred from the 8-character VIN pattern when every catalogue VIN
 *    with that pattern has one model code) with build-date evidence — a
 *    vehicle built within 12 months of this one, or vehicles built both
 *    before and after it.
 * POSSIBLE — same VIN or model code, but only similar wording, no
 * build-date evidence, a side only part-number parity supports (or that
 * parity contradicts), or a line asking for both sides. Never shown and
 * never copied: logged per quote line and learned from (learning.ts). A
 * possible part whose learned link is CONFIRMED for this vehicle (verified
 * by DMS Uploads on two VINs of this model code, built within range) is
 * promoted to confirmed. Rows that verified a learned link count only
 * through it (no linked wording, no vehicle evidence), so one upload can't
 * confirm a part by the back door, nor outside the verified build range.
 * If two different part numbers would both be confirmed for one line, they
 * contradict each other and both become possible.
 * Everything else is dropped: model-name-only or VIN-pattern-only matches,
 * and lines whose side/position shorthand can't be read ("wording unclear").
 *
 * Sources: "from your quotes" (captured quote mappings) and "from ASA
 * catalogue" (fitments copied in ASA CAPS). Each part is scored per source
 * and the better level kept (quotes on a tie).
 */

export type MatchTier = 'vin' | 'modelCode';
const TIER_ORDER: readonly MatchTier[] = ['vin', 'modelCode'];

export type SuggestionSource = 'quotes' | 'catalogue';
export type ConfidenceLevel = 'confirmed' | 'possible';
const LEVEL_ORDER: readonly ConfidenceLevel[] = ['confirmed', 'possible'];

/** Minimum word-set overlap (Jaccard) for a "similar wording" (possible) match. */
const SIMILAR_THRESHOLD = 0.75;
/** A same-model-code vehicle built within this many months is date evidence. */
const NEAR_BUILD_MONTHS = 12;
/** Gaps beyond this many months are flagged in the evidence: possibly a facelift apart. */
const FAR_BUILD_GAP_MONTHS = 24;
const DEFAULT_LIMIT = 3;

export interface SuggestionVehicle {
  vin?: string;
  model?: string;
  /** From the ASA CAPS catalogue by VIN, if known (else inferred from the VIN pattern). */
  modelCode?: string;
  /** Build month of the vehicle being quoted (see buildDate.ts), if known. */
  buildMonth?: number;
  /** ASA CAPS classification (trim) of the quoted VIN, if it's in the catalogue. */
  classification?: string;
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
  level: ConfidenceLevel;
  /** Why a suggestion is only possible. Empty when confirmed. */
  cautions: string[];
  /**
   * Set when a learned link promoted this suggestion from possible: the
   * cautions it had. It's still logged, so later uploads can contradict it.
   */
  learned?: { cautions: string[] };
  /** ERA description (quotes) or ASA description (catalogue). */
  description?: string;
  tier: MatchTier;
  /** 1 = same words; lower = similar wording. */
  wordingScore: number;
  /** The linked wording this line was matched to, when not identical. */
  similarWording?: string;
  /** Distinct vehicles (by VIN, else quote) behind the tier. */
  vehicleCount: number;
  /** Months to the nearest build behind the tier; undefined without dates. */
  buildGap?: number;
  /** Of those vehicles, how many share the quoted vehicle's ASA trim. */
  sameTrimCount: number;
  /** Records behind the tier. */
  timesUsed: number;
  lastSeen: string;
  isAccessory: boolean;
  evidence: string;
}

export interface LineSuggestions {
  id: string;
  description: string;
  side: Side;
  /** The line's wording key (learning.ts wordingKey); '' when unclear. */
  wording: string;
  /** Side/position shorthand couldn't be read; no suggestions are offered. */
  wordingUnclear: boolean;
  suggestions: PartSuggestion[];
}

/**
 * The ASA CAPS catalogue: a source of fitments, and the vehicle records
 * (model code, trim, production date by VIN) for both sources.
 */
export interface CatalogueData {
  fitments: PartFitment[];
  vehicles: Vehicle[];
}

interface SuggestOptions {
  /** Mappings from this quote are ignored (a reopened quote shouldn't suggest itself). */
  excludeQuoteKey?: string;
  limit?: number;
  catalogue?: CatalogueData;
  /** Links learned from DMS Uploads of hidden suggestions (learning.ts). */
  learnedLinks?: LearnedLink[];
}

/** One vehicle a part was used on (quote mapping) or listed for (ASA fitment). */
interface PartRecord {
  source: SuggestionSource;
  partNumber: string;
  vin?: string;
  modelCode?: string;
  model?: string;
  classification?: string;
  buildMonth?: number;
  vehicleKey: string;
  description?: string;
  lastSeen: string;
  isAccessory: boolean;
}

/** A wording linked to a part: a past repairer line, or the part's ASA description. */
interface LinkedWording {
  partNumber: string;
  text: string;
  words: Set<string>;
}

interface WordingMatch {
  score: number;
  /** Set when the side only weakly fits (possible at most), with the reason. */
  sideCaution?: string;
  text: string;
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** VIN up to the check digit (WMI + vehicle descriptor section). */
function vinPattern(vin: string | undefined): string | undefined {
  return vin && vin.length === 17 ? vin.slice(0, 8).toUpperCase() : undefined;
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

/** Exact-and-confirmable beats everything; then higher score; then a fully fitting side. */
function betterWording(candidate: WordingMatch, previous: WordingMatch | undefined): boolean {
  if (!previous) return true;
  const strong = (m: WordingMatch) => m.score === 1 && !m.sideCaution;
  if (strong(candidate) !== strong(previous)) return strong(candidate);
  if (candidate.score !== previous.score) return candidate.score > previous.score;
  return !candidate.sideCaution && !!previous.sideCaution;
}

/**
 * Model code for a VIN: the catalogue's record, else inferred from the VIN
 * pattern when the catalogue's VINs with that pattern all share one code
 * (VINs without a known model code don't count either way).
 */
function modelCodeLookup(vehicles: Vehicle[]): (vin: string | undefined) => string | undefined {
  const byVin = new Map(vehicles.map((v) => [v.vin.toUpperCase(), v]));
  const codesByPattern = new Map<string, Set<string>>();
  for (const v of vehicles) {
    const pattern = vinPattern(v.vin);
    if (!pattern || !v.modelCode) continue;
    const codes = codesByPattern.get(pattern) ?? new Set<string>();
    codes.add(v.modelCode.toUpperCase());
    codesByPattern.set(pattern, codes);
  }
  return (vin) => {
    if (!vin) return undefined;
    const own = byVin.get(vin.toUpperCase())?.modelCode;
    if (own) return own;
    const codes = codesByPattern.get(vinPattern(vin) ?? '');
    return codes && codes.size === 1 ? Array.from(codes)[0] : undefined;
  };
}

/**
 * Whether the part's side (see partSide.ts) fits the line's side: never for
 * a conflicting or unknown side or the wrong hand; possible-only (with a
 * caution) for a weakly known side or a line asking for both sides.
 */
/** The quoted vehicle's model code: given, else inferred from its VIN pattern. */
export function resolveModelCode(
  vehicle: SuggestionVehicle,
  vehicles: Vehicle[],
): string | undefined {
  return vehicle.modelCode ?? modelCodeLookup(vehicles)(vehicle.vin);
}

function sideFit(lineSide: Side, part: PartSide): { caution?: string } | null {
  if (part.hand === 'CONFLICT' || part.hand === 'UNKNOWN') return null;
  if (lineSide === 'BOTH') {
    // One part number can't fully answer a line asking for both sides.
    return { caution: 'line asks for both sides' };
  }
  if (part.hand === 'NONE') return {};
  if (lineSide !== part.hand) return null;
  return part.weak ? { caution: part.weak } : {};
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function nearestBuild(
  buildMonth: number | undefined,
  records: PartRecord[],
): { gap: number; signed: number } | undefined {
  if (buildMonth === undefined) return undefined;
  let nearest: { gap: number; signed: number } | undefined;
  for (const record of records) {
    if (record.buildMonth === undefined) continue;
    const signed = record.buildMonth - buildMonth;
    if (!nearest || Math.abs(signed) < nearest.gap) nearest = { gap: Math.abs(signed), signed };
  }
  return nearest;
}

/** A vehicle built within 12 months, or builds on both sides of this one. */
function hasBuildDateEvidence(buildMonth: number | undefined, records: PartRecord[]): boolean {
  if (buildMonth === undefined) return false;
  const months = records.map((r) => r.buildMonth).filter((m): m is number => m !== undefined);
  if (months.some((m) => Math.abs(m - buildMonth) <= NEAR_BUILD_MONTHS)) return true;
  return months.some((m) => m <= buildMonth) && months.some((m) => m >= buildMonth);
}

function describeBuilds(
  records: PartRecord[],
  nearest: { gap: number; signed: number } | undefined,
): string {
  const years = records
    .map((r) => r.buildMonth)
    .filter((m): m is number => m !== undefined)
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
  vehicle: SuggestionVehicle,
  winning: PartRecord[],
  vehicleCount: number,
  sameTrimCount: number,
  nearest: { gap: number; signed: number } | undefined,
  lastSeen: string,
): string {
  const last = `last ${day(lastSeen)}`;
  if (tier === 'vin') {
    return source === 'quotes'
      ? `used on this vehicle (${plural(winning.length, 'time')}), ${last}`
      : `seen in ASA CAPS for this vehicle, ${last}`;
  }
  const verb = source === 'quotes' ? 'used' : 'seen in ASA CAPS';
  const model = winning.find((r) => r.model)?.model ?? '';
  const code = winning.find((r) => r.modelCode)?.modelCode ?? '';
  const trim = sameTrimCount > 0 ? ` (${sameTrimCount} same trim ${vehicle.classification})` : '';
  const builds = describeBuilds(winning, nearest);
  return `${verb} on ${plural(vehicleCount, 'vehicle')} · ${`${code} ${model}`.trim()}${trim}${builds}, ${last}`;
}

function scoreSource(
  source: SuggestionSource,
  partNumber: string,
  wording: WordingMatch,
  vehicle: SuggestionVehicle,
  queryModelCode: string | undefined,
  records: PartRecord[],
): PartSuggestion | undefined {
  const partRecords = records.filter((r) => r.source === source && r.partNumber === partNumber);
  const sameVin = partRecords.filter((r) => sameText(r.vin, vehicle.vin));
  const sameCode = partRecords.filter((r) => sameText(r.modelCode, queryModelCode));
  const tier: MatchTier | undefined =
    sameVin.length > 0 ? 'vin' : sameCode.length > 0 ? 'modelCode' : undefined;
  // Model-name-only and VIN-pattern-only matches are never offered.
  if (!tier) return undefined;
  const winning = tier === 'vin' ? sameVin : sameCode;

  const exact = wording.score === 1;
  const dated = tier === 'vin' || hasBuildDateEvidence(vehicle.buildMonth, sameCode);
  const cautions: string[] = [];
  if (!exact) cautions.push('similar wording');
  if (wording.sideCaution) cautions.push(wording.sideCaution);
  if (!dated) {
    cautions.push(
      vehicle.buildMonth === undefined ? 'build date unknown' : 'no vehicle built within 12 months',
    );
  }

  const nearest = nearestBuild(vehicle.buildMonth, winning);
  const vehicleCount = new Set(winning.map((r) => r.vehicleKey)).size;
  const sameTrimCount = new Set(
    winning
      .filter((r) => sameText(r.classification, vehicle.classification))
      .map((r) => r.vehicleKey),
  ).size;
  const latest = winning.reduce((a, b) => (b.lastSeen > a.lastSeen ? b : a));
  return {
    partNumber,
    source,
    level: cautions.length === 0 ? 'confirmed' : 'possible',
    cautions,
    description: latest.description,
    tier,
    wordingScore: wording.score,
    similarWording: exact ? undefined : wording.text,
    vehicleCount,
    buildGap: nearest?.gap,
    sameTrimCount,
    timesUsed: winning.length,
    lastSeen: latest.lastSeen,
    isAccessory: latest.isAccessory,
    evidence: describeEvidence(
      source,
      tier,
      vehicle,
      winning,
      vehicleCount,
      sameTrimCount,
      nearest,
      latest.lastSeen,
    ),
  };
}

export function suggestForLines(
  vehicle: SuggestionVehicle,
  lines: SuggestionLine[],
  mappings: QuoteMapping[],
  options: SuggestOptions = {},
): LineSuggestions[] {
  const vehicles = options.catalogue?.vehicles ?? [];
  const vehicleByVin = new Map(vehicles.map((v) => [v.vin.toUpperCase(), v]));
  const modelCodeFor = modelCodeLookup(vehicles);
  const queryModelCode = vehicle.modelCode ?? modelCodeFor(vehicle.vin);

  const learnedLinks = options.learnedLinks ?? [];
  const linkById = new Map(learnedLinks.map((link) => [link.id, link]));
  const answered = mappings.filter(
    (m) => !m.noGenuinePart && !m.sideConflict && m.quoteKey !== options.excludeQuoteKey,
  );
  // A row that verified a hidden suggestion counts only through its learned
  // link (confirmed for its model code and verified build range); otherwise
  // it only tells us the part's side.
  const usableMappings = answered.filter((m) => !m.learnedLinkId);
  const usableFitments = (options.catalogue?.fitments ?? []).filter(
    (f) => f.description && f.partNumber !== 'NA',
  );

  const records: PartRecord[] = [
    ...usableMappings.map((m): PartRecord => {
      const known = m.vin ? vehicleByVin.get(m.vin.toUpperCase()) : undefined;
      return {
        source: 'quotes',
        partNumber: m.partNumber,
        vin: m.vin,
        modelCode: m.modelCode ?? modelCodeFor(m.vin),
        model: m.model,
        classification: known?.classification,
        buildMonth:
          m.buildMonth ??
          parseAsaProductionDate(known?.productionFrom) ??
          parsePartsCheckMthYr(m.mthYr),
        vehicleKey: m.vin ?? m.quoteKey,
        description: m.eraDescription,
        lastSeen: m.lastSeen,
        isAccessory: m.isAccessory,
      };
    }),
    ...usableFitments.map((f): PartRecord => {
      const known = vehicleByVin.get(f.vin.toUpperCase());
      return {
        source: 'catalogue',
        partNumber: f.partNumber,
        vin: f.vin,
        modelCode: modelCodeFor(f.vin),
        model: known?.model,
        classification: known?.classification,
        buildMonth: parseAsaProductionDate(known?.productionFrom),
        vehicleKey: f.vin,
        description: f.description,
        lastSeen: f.lastCapturedAt,
        isAccessory: f.partNumber.startsWith('MZ'),
      };
    }),
  ];

  // Wordings linked to each part, re-parsed with the current rules (stored
  // normalised text may predate them). Unreadable ones are never matched.
  const wordings: LinkedWording[] = [];
  const addWording = (partNumber: string, text: string) => {
    const parsed = parseDescription(text);
    if (parsed.unclear || parsed.words.length === 0) return;
    wordings.push({ partNumber, text, words: new Set(parsed.words) });
  };
  for (const m of usableMappings) addWording(m.partNumber, m.repairerDescription);
  for (const f of usableFitments) addWording(f.partNumber, f.description!);

  // Which side each part fits, from every source (ERA, repairer lines, ASA,
  // part-number parity).
  const evidenceByPart = new Map<string, PartSideEvidence>();
  const evidenceFor = (partNumber: string): PartSideEvidence => {
    let evidence = evidenceByPart.get(partNumber);
    if (!evidence) {
      evidence = { eraDescriptions: [], lineSides: [], asaDescriptions: [] };
      evidenceByPart.set(partNumber, evidence);
    }
    return evidence;
  };
  for (const m of answered) {
    const evidence = evidenceFor(m.partNumber);
    if (m.eraDescription) evidence.eraDescriptions.push(m.eraDescription);
    const line = parseDescription(m.repairerDescription);
    if (!line.unclear) evidence.lineSides.push(line.side);
  }
  for (const f of usableFitments) evidenceFor(f.partNumber).asaDescriptions.push(f.description!);
  const partSides = resolvePartSides(evidenceByPart);

  return lines.map((line) => {
    const parsed = parseDescription(line.description);
    const base = { id: line.id, description: line.description, side: parsed.side };
    if (parsed.unclear) return { ...base, wording: '', wordingUnclear: true, suggestions: [] };
    const wording = wordingKey(parsed.words);
    const lineWords = new Set(parsed.words);

    const wordingByPart = new Map<string, WordingMatch>();
    for (const wording of wordings) {
      const score = wordingScore(lineWords, wording.words);
      if (score < SIMILAR_THRESHOLD) continue;
      const fit = sideFit(parsed.side, partSides.get(wording.partNumber)!);
      if (!fit) continue;
      const match = { score, sideCaution: fit.caution, text: wording.text };
      if (betterWording(match, wordingByPart.get(wording.partNumber))) {
        wordingByPart.set(wording.partNumber, match);
      }
    }

    const suggestions: PartSuggestion[] = [];
    for (const [partNumber, wording] of wordingByPart) {
      const fromQuotes = scoreSource(
        'quotes',
        partNumber,
        wording,
        vehicle,
        queryModelCode,
        records,
      );
      const fromCatalogue = scoreSource(
        'catalogue',
        partNumber,
        wording,
        vehicle,
        queryModelCode,
        records,
      );
      const best =
        fromQuotes &&
        (!fromCatalogue ||
          LEVEL_ORDER.indexOf(fromQuotes.level) <= LEVEL_ORDER.indexOf(fromCatalogue.level))
          ? fromQuotes
          : fromCatalogue;
      if (best) suggestions.push(best);
    }

    applyLearnedLinks(
      suggestions,
      { wording, side: parsed.side },
      { modelCode: queryModelCode, buildMonth: vehicle.buildMonth },
      linkById,
    );

    // Two different part numbers both confirmed for one line contradict each
    // other: neither is trustworthy enough to copy without checking.
    const confirmed = suggestions.filter((s) => s.level === 'confirmed');
    if (confirmed.length > 1) {
      for (const suggestion of confirmed) {
        suggestion.level = 'possible';
        suggestion.cautions.push('another part number also matches');
      }
    }

    const gapOrder = (gap: number | undefined) => gap ?? Number.POSITIVE_INFINITY;
    suggestions.sort(
      (a, b) =>
        LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) ||
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
        Number(b.sameTrimCount > 0) - Number(a.sameTrimCount > 0) ||
        gapOrder(a.buildGap) - gapOrder(b.buildGap) ||
        b.wordingScore - a.wordingScore ||
        b.vehicleCount - a.vehicleCount ||
        b.timesUsed - a.timesUsed ||
        b.lastSeen.localeCompare(a.lastSeen),
    );

    return {
      ...base,
      wording,
      wordingUnclear: false,
      suggestions: suggestions.slice(0, options.limit ?? DEFAULT_LIMIT),
    };
  });
}

/**
 * Text for "copy all in order": each line's top CONFIRMED suggestion, one
 * per line, with an empty line where there's none so positions still line
 * up with the PartsCheck lines when keying into ERA.
 */
export function copyAllText(lines: Pick<LineSuggestions, 'suggestions'>[]): string {
  return lines
    .map((line) => line.suggestions.find((s) => s.level === 'confirmed')?.partNumber ?? '')
    .join('\n');
}
