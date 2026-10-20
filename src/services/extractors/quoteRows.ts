import { collapseWhitespace, readQuoteField } from './dom';
import type { QuoteContext, QuoteRow } from '@/types/quoteMapping';

/**
 * Reads PartsCheck's `#lineTable` part rows (confirmed against a real
 * price-quote.php save, before and after DMS Upload). Each requested line is
 * a `tr.lineRow` with `data-draft_item_id` / `data-iteration` /
 * `data-print_order` / `data-parttext`; once filled, its description cell is
 * `<b>ERA DESCRIPTION</b><br/><i>repairer description</i>` and the
 * Part Number / Qty / List / Buy inputs carry values. "Note for Purchaser"
 * lives in a sibling `tr.notesRow` with the same data attributes. The blue
 * `tr.lineRowPriceMatch` and grey `tr.compRow` rows have no `lineRow` class,
 * so they're never matched.
 *
 * Read-only: values are read from the inputs, nothing is ever written.
 */

const LOG_PREFIX = '[Parts Interpreter Toolkit]';
const loggedMissing = new Set<string>();

/** Logs a missing selector once per page, since the capture re-reads on every table change. */
function logMissing(what: string, selector: string): void {
  const key = `${what}|${selector}`;
  if (loggedMissing.has(key)) return;
  loggedMissing.add(key);
  console.warn(
    LOG_PREFIX,
    `selector not found: ${what} (${selector}) — PartsCheck markup may have changed`,
  );
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const collapsed = collapseWhitespace(value ?? '');
  return collapsed.length > 0 ? collapsed : undefined;
}

function readRowInput(row: Element, className: string, rowNo: number): string | undefined {
  const selector = `input.${className}`;
  const input = row.querySelector<HTMLInputElement>(selector);
  if (!input) {
    logMissing(`row ${rowNo} ${className} input`, selector);
    return undefined;
  }
  return input.value;
}

/** Every visible part row (filled or not) in on-page order. */
export function extractQuoteRows(root: ParentNode = document): QuoteRow[] {
  const table = root.querySelector('#lineTable');
  if (!table) {
    logMissing('quote line table', '#lineTable');
    return [];
  }

  const rowSelector = 'tr.lineRow[data-draft_item_id]';
  const rowEls = table.querySelectorAll<HTMLTableRowElement>(rowSelector);
  if (rowEls.length === 0) logMissing('quote part rows', rowSelector);

  const rows: QuoteRow[] = [];
  for (const row of rowEls) {
    // Rows deleted client-side are hidden, not removed (onclick_deleteRow).
    if (row.style.display === 'none') continue;

    // Underscored data-* names aren't camelCased by `dataset` — see parts.ts.
    const draftItemId = row.getAttribute('data-draft_item_id') ?? '';
    const iteration = parseNumber(row.getAttribute('data-iteration') ?? undefined) ?? 0;
    const printOrder = parseNumber(row.getAttribute('data-print_order') ?? undefined);
    const rowNo =
      printOrder !== undefined
        ? printOrder + 1
        : (parseNumber(row.cells[0]?.textContent ?? undefined) ?? rows.length + 1);

    const descriptionCell = Array.from(row.cells).find((cell) => cell.querySelector('b'));
    if (!descriptionCell) logMissing(`row ${rowNo} description cell`, 'td > b');
    const boldText = nonEmpty(descriptionCell?.querySelector('b')?.textContent);
    const italicText = nonEmpty(descriptionCell?.querySelector('i')?.textContent);

    const repairerDescription =
      nonEmpty(row.getAttribute('data-parttext')) ?? italicText ?? boldText ?? '';
    // Before DMS Upload the bold line *is* the repairer text; the ERA
    // description only appears once the italic repairer line is added under it.
    const eraDescription = italicText ? boldText : undefined;

    const notesSelector = `tr.notesRow[data-draft_item_id="${draftItemId}"][data-iteration="${iteration}"] input.notes`;
    const note = nonEmpty(table.querySelector<HTMLInputElement>(notesSelector)?.value);

    rows.push({
      rowNo,
      iteration,
      draftItemId,
      repairerDescription,
      eraDescription,
      partNumber: collapseWhitespace(readRowInput(row, 'partNr', rowNo) ?? '').toUpperCase(),
      qty: parseNumber(readRowInput(row, 'qty', rowNo)),
      listPrice: parseNumber(readRowInput(row, 'listprice', rowNo)),
      buyPrice: parseNumber(readRowInput(row, 'buyprice', rowNo)),
      note,
    });
  }
  return rows;
}

function readInputByName(root: ParentNode, selector: string): string | undefined {
  const input = root.querySelector<HTMLInputElement>(selector);
  if (!input) {
    logMissing('quote form field', selector);
    return undefined;
  }
  return nonEmpty(input.value);
}

/**
 * Quote-level identity and vehicle. The quote key is PartsCheck's own
 * draftID (hidden input in the quote form), falling back to the repairer's
 * Reference, which isn't guaranteed unique across repairers. Returns null
 * when neither is on the page, since rows can't be keyed without one.
 */
export function extractQuoteContext(root: ParentNode = document): QuoteContext | null {
  const draftId = readInputByName(root, 'form[name="frmSubmit"] input[name="draftID"]');
  const reference = readQuoteField('Reference', root);

  let quoteKey: string;
  if (draftId) {
    quoteKey = `draft:${draftId}`;
  } else if (reference) {
    quoteKey = `ref:${reference}`;
  } else {
    logMissing('quote identity (draftID or Reference)', 'input[name="draftID"]');
    return null;
  }

  return {
    quoteKey,
    draftId,
    reference,
    eraQuoteNo: readInputByName(root, 'input[name="supplierRefNr"]'),
    vin: readQuoteField('VIN', root)?.toUpperCase(),
    make: readQuoteField('Make', root),
    model: readQuoteField('Model', root),
    modelNr: readQuoteField('Model Nr', root),
    series: readQuoteField('Series', root),
    registration: readQuoteField('Veh Reg', root),
    mthYr: readQuoteField('Mth/Yr', root),
  };
}
