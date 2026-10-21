import { buildYear } from './buildDate';
import type { PartSuggestion } from './suggestions';
import type { Side } from '@/types/quoteMapping';

/**
 * Learning from hidden POSSIBLE suggestions.
 *
 * Only CONFIRMED suggestions are shown. POSSIBLE ones are still worked out
 * and logged per quote line (the prediction log). When that quote is
 * DMS-uploaded, each row's uploaded part number either verifies one of the
 * line's logged candidates or contradicts them. Those observations build up
 * per link — (normalised wording + side, part number, model code) — and a
 * link with enough independent verifications becomes CONFIRMED for vehicles
 * of that model code built within the verified range.
 */

/** Why a candidate was only possible, as logged. */
export type PossibleReason = 'similar wording' | 'outside build window' | 'both' | 'other';

export interface LoggedCandidate {
  partNumber: string;
  reason: PossibleReason;
  /** The suggestion's cautions at the time, verbatim. */
  cautions: string[];
}

/** The latest hidden candidates for one quote line, logged before upload. */
export interface PredictionLogEntry {
  /** `${quoteKey}::${lineId}` */
  id: string;
  quoteKey: string;
  /** PartsCheck draft item id of the line. */
  lineId: string;
  description: string;
  /** The line's wording key (see wordingKey). */
  wording: string;
  side: Side;
  vin?: string;
  modelCode?: string;
  buildMonth?: number;
  candidates: LoggedCandidate[];
  loggedAt: string;
  /** Set once the quote is DMS-uploaded: learned link ids verified / contradicted. */
  outcome?: { at: string; verified: string[]; contradicted: string[] };
}

export interface LinkObservation {
  vin: string;
  buildMonth?: number;
  quoteKey: string;
  at: string;
}

/** What uploads have shown about one (wording + side, part number, model code) link. */
export interface LearnedLink {
  id: string;
  wording: string;
  side: Side;
  partNumber: string;
  modelCode: string;
  /** One per VIN: the same vehicle uploaded twice counts once. */
  verifications: LinkObservation[];
  contradictions: LinkObservation[];
}

export type LinkStatus = 'hidden' | 'partial' | 'confirmed';

/** Verified build range is extended this many months each side. */
const RANGE_MARGIN_MONTHS = 12;

export function possibleReason(cautions: string[]): PossibleReason {
  const similar = cautions.includes('similar wording');
  const outside =
    cautions.includes('no vehicle built within 12 months') ||
    cautions.includes('build date unknown');
  if (similar && outside) return 'both';
  if (similar) return 'similar wording';
  if (outside) return 'outside build window';
  return 'other';
}

export function predictionLogId(quoteKey: string, lineId: string): string {
  return `${quoteKey}::${lineId}`;
}

/** A line's wording key: its normalised words (side removed), sorted, space-separated. */
export function wordingKey(words: readonly string[]): string {
  return Array.from(new Set(words)).sort().join(' ');
}

export function learnedLinkId(
  wording: string,
  side: Side,
  partNumber: string,
  modelCode: string,
): string {
  return [wording, side, partNumber.toUpperCase(), modelCode.toUpperCase()].join('|');
}

/**
 * The candidates to log for a line: its hidden (possible) suggestions, and
 * ones a learned link promoted (so later uploads can still contradict them).
 */
export function loggedCandidates(suggestions: PartSuggestion[]): LoggedCandidate[] {
  return suggestions
    .filter((s) => s.level === 'possible' || s.learned)
    .map((s) => {
      const cautions = s.learned?.cautions ?? s.cautions;
      return { partNumber: s.partNumber, reason: possibleReason(cautions), cautions };
    });
}

/** Adds an observation unless this VIN is already recorded in that list. */
export function withObservation(
  link: LearnedLink,
  kind: 'verifications' | 'contradictions',
  observation: LinkObservation,
): LearnedLink {
  const vin = observation.vin.toUpperCase();
  if (link[kind].some((o) => o.vin.toUpperCase() === vin)) return link;
  return { ...link, [kind]: [...link[kind], observation] };
}

/** Earliest to latest verifying build month, 12 months each side; undefined without dated verifications. */
export function verifiedRange(link: LearnedLink): { from: number; to: number } | undefined {
  const months = link.verifications
    .map((v) => v.buildMonth)
    .filter((m): m is number => m !== undefined);
  if (months.length === 0) return undefined;
  return {
    from: Math.min(...months) - RANGE_MARGIN_MONTHS,
    to: Math.max(...months) + RANGE_MARGIN_MONTHS,
  };
}

/**
 * Contradictions that count: from vehicles inside the verified range (the
 * link's model code is part of its key). Undated ones count, to be safe.
 */
function relevantContradictions(link: LearnedLink): LinkObservation[] {
  const range = verifiedRange(link);
  return link.contradictions.filter(
    (c) =>
      !range ||
      c.buildMonth === undefined ||
      (c.buildMonth >= range.from && c.buildMonth <= range.to),
  );
}

/**
 * Confirmed in principle: verified on at least two different VINs with
 * dated builds, and at least two more verifications than contradictions.
 */
export function isLinkConfirmed(link: LearnedLink): boolean {
  if (link.modelCode === '' || !verifiedRange(link)) return false;
  if (link.verifications.length < 2) return false;
  return link.verifications.length - relevantContradictions(link).length >= 2;
}

/** Status of a link for a particular vehicle: confirmed only within model code and verified range. */
export function linkStatusFor(
  link: LearnedLink,
  vehicle: { modelCode?: string; buildMonth?: number },
): LinkStatus {
  if (link.verifications.length === 0) return 'hidden';
  const range = verifiedRange(link);
  const sameCode =
    !!vehicle.modelCode && vehicle.modelCode.toUpperCase() === link.modelCode.toUpperCase();
  const inRange =
    !!range &&
    vehicle.buildMonth !== undefined &&
    vehicle.buildMonth >= range.from &&
    vehicle.buildMonth <= range.to;
  if (isLinkConfirmed(link) && sameCode && inRange) return 'confirmed';
  return 'partial';
}

export interface UploadLearning {
  /** Links that are new or changed. */
  links: LearnedLink[];
  /** Prediction log entries that now carry their outcome. */
  entries: PredictionLogEntry[];
  /** mapping id → learned link id, for rows that verified a hidden candidate. */
  verifiedMappingLinks: Map<string, string>;
}

/** An uploaded row, as compared with the prediction log. */
export interface UploadedRow {
  mappingId: string;
  /** PartsCheck draft item id: the quote line the row answers. */
  lineId: string;
  partNumber: string;
  noGenuinePart: boolean;
}

/**
 * Compares the uploaded rows of each quote line with that line's logged
 * hidden candidates. A candidate the upload chose records a verification;
 * every other logged candidate records a contradiction. Lines answered
 * only with NA prove nothing either way. Each log entry is used once (its
 * outcome is stored), so reloading an uploaded quote doesn't count again;
 * and a link counts each VIN once.
 */
export function learnFromUpload(
  rows: UploadedRow[],
  predictions: readonly PredictionLogEntry[],
  existingLinks: ReadonlyMap<string, LearnedLink>,
  now: string,
): UploadLearning {
  const links = new Map(existingLinks);
  const changed = new Set<string>();
  const entries: PredictionLogEntry[] = [];
  const verifiedMappingLinks = new Map<string, string>();

  for (const entry of predictions) {
    if (entry.outcome || entry.candidates.length === 0 || !entry.vin) continue;
    const answered = rows.filter((r) => r.lineId === entry.lineId && !r.noGenuinePart);
    if (answered.length === 0) continue;
    const observation: LinkObservation = {
      vin: entry.vin,
      buildMonth: entry.buildMonth,
      quoteKey: entry.quoteKey,
      at: now,
    };
    const modelCode = (entry.modelCode ?? '').toUpperCase();
    const verified: string[] = [];
    const contradicted: string[] = [];

    for (const candidate of entry.candidates) {
      const partNumber = candidate.partNumber.toUpperCase();
      const id = learnedLinkId(entry.wording, entry.side, partNumber, modelCode);
      const link: LearnedLink = links.get(id) ?? {
        id,
        wording: entry.wording,
        side: entry.side,
        partNumber,
        modelCode,
        verifications: [],
        contradictions: [],
      };
      const chosen = answered.find((r) => r.partNumber.toUpperCase() === partNumber);
      links.set(
        id,
        withObservation(link, chosen ? 'verifications' : 'contradictions', observation),
      );
      changed.add(id);
      if (chosen) {
        verified.push(id);
        verifiedMappingLinks.set(chosen.mappingId, id);
      } else {
        contradicted.push(id);
      }
    }
    entries.push({ ...entry, outcome: { at: now, verified, contradicted } });
  }

  return {
    links: Array.from(changed, (id) => links.get(id)!),
    entries,
    verifiedMappingLinks,
  };
}

export interface LearningSummary {
  /** Hidden suggestions an upload proved right. */
  verified: number;
  /** Of those, links now confirmed (for vehicles in their model code and range). */
  nowConfirmed: number;
  /** Hidden suggestions an upload chose against. */
  contradicted: number;
}

/** What uploads of this quote taught, from its log entries' outcomes. */
export function summariseLearning(
  entries: readonly PredictionLogEntry[],
  links: ReadonlyMap<string, LearnedLink>,
): LearningSummary {
  const verified = entries.flatMap((e) => e.outcome?.verified ?? []);
  return {
    verified: verified.length,
    nowConfirmed: new Set(
      verified.filter((id) => {
        const link = links.get(id);
        return !!link && isLinkConfirmed(link);
      }),
    ).size,
    contradicted: entries.reduce((n, e) => n + (e.outcome?.contradicted.length ?? 0), 0),
  };
}

function describeLink(link: LearnedLink): string {
  const years = link.verifications
    .map((v) => v.buildMonth)
    .filter((m): m is number => m !== undefined)
    .map(buildYear);
  const from = Math.min(...years);
  const to = Math.max(...years);
  const built = from === to ? `${from}` : `${from}–${to}`;
  const count = link.verifications.length;
  return `verified by uploads on ${count} ${link.modelCode} vehicles built ${built}`;
}

/**
 * Promotes POSSIBLE suggestions whose learned link is confirmed for this
 * vehicle (same model code, built within the verified range), in place.
 */
export function applyLearnedLinks(
  suggestions: PartSuggestion[],
  line: { wording: string; side: Side },
  vehicle: { modelCode?: string; buildMonth?: number },
  links: ReadonlyMap<string, LearnedLink>,
): void {
  if (!vehicle.modelCode) return;
  for (const suggestion of suggestions) {
    if (suggestion.level !== 'possible') continue;
    const link = links.get(
      learnedLinkId(line.wording, line.side, suggestion.partNumber, vehicle.modelCode),
    );
    if (!link || linkStatusFor(link, vehicle) !== 'confirmed') continue;
    suggestion.learned = { cautions: suggestion.cautions };
    suggestion.level = 'confirmed';
    suggestion.cautions = [];
    suggestion.evidence = describeLink(link);
  }
}
