// VIN detection. Confidence over cleverness: a candidate is only accepted
// when it looks like a real VIN, and when multiple candidates exist we prefer
// the one most strongly associated with a VIN-style label.

const VIN_CHARS = 'A-HJ-NPR-Z0-9'; // excludes I, O, Q (case-insensitive handled by flag)
const VIN_REGEX = new RegExp(`\\b[${VIN_CHARS}]{17}\\b`, 'gi');

const LABEL_PATTERNS: { pattern: RegExp; score: number }[] = [
  { pattern: /vehicle identification number/i, score: 5 },
  { pattern: /\bv\.?i\.?n\.?\b/i, score: 4 },
  { pattern: /\bchassis\s*(no\.?|number)?\b/i, score: 3 },
];

const RECENCY_BOOST = /\bnew\b|\bcurrent\b/i;
const RECENCY_PENALTY = /\bprevious\b|\bold\b|\bprior\b|\bformer\b/i;

export interface VinCandidate {
  vin: string;
  index: number;
  score: number;
}

function looksLikeVin(candidate: string): boolean {
  const hasLetter = /[A-Z]/i.test(candidate);
  const hasDigit = /[0-9]/.test(candidate);
  if (!hasLetter || !hasDigit) return false; // all-digit or all-letter strings are unlikely real VINs
  if (/^(.)\1+$/.test(candidate)) return false; // repeated single character
  return true;
}

/**
 * Find all valid VIN-shaped candidates in text, scored by proximity to
 * VIN-style labels (VIN, Chassis No, Vehicle Identification Number, ...).
 */
export function findVinCandidates(text: string): VinCandidate[] {
  const candidates: VinCandidate[] = [];
  let match: RegExpExecArray | null;
  VIN_REGEX.lastIndex = 0;
  while ((match = VIN_REGEX.exec(text)) !== null) {
    const raw = match[0].toUpperCase();
    if (!looksLikeVin(raw)) continue;

    // Look at the same line, and a short window before the match, for a label.
    const lineStart = text.lastIndexOf('\n', match.index) + 1;
    const lineEnd = text.indexOf('\n', match.index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const windowStart = Math.max(0, match.index - 60);
    const before = text.slice(windowStart, match.index);
    const contextForLabel = line + ' ' + before;

    let score = 0;
    for (const { pattern, score: labelScore } of LABEL_PATTERNS) {
      if (pattern.test(contextForLabel)) {
        score = Math.max(score, labelScore);
      }
    }

    const wideWindow = text.slice(Math.max(0, match.index - 80), match.index);
    if (RECENCY_BOOST.test(wideWindow)) score += 1;
    if (RECENCY_PENALTY.test(wideWindow)) score -= 1;

    candidates.push({ vin: raw, index: match.index, score });
  }
  return candidates;
}

/**
 * Extract the single most confident VIN from free text, or null if none
 * is found with sufficient confidence. Never guesses: an unlabeled, sole
 * candidate is still accepted (score 0) since it is the only valid VIN
 * shape present, but ties among multiple candidates prefer the
 * highest-scoring / most-recently-labelled one.
 */
export function extractVIN(text: string): string | null {
  if (!text || typeof text !== 'string') return null;
  const candidates = findVinCandidates(text);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.index - a.index; // prefer the later occurrence on ties (typically the "current"/"new" one)
  });

  return candidates[0].vin;
}

export function isValidVin(candidate: string): boolean {
  if (typeof candidate !== 'string') return false;
  const trimmed = candidate.trim().toUpperCase();
  if (trimmed.length !== 17) return false;
  const regex = new RegExp(`^[${VIN_CHARS}]{17}$`, 'i');
  if (!regex.test(trimmed)) return false;
  return looksLikeVin(trimmed);
}
