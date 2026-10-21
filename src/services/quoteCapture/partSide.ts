import { parseSide } from './normalise';
import type { Side } from '@/types/quoteMapping';

/**
 * Which side a PART fits (as opposed to which side a repairer's line asks
 * for). A wrong side is never acceptable, so every available source is used:
 *  (a) ERA descriptions captured with the part (PartsCheck strips the commas,
 *      so the side can end up glued inside a word: "ARCHLHBLAC");
 *  (b) the sides of the repairer lines the part was captured against;
 *  (c) ASA CAPS descriptions of the part number (comma-separated, clean);
 *  (d) part-number parity — a supporting signal only.
 *
 * Results:
 *  - LH / RH: handed. Any of (a)–(c) naming a side makes the part handed.
 *  - NONE: fits either side — only when no source names a side (an ASA
 *    description without one, or the part answering both LH and RH lines,
 *    settles it).
 *  - UNKNOWN: can't tell (e.g. a side glued inside an ERA word with nothing
 *    to agree, or ERA text cut short before the side). Never offered for a
 *    handed line.
 *  - CONFLICT: sources disagree (LH vs RH). Never suggested.
 * `weak` marks a side that only parity supports, or that parity
 * contradicts: such a part can be POSSIBLE at most.
 */

export type PartHand = 'LH' | 'RH' | 'NONE' | 'UNKNOWN' | 'CONFLICT';

export interface PartSide {
  hand: PartHand;
  /** Only possible, never confirmed — and why. */
  weak?: string;
}

/** Evidence about one part number, gathered from quote mappings and ASA fitments. */
export interface PartSideEvidence {
  eraDescriptions: string[];
  /** Sides of the repairer lines the part answered (from parseSide). */
  lineSides: Side[];
  asaDescriptions: string[];
}

/**
 * PartsCheck cuts ERA descriptions short (~26–29 characters); a sideless one
 * this long may have lost its side.
 */
const ERA_MAYBE_TRUNCATED = 26;

/** Real words that contain LH/RH and must not count as a glued side. */
const FALSE_SIDE_WORDS = ['WHEELHOUSE', 'WHEELHUB', 'OVERHAUL'];

export interface EraSideReading {
  /** Side from a clean token or a word ending in LH/RH ("KNUCKLELH"). */
  clean: Side;
  /** Side found glued inside a word ("ARCHLHBLAC") — counts only if another source agrees. */
  inner: Side;
  /** No side found and the text is long enough to have been truncated. */
  maybeTruncated: boolean;
}

function toSide(left: boolean, right: boolean): Side {
  if (left && right) return 'BOTH';
  if (left) return 'LH';
  if (right) return 'RH';
  return 'NONE';
}

/** Reads the side out of a comma-stripped ERA description. */
export function readEraSide(eraDescription: string): EraSideReading {
  const words = eraDescription
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const clean = toSide(
    words.some((w) => w.endsWith('LH')),
    words.some((w) => w.endsWith('RH')),
  );
  let inner: Side = 'NONE';
  if (clean === 'NONE') {
    const stripped = words.map((w) => FALSE_SIDE_WORDS.reduce((acc, f) => acc.replace(f, ''), w));
    inner = toSide(
      stripped.some((w) => w.includes('LH')),
      stripped.some((w) => w.includes('RH')),
    );
  }
  return {
    clean,
    inner,
    maybeTruncated:
      clean === 'NONE' && inner === 'NONE' && eraDescription.trim().length >= ERA_MAYBE_TRUNCATED,
  };
}

/**
 * 8-character Mitsubishi numbers (####A###, ####AA##, optionally a 1–2
 * letter colour suffix like XA/HA) and MN/MR numbers: odd last digit usually
 * LH, even RH. Not 10-character "…P" numbers (only ~45% agreement).
 */
const PARITY_PATTERNS = [/^\d{4}(?:[A-Z]\d{3}|[A-Z]{2}\d{2})(?:[A-Z]{1,2})?$/, /^M[NR]\d{6}$/];

export function parityHand(partNumber: string): 'LH' | 'RH' | undefined {
  const pn = partNumber.toUpperCase();
  if (!PARITY_PATTERNS.some((p) => p.test(pn))) return undefined;
  const digits = pn.match(/\d+(?=[A-Z]{0,2}$)/)?.[0];
  if (!digits) return undefined;
  return Number(digits[digits.length - 1]) % 2 === 1 ? 'LH' : 'RH';
}

/** The part numbers either side of this one (n-1, n+1), same width and suffix. */
export function neighbourPartNumbers(partNumber: string): string[] {
  const match = partNumber.toUpperCase().match(/^(.*?)(\d+)([A-Z]{0,2})$/);
  if (!match || !PARITY_PATTERNS.some((p) => p.test(partNumber.toUpperCase()))) return [];
  const [, head, digits, suffix] = match;
  const n = Number(digits);
  return [n - 1, n + 1]
    .filter((v) => v >= 0 && String(v).length <= digits.length)
    .map((v) => `${head}${String(v).padStart(digits.length, '0')}${suffix}`);
}

const opposite = (hand: 'LH' | 'RH'): 'LH' | 'RH' => (hand === 'LH' ? 'RH' : 'LH');

type BaseHand = PartHand | { pending: 'inner'; hand: 'LH' | 'RH' } | { pending: 'truncated' };

/** Side from sources (a)–(c), before parity. */
function baseHand(evidence: PartSideEvidence): BaseHand {
  const eraReadings = evidence.eraDescriptions.map(readEraSide);
  const asaSides = evidence.asaDescriptions.map(parseSide);
  const lineHands = new Set(evidence.lineSides.filter((s) => s === 'LH' || s === 'RH'));

  const described = new Set<'LH' | 'RH'>();
  for (const side of [...eraReadings.map((r) => r.clean), ...asaSides]) {
    if (side === 'LH' || side === 'BOTH') described.add('LH');
    if (side === 'RH' || side === 'BOTH') described.add('RH');
  }
  if (described.size === 2) return 'CONFLICT';
  if (described.size === 1) {
    const hand = Array.from(described)[0];
    return lineHands.has(opposite(hand)) ? 'CONFLICT' : hand;
  }

  // ASA lists it without a side, or it has answered both LH and RH lines.
  if (asaSides.includes('NONE')) return 'NONE';
  if (lineHands.size === 2) return 'NONE';

  const inner = new Set(eraReadings.map((r) => r.inner).filter((s) => s === 'LH' || s === 'RH'));
  if (inner.size === 2) return 'CONFLICT';
  if (inner.size === 1) {
    const hand = Array.from(inner)[0] as 'LH' | 'RH';
    if (lineHands.has(hand)) return hand;
    if (lineHands.has(opposite(hand))) return 'CONFLICT';
    return { pending: 'inner', hand };
  }

  if (lineHands.size === 1) return Array.from(lineHands)[0];
  if (eraReadings.some((r) => r.maybeTruncated)) return { pending: 'truncated' };
  return 'NONE';
}

/**
 * Resolves every part's side. Parity (d) is applied last: it can settle a
 * glued ERA side or a truncated ERA text (weakly), and when it contradicts a
 * known side the part drops to possible — unless the part's n±1 neighbour is
 * known with the opposite side (a learned pair, e.g. 7812A512 LH /
 * 7812A513 RH), which overrides parity.
 */
export function resolvePartSides(
  evidenceByPart: ReadonlyMap<string, PartSideEvidence>,
): Map<string, PartSide> {
  const base = new Map<string, BaseHand>();
  for (const [partNumber, evidence] of evidenceByPart) base.set(partNumber, baseHand(evidence));

  const knownHand = (partNumber: string): 'LH' | 'RH' | undefined => {
    const b = base.get(partNumber);
    return b === 'LH' || b === 'RH' ? b : undefined;
  };

  const result = new Map<string, PartSide>();
  for (const [partNumber, b] of base) {
    const parity = parityHand(partNumber);
    if (b === 'LH' || b === 'RH') {
      const learnedPair = neighbourPartNumbers(partNumber).some(
        (n) => knownHand(n) === opposite(b),
      );
      result.set(
        partNumber,
        !learnedPair && parity && parity !== b
          ? { hand: b, weak: 'part-number pairing disagrees' }
          : { hand: b },
      );
    } else if (typeof b === 'object' && b.pending === 'inner') {
      result.set(partNumber, parity === b.hand ? { hand: b.hand } : { hand: 'UNKNOWN' });
    } else if (typeof b === 'object') {
      result.set(
        partNumber,
        parity ? { hand: parity, weak: 'side from part number only' } : { hand: 'UNKNOWN' },
      );
    } else {
      result.set(partNumber, { hand: b });
    }
  }
  return result;
}
