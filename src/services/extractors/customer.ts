import { collapseWhitespace, findQuoteFieldContent } from './dom';

/**
 * The "Purchaser" field is a single quoteTitleContent block with company,
 * address, and phone on separate lines joined by <br>, e.g.:
 *
 *   Corporate Autobody P/L<br>241 Settlement Rd<br>Thomastown, VIC<br>Ph: 03 9464 1522
 *
 * There's no separate markup per piece, so this splits the block once and
 * every field extractor below reads from the same parse rather than
 * re-splitting the same string three times. PartsCheck's supplier-facing
 * RFQ view doesn't expose a contact name or email anywhere on the page —
 * only company, address, and phone are available here.
 */
function parsePurchaserBlock(root: ParentNode): { company?: string; address?: string; phone?: string } {
  const content = findQuoteFieldContent('Purchaser', root);
  if (!content) return {};

  // Walk child nodes instead of regex-splitting innerHTML: text nodes'
  // .textContent is already HTML-entity-decoded by the browser (so "J&amp;M"
  // reads as "J&M"), whereas stripping tags out of the raw HTML string with
  // a regex leaves entities encoded — which broke exact customer matching
  // for names containing "&". Splitting on actual <br> elements still
  // preserves the line boundaries the regex approach was there for.
  const lines: string[] = [];
  let current = '';
  for (const node of Array.from(content.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') {
      lines.push(collapseWhitespace(current));
      current = '';
    } else {
      current += node.textContent ?? '';
    }
  }
  lines.push(collapseWhitespace(current));

  const nonEmptyLines = lines.filter((line) => line.length > 0);
  if (nonEmptyLines.length === 0) return {};

  const [company, ...rest] = nonEmptyLines;
  const phoneLineIndex = rest.findIndex((line) => /^ph:?\s*/i.test(line));
  const phone = phoneLineIndex >= 0 ? rest[phoneLineIndex].replace(/^ph:?\s*/i, '').trim() : undefined;
  const addressLines = phoneLineIndex >= 0 ? rest.filter((_, idx) => idx !== phoneLineIndex) : rest;
  const address = addressLines.length > 0 ? addressLines.join(', ') : undefined;

  return { company, address, phone };
}

export function extractCustomerCompany(root: ParentNode = document): string | undefined {
  return parsePurchaserBlock(root).company;
}

export function extractCustomerAddress(root: ParentNode = document): string | undefined {
  return parsePurchaserBlock(root).address;
}

export function extractCustomerPhone(root: ParentNode = document): string | undefined {
  return parsePurchaserBlock(root).phone;
}
