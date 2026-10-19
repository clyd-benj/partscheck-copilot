import { collapseWhitespace } from './dom';
import type { RequestedPart } from '@/types/rfq';

/**
 * Each requested part is a `tr.lineRow` carrying the part description in its
 * own `data-parttext` attribute (separate from the visible, truncated
 * `<span title="...">` text in the cell) and a stable `data-draft_item_id`.
 * Rows the interpreter has already removed client-side (onclick_deleteRow)
 * are hidden via inline `display:none` rather than removed from the DOM, so
 * those are filtered out here too.
 */
export function extractRequestedParts(root: ParentNode = document): RequestedPart[] {
  const rows = root.querySelectorAll<HTMLTableRowElement>('tr.lineRow[data-parttext]');
  const parts: RequestedPart[] = [];

  for (const row of rows) {
    if (row.style.display === 'none') continue;

    // `data-draft_item_id` has an underscore, which HTMLElement.dataset does
    // NOT camelCase (only hyphens convert) — getAttribute avoids relying on
    // that inconsistent conversion for both attributes.
    const id = row.getAttribute('data-draft_item_id');
    const description = collapseWhitespace(row.getAttribute('data-parttext') ?? '');
    if (!id || description.length === 0) continue;

    parts.push({ id, description });
  }

  return parts;
}
