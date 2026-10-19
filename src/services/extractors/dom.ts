/**
 * PartsCheck renders its RFQ detail fields as repeated
 * `<div class="quoteTitle">Label</div><div class="quoteTitleContent">Value</div>`
 * pairs (confirmed against a real `price-quote.php` export). There's no
 * per-field id or data attribute, so the label text is the only stable
 * handle — these helpers centralise that lookup so every extractor reads
 * the page the same way.
 */

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function findQuoteFieldContent(label: string, root: ParentNode = document): Element | null {
  const titleEls = root.querySelectorAll('.quoteTitle');
  for (const titleEl of titleEls) {
    if (titleEl.textContent && collapseWhitespace(titleEl.textContent) === label) {
      const content = titleEl.nextElementSibling;
      if (content?.classList.contains('quoteTitleContent')) {
        return content;
      }
    }
  }
  return null;
}

/**
 * Reads a quoteTitle/quoteTitleContent pair by label. Some fields (VIN) are
 * rendered as an `<input>` inside the content div rather than plain text, so
 * this checks for that first. Returns undefined for blank/absent fields
 * rather than an empty string, so callers can distinguish "not on this RFQ"
 * from "extracted an empty value".
 */
export function readQuoteField(label: string, root: ParentNode = document): string | undefined {
  const content = findQuoteFieldContent(label, root);
  if (!content) return undefined;

  const input = content.querySelector<HTMLInputElement>('input[type="text"]');
  const raw = input ? input.value : (content.textContent ?? '');
  const value = collapseWhitespace(raw);

  return value.length > 0 ? value : undefined;
}
