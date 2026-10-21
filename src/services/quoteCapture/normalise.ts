import {
  LEFT_TOKENS,
  LETTER_PREFIXES,
  PHRASE_SYNONYMS,
  RIGHT_TOKENS,
  SIDE_COMPOUNDS,
  TOKEN_SYNONYMS,
  UNREADABLE_TOKENS,
} from './synonyms';
import type { Side } from '@/types/quoteMapping';

const UNCLEAR = 'UNCLEAR';

export interface ParsedDescription {
  side: Side;
  /** Canonical words with the side removed, in order. */
  words: string[];
  /**
   * Side or position shorthand couldn't be read for certain (e.g. "R/LOWER
   * CONTROL ARM" — rear or right?). Such a line must not be matched.
   */
  unclear: boolean;
}

/**
 * Uppercases, expands side/position compounds and slashed shorthand, strips
 * punctuation and maps each word through TOKEN_SYNONYMS. Side words are
 * still present in `tokens`.
 */
function canonicalTokens(text: string): { tokens: string[]; unclear: boolean } {
  let upper = ` ${text.toUpperCase()} `;

  // "L/R" as a prefix is left-rear; anywhere else it may be "left and right".
  const leftRearPrefix = /^\s*L\/R\b/.test(upper);
  if (leftRearPrefix) upper = upper.replace(/^\s*L\/R\b/, ' LH REAR ');
  upper = upper.replace(/\bL\/R\b/g, ` ${UNCLEAR} `);

  for (const [pattern, replacement] of SIDE_COMPOUNDS) upper = upper.replace(pattern, replacement);
  for (const [pattern, replacement] of PHRASE_SYNONYMS) upper = upper.replace(pattern, replacement);
  for (const [pattern, replacement] of LETTER_PREFIXES) upper = upper.replace(pattern, replacement);

  let unclear = false;
  const tokens: string[] = [];
  for (const raw of upper
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')) {
    if (raw.length === 0) continue;
    if (raw === UNCLEAR || UNREADABLE_TOKENS.has(raw)) {
      unclear = true;
      continue;
    }
    tokens.push(...(TOKEN_SYNONYMS[raw] ?? raw).split(' '));
  }
  // "L/R FRONT ..." can't be left-rear: read it as unclear rather than guess.
  if (leftRearPrefix && tokens.includes('FRONT')) unclear = true;
  return { tokens, unclear };
}

function sideFromTokens(tokens: string[]): Side {
  const left = tokens.some((token) => LEFT_TOKENS.has(token));
  const right = tokens.some((token) => RIGHT_TOKENS.has(token));
  if (left && right) return 'BOTH';
  if (left) return 'LH';
  if (right) return 'RH';
  return 'NONE';
}

/** Side, side-free canonical words and whether the shorthand was readable. */
export function parseDescription(text: string): ParsedDescription {
  const { tokens, unclear } = canonicalTokens(text);
  return {
    side: sideFromTokens(tokens),
    words: tokens.filter((token) => !LEFT_TOKENS.has(token) && !RIGHT_TOKENS.has(token)),
    unclear,
  };
}

/** LH/RH/BOTH/NONE from a repairer description, e.g. "L/H/F GUARD" → LH. */
export function parseSide(text: string): Side {
  return parseDescription(text).side;
}

/**
 * Canonical form of a repairer description with the side removed (side is
 * stored separately), e.g. "L/H/F GUARD W/ARCH MOULD" → "FRONT GUARD WHEEL
 * ARCH MOULDING". Word order is kept. Unreadable shorthand is dropped (see
 * parseDescription's `unclear`).
 */
export function normaliseDescription(text: string): string {
  return parseDescription(text).words.join(' ');
}

/**
 * Side named by an ERA description. PartsCheck strips ERA's commas, so the
 * side is often glued onto the previous word ("KNUCKLELH", "STEP
 * ASSYSIDELH"); a word ending in LH/RH counts.
 */
export function parseEraSide(eraDescription: string): Side {
  const words = eraDescription.toUpperCase().split(/[^A-Z0-9]+/);
  const left = words.some((word) => word.endsWith('LH'));
  const right = words.some((word) => word.endsWith('RH'));
  if (left && right) return 'BOTH';
  if (left) return 'LH';
  if (right) return 'RH';
  return 'NONE';
}
