// Part number recognition. Configurable pattern list rather than hard-coded
// examples, biased toward Mitsubishi-style part numbers seen in ASA CAPS but
// meant to be extended as more real-world formats are observed.

export const PART_NUMBER_PATTERNS: RegExp[] = [
  // e.g. 5253AN28, 5301J910, 6400A123, 6400BW040P, 7410A708XA, 6512A954XA,
  // 82821W070P — 4-5 digits, 1-2 letters, 2-4 digits, and an optional 0-2
  // letter colour/option suffix code.
  /^\d{4,5}[A-Z]{1,2}\d{2,4}[A-Z]{0,2}$/,
  /^M[RN]\d{5,7}$/, // e.g. MR123456, MN123456
  /^\d{6,8}$/, // plain numeric part numbers (6-8 digits)
  /^[A-Z]{2}\d{5,8}$/, // two-letter prefix + digits
];

const PART_LABEL = /part\s*(no\.?|number)?\s*[:-]\s*(.+)/i;
const DESCRIPTION_LABEL = /description\s*[:-]\s*(.+)/i;
// PNC = the parts diagram position code (e.g. "62070F"), distinct from the
// actual part number. content.ts embeds it as a "PNC: <code>" line when
// found in the DOM next to a clicked part-number button.
const PNC_LABEL = /^pnc\s*[:-]\s*(.+)$/i;

export interface ExtractedPart {
  partNumber: string;
  description?: string;
  pnc?: string;
}

function normalisePartNumber(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function matchesPartPattern(token: string): boolean {
  const normalised = normalisePartNumber(token);
  return PART_NUMBER_PATTERNS.some((pattern) => pattern.test(normalised));
}

/** Whether a whole value (e.g. a Part Number box on PartsCheck) has a recognised part-number shape. */
export function looksLikePartNumber(value: string): boolean {
  return value.trim() !== '' && matchesPartPattern(value);
}

function findPartToken(line: string): { partNumber: string; rest: string } | null {
  const tokens = line.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const cleaned = tokens[i].replace(/[.,;]+$/, '');
    if (matchesPartPattern(cleaned)) {
      const rest = tokens
        .filter((_, idx) => idx !== i)
        .join(' ')
        .trim();
      return { partNumber: normalisePartNumber(cleaned), rest };
    }
  }
  return null;
}

function extractPnc(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(PNC_LABEL);
    if (match) return match[1].trim().toUpperCase();
  }
  return undefined;
}

// Strips any "PNC: ..." line out before the rest of the parsing runs, so it
// never gets mistaken for the description or a part-number candidate.
function stripPncLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !PNC_LABEL.test(line.trim()))
    .join('\n');
}

/**
 * Attempt to recognise a copied part number (and, where present, its
 * description and PNC) from clipboard text. Returns null when no valid part
 * number pattern is found — descriptions alone never become a "guessed" part.
 */
export function extractPart(text: string): ExtractedPart | null {
  if (!text || typeof text !== 'string') return null;

  const pnc = extractPnc(text);
  const withoutPnc = pnc ? stripPncLines(text) : text;

  const labeledPartMatch = withoutPnc.match(PART_LABEL);
  if (labeledPartMatch) {
    const candidate = labeledPartMatch[2].trim().split(/\r?\n/)[0].trim();
    if (matchesPartPattern(candidate)) {
      const result: ExtractedPart = { partNumber: normalisePartNumber(candidate) };
      const descMatch = withoutPnc.match(DESCRIPTION_LABEL);
      if (descMatch) {
        const desc = descMatch[1].trim().split(/\r?\n/)[0].trim();
        if (desc) result.description = desc;
      }
      if (pnc) result.pnc = pnc;
      return result;
    }
  }

  const lines = withoutPnc
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return null;

  if (lines.length === 1) {
    const found = findPartToken(lines[0]);
    if (!found) return null;
    const result: ExtractedPart = { partNumber: found.partNumber };
    if (found.rest) result.description = found.rest;
    if (pnc) result.pnc = pnc;
    return result;
  }

  // Multi-line: look for a line that IS a part number (possibly with a
  // description on an adjacent line), in either order.
  for (let i = 0; i < lines.length; i++) {
    const cleaned = lines[i].replace(/[.,;]+$/, '');
    if (matchesPartPattern(cleaned)) {
      const partNumber = normalisePartNumber(cleaned);
      const descriptionLine = lines.find((_l, idx) => idx !== i);
      const result: ExtractedPart = { partNumber };
      if (descriptionLine) result.description = descriptionLine;
      if (pnc) result.pnc = pnc;
      return result;
    }
  }

  // Fall back to scanning tokens across the first couple of lines.
  for (const line of lines.slice(0, 2)) {
    const found = findPartToken(line);
    if (found) {
      const result: ExtractedPart = { partNumber: found.partNumber };
      const otherLine = lines.find((l) => l !== line);
      const description = [found.rest, otherLine].filter(Boolean).join(' ').trim();
      if (description) result.description = description;
      if (pnc) result.pnc = pnc;
      return result;
    }
  }

  return null;
}

// Matches one row of a tabular quote/order screen, e.g.:
//   "  1 5700C208    NEL ASSY,FR DOOR      1  619.10  410.40 410.40 433"
//   "  7 6512A954XA  AIR DAM,SIDE          1  519.19  306.09 306.09 433"
// Line number and part number lead the row, then a free-text description,
// then numeric quantity/price columns. The description is taken as
// everything between the part number and the first purely-numeric token
// (the quantity column), so prices/codes never leak into it.
function parseTabularRow(line: string): ExtractedPart | null {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  const startIdx = /^\d{1,3}$/.test(tokens[0]) && tokens.length > 1 ? 1 : 0;
  const candidate = tokens[startIdx]?.replace(/[.,;]+$/, '');
  if (!candidate || !matchesPartPattern(candidate)) return null;

  const descriptionTokens: string[] = [];
  for (const token of tokens.slice(startIdx + 1)) {
    if (/^[\d.,]+$/.test(token)) break; // quantity/price/code column reached
    descriptionTokens.push(token);
  }

  const result: ExtractedPart = { partNumber: normalisePartNumber(candidate) };
  const description = descriptionTokens.join(' ').trim();
  if (description) result.description = description;
  return result;
}

/**
 * Extract every part number found in a block of copied text, for bulk
 * copies from tabular screens (e.g. a multi-line order/quote list) where
 * several parts are selected and copied at once. Falls back to the
 * single-part extractPart() when no tabular rows are recognised, so a
 * plain single-part copy still works exactly as before.
 */
export function extractParts(text: string): ExtractedPart[] {
  if (!text || typeof text !== 'string') return [];

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const tabularMatches = lines
    .map(parseTabularRow)
    .filter((p): p is ExtractedPart => p !== null);

  // Only treat this as a bulk tabular copy when multiple rows matched —
  // a single matching row is ambiguous with other formats and is better
  // handled by extractPart()'s more careful single-part logic.
  if (tabularMatches.length > 1) {
    const seen = new Map<string, ExtractedPart>();
    for (const part of tabularMatches) {
      if (!seen.has(part.partNumber)) seen.set(part.partNumber, part);
    }
    return Array.from(seen.values());
  }

  const single = extractPart(text);
  return single ? [single] : [];
}
