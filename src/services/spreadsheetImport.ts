import * as XLSX from 'xlsx';
import type { CustomerRecord } from '@/types/customer';

export type SpreadsheetImportErrorReason = 'unreadable' | 'missing-columns' | 'empty';

export class SpreadsheetImportError extends Error {
  readonly reason: SpreadsheetImportErrorReason;

  constructor(reason: SpreadsheetImportErrorReason, message: string) {
    super(message);
    this.name = 'SpreadsheetImportError';
    this.reason = reason;
  }
}

/**
 * The customer spreadsheet has exactly 3 columns, in order: Customer #,
 * Name, Address. Read positionally (not by header name) since the spec
 * guarantees column order but not exact header text — but not every source
 * file has a header row at all. Whether to skip row 0 is decided by
 * rowLooksLikeHeader() rather than assumed unconditionally.
 */
export async function parseCustomerSpreadsheet(file: File): Promise<CustomerRecord[]> {
  let workbook: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: 'array' });
  } catch {
    throw new SpreadsheetImportError(
      'unreadable',
      "This file couldn't be read. Make sure it's a valid .xlsx, .xls, or .csv file.",
    );
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new SpreadsheetImportError('unreadable', 'This spreadsheet has no sheets.');
  }

  // sheet_to_json trusts the worksheet's declared !ref range by default.
  // Some non-Excel tools (older LibreOffice/Google Sheets exports, CSV→XLSX
  // converters, etc.) write a stale !ref that doesn't cover all the actual
  // data — e.g. one that only spans the header row, which silently produces
  // exactly one row of output even though hundreds of populated rows sit
  // right there in the sheet. Recomputing the range from the real cell
  // addresses present in the sheet, instead of trusting !ref, avoids that.
  const actualRange = computeActualRange(sheet);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    ...(actualRange ? { range: actualRange } : {}),
  });

  if (rows.length === 0) {
    throw new SpreadsheetImportError('empty', 'This spreadsheet is empty.');
  }

  const headerColumnCount = rows[0]?.length ?? 0;
  if (headerColumnCount < 3) {
    throw new SpreadsheetImportError(
      'missing-columns',
      `Expected 3 columns (Customer #, Name, Address) but found ${headerColumnCount}.`,
    );
  }

  // A header label's first cell ("Customer #", "Account No", "ID") is text;
  // a real customer number is (at least starts with) a digit. Some source
  // spreadsheets have no header row at all — data starts at row 1 — and
  // unconditionally skipping row 0 was silently discarding that first
  // customer. Only skip it when it actually looks like a label, not data.
  const dataRows = rowLooksLikeHeader(rows[0]) ? rows.slice(1) : rows;
  if (dataRows.length === 0) {
    throw new SpreadsheetImportError('empty', 'This spreadsheet has a header row but no customer data.');
  }

  const records: CustomerRecord[] = [];
  for (const row of dataRows) {
    const customerNumber = normalizeCell(row[0]);
    const name = normalizeCell(row[1]);
    const address = normalizeCell(row[2]);
    if (!customerNumber || !name) continue;
    records.push({ customerNumber, name, address: address ?? '' });
  }

  if (records.length === 0) {
    throw new SpreadsheetImportError(
      'empty',
      'No valid customer rows found — every row was missing a Customer # or Name.',
    );
  }

  return records;
}

function rowLooksLikeHeader(row: unknown[] | undefined): boolean {
  const firstCell = row?.[0];
  if (firstCell === undefined || firstCell === null) return true;
  const text = String(firstCell).trim();
  return text.length === 0 || !/^\d/.test(text);
}

function normalizeCell(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function computeActualRange(sheet: XLSX.WorkSheet): XLSX.Range | null {
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;

  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
  }

  if (maxRow < 0) return null;
  return { s: { r: minRow, c: minCol }, e: { r: maxRow, c: maxCol } };
}
