import {
  LEFT_TOKENS,
  PHRASE_SYNONYMS,
  RIGHT_TOKENS,
  SIDE_COMPOUNDS,
  TOKEN_SYNONYMS,
} from './synonyms';
import type { Side } from '@/types/quoteMapping';

/**
 * Uppercases, expands side/position compounds and slashed shorthand, strips
 * punctuation and maps each word through TOKEN_SYNONYMS. Side words are
 * still present in the result.
 */
function canonicalTokens(text: string): string[] {
  let upper = ` ${text.toUpperCase()} `;
  for (const [pattern, replacement] of SIDE_COMPOUNDS) upper = upper.replace(pattern, replacement);
  for (const [pattern, replacement] of PHRASE_SYNONYMS) upper = upper.replace(pattern, replacement);

  return upper
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0)
    .flatMap((token) => (TOKEN_SYNONYMS[token] ?? token).split(' '));
}

function sideFromTokens(tokens: string[]): Side {
  const left = tokens.some((token) => LEFT_TOKENS.has(token));
  const right = tokens.some((token) => RIGHT_TOKENS.has(token));
  if (left && right) return 'BOTH';
  if (left) return 'LH';
  if (right) return 'RH';
  return 'NONE';
}

/** LH/RH/BOTH/NONE from a repairer description, e.g. "L/H/F GUARD" → LH. */
export function parseSide(text: string): Side {
  return sideFromTokens(canonicalTokens(text));
}

/**
 * Canonical form of a repairer description with the side removed (side is
 * stored separately), e.g. "L/H/F GUARD W/ARCH MOULD" → "FRONT GUARD WHEEL
 * ARCH MOULDING". Word order is kept.
 */
export function normaliseDescription(text: string): string {
  return canonicalTokens(text)
    .filter((token) => !LEFT_TOKENS.has(token) && !RIGHT_TOKENS.has(token))
    .join(' ');
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
