import { normaliseDescription, parseEraSide, parseSide } from './normalise';
import { POSITION_TOKENS } from './synonyms';
import type { QuoteMapping, Side } from '@/types/quoteMapping';

/**
 * Suggests ASA CAPS part numbers for the lines of a new PartsCheck quote
 * from previously captured quoteMappings. Pure: the caller supplies the
 * mappings (background worker, from IndexedDB).
 *
 * A stored mapping is a candidate for a line when
 *  - its repairer wording matches (identical normalised words, or close
 *    enough — see SIMILAR_THRESHOLD — with the same position words),
 *  - the side fits (see sideFits), and
 *  - it was used on the same vehicle, model code, VIN pattern or model.
 * NA rows and rows flagged as an ERA ordering slip are never suggested.
 */

/** Ranking tiers, best first. */
export type MatchTier = 'vin' | 'modelCode' | 'vinPattern' | 'model';
const TIER_ORDER: readonly MatchTier[] = ['vin', 'modelCode', 'vinPattern', 'model'];

/** Minimum word-set overlap (Jaccard) for a "similar wording" match. */
const SIMILAR_THRESHOLD = 0.75;
const DEFAULT_LIMIT = 3;

export interface SuggestionVehicle {
  vin?: string;
  model?: string;
  /** From the ASA CAPS catalogue by VIN, if known. */
  modelCode?: string;
}

export interface SuggestionLine {
  /** PartsCheck draft item id of the requested line. */
  id: string;
  description: string;
}

export interface PartSuggestion {
  partNumber: string;
  eraDescription?: string;
  tier: MatchTier;
  /** 1 = same words as a previous request; lower = similar wording. */
  wordingScore: number;
  /** Earlier repairer wording this part answered, when not identical to this line. */
  similarWording?: string;
  /** Distinct vehicles (by VIN, else quote) in the winning tier. */
  vehicleCount: number;
  /** Times this part answered matching wording, across all tiers. */
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

interface SuggestOptions {
  /** Mappings from this quote are ignored (a reopened quote shouldn't suggest itself). */
  excludeQuoteKey?: string;
  limit?: number;
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

/** LH/RH when the part itself is handed; NONE when it fits either side. */
function partSide(mapping: QuoteMapping): Side {
  // The ERA description is the authority on whether the part is handed:
  // repairers write "L/H/F HUB BEARING" for a part ERA lists as unsided.
  if (mapping.eraDescription) return parseEraSide(mapping.eraDescription);
  return mapping.side;
}

/**
 * Handed parts must match the line's side; a line that names both sides
 * accepts either hand. Unhanded parts fit any line. A handed part is never
 * suggested for a line with no side, since the wrong hand is a wrong part.
 */
function sideFits(lineSide: Side, mapping: QuoteMapping): boolean {
  const side = partSide(mapping);
  if (side === 'NONE') return true;
  if (side === 'BOTH') return lineSide === 'BOTH';
  return lineSide === side || lineSide === 'BOTH';
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** VIN up to the check digit (WMI + vehicle descriptor section). */
function vinPattern(vin: string | undefined): string | undefined {
  return vin && vin.length === 17 ? vin.slice(0, 8).toUpperCase() : undefined;
}

function tierFor(vehicle: SuggestionVehicle, mapping: QuoteMapping): MatchTier | null {
  if (sameText(vehicle.vin, mapping.vin)) return 'vin';
  if (sameText(vehicle.modelCode, mapping.modelCode)) return 'modelCode';
  const pattern = vinPattern(vehicle.vin);
  if (pattern && pattern === vinPattern(mapping.vin)) return 'vinPattern';
  if (sameText(vehicle.model, mapping.model)) return 'model';
  return null;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function describeEvidence(
  tier: MatchTier,
  vehicleCount: number,
  timesUsed: number,
  lastSeen: string,
  winning: QuoteMapping[],
): string {
  const last = `last ${day(lastSeen)}`;
  const model = winning.find((m) => m.model)?.model ?? '';
  switch (tier) {
    case 'vin':
      return `used on this vehicle (${plural(timesUsed, 'time')}), ${last}`;
    case 'modelCode':
      return `used on ${plural(vehicleCount, 'vehicle')} · ${winning[0].modelCode} ${model}, ${last}`.trim();
    case 'vinPattern':
      return `used on ${plural(vehicleCount, 'vehicle')} with this VIN pattern · ${model}, ${last}`;
    case 'model':
      return `used on ${plural(vehicleCount, 'vehicle')} · ${model}, ${last}`;
  }
}

export function suggestForLines(
  vehicle: SuggestionVehicle,
  lines: SuggestionLine[],
  mappings: QuoteMapping[],
  options: SuggestOptions = {},
): LineSuggestions[] {
  const usable = mappings.filter(
    (m) => !m.noGenuinePart && !m.sideConflict && m.quoteKey !== options.excludeQuoteKey,
  );
  const usableWords = usable.map((m) => wordSet(m.repairerNormalised));

  return lines.map((line) => {
    const side = parseSide(line.description);
    const normalised = normaliseDescription(line.description);
    const lineWords = wordSet(normalised);

    const byPart = new Map<string, { mapping: QuoteMapping; tier: MatchTier; score: number }[]>();
    usable.forEach((mapping, i) => {
      const score = wordingScore(lineWords, usableWords[i]);
      if (score < SIMILAR_THRESHOLD) return;
      if (!sideFits(side, mapping)) return;
      const tier = tierFor(vehicle, mapping);
      if (!tier) return;
      const hits = byPart.get(mapping.partNumber) ?? [];
      hits.push({ mapping, tier, score });
      byPart.set(mapping.partNumber, hits);
    });

    const suggestions: PartSuggestion[] = Array.from(byPart, ([partNumber, hits]) => {
      const tier = TIER_ORDER.find((t) => hits.some((hit) => hit.tier === t))!;
      const winning = hits.filter((hit) => hit.tier === tier).map((hit) => hit.mapping);
      const vehicleCount = new Set(winning.map((m) => m.vin ?? m.quoteKey)).size;
      const best = hits.reduce((a, b) => (b.score > a.score ? b : a));
      const latest = hits.reduce((a, b) =>
        b.mapping.lastSeen > a.mapping.lastSeen ? b : a,
      ).mapping;
      return {
        partNumber,
        eraDescription: latest.eraDescription,
        tier,
        wordingScore: best.score,
        similarWording: best.score < 1 ? best.mapping.repairerDescription : undefined,
        vehicleCount,
        timesUsed: hits.length,
        lastSeen: latest.lastSeen,
        isAccessory: latest.isAccessory,
        evidence: describeEvidence(tier, vehicleCount, hits.length, latest.lastSeen, winning),
      };
    });

    suggestions.sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
        b.wordingScore - a.wordingScore ||
        b.vehicleCount - a.vehicleCount ||
        b.timesUsed - a.timesUsed ||
        b.lastSeen.localeCompare(a.lastSeen),
    );

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
