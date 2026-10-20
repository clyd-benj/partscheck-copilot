import { normaliseDescription, parseEraSide, parseSide } from './normalise';
import type {
  QuoteCaptureResult,
  QuoteContext,
  QuoteMapping,
  QuoteRow,
} from '@/types/quoteMapping';

/** ERA's placeholder line for "no genuine part supplied" (aftermarket, not listed, part of another line...). */
export function isNoGenuinePart(row: Pick<QuoteRow, 'partNumber' | 'eraDescription'>): boolean {
  return row.partNumber === 'NA' || row.eraDescription?.toUpperCase() === 'NOT APPLICABLE';
}

export function isAccessoryPartNumber(partNumber: string): boolean {
  return partNumber.startsWith('MZ');
}

export function quoteMappingId(
  quoteKey: string,
  row: Pick<QuoteRow, 'rowNo' | 'iteration'>,
): string {
  return row.iteration === 0
    ? `${quoteKey}::${row.rowNo}`
    : `${quoteKey}::${row.rowNo}.${row.iteration}`;
}

interface BuildOptions {
  /** Model code from the ASA CAPS catalogue's record for this VIN, if any. */
  modelCode?: string;
  now: string;
  /** Previously stored mappings for this quote, by id — keeps their firstSeen. */
  existing?: ReadonlyMap<string, QuoteMapping>;
}

/** One mapping per filled row; rows with no Part Number yet are skipped. */
export function buildQuoteMappings(
  context: QuoteContext,
  rows: QuoteRow[],
  options: BuildOptions,
): QuoteMapping[] {
  return rows
    .filter((row) => row.partNumber !== '')
    .map((row) => {
      const id = quoteMappingId(context.quoteKey, row);
      const side = parseSide(row.repairerDescription);
      const eraSide = row.eraDescription ? parseEraSide(row.eraDescription) : 'NONE';
      const noGenuinePart = isNoGenuinePart(row);

      return {
        id,
        quoteKey: context.quoteKey,
        draftId: context.draftId,
        reference: context.reference,
        eraQuoteNo: context.eraQuoteNo,
        rowNo: row.rowNo,
        iteration: row.iteration,
        draftItemId: row.draftItemId,
        repairerDescription: row.repairerDescription,
        repairerNormalised: normaliseDescription(row.repairerDescription),
        side,
        partNumber: row.partNumber,
        eraDescription: row.eraDescription,
        qty: row.qty,
        listPrice: row.listPrice,
        buyPrice: row.buyPrice,
        note: row.note,
        noGenuinePart,
        isAccessory: !noGenuinePart && isAccessoryPartNumber(row.partNumber),
        sideConflict:
          !noGenuinePart &&
          ((side === 'LH' && eraSide === 'RH') || (side === 'RH' && eraSide === 'LH')),
        vin: context.vin,
        make: context.make,
        model: context.model,
        series: context.series,
        modelNr: context.modelNr,
        registration: context.registration,
        mthYr: context.mthYr,
        modelCode: options.modelCode,
        firstSeen: options.existing?.get(id)?.firstSeen ?? options.now,
        lastSeen: options.now,
      };
    });
}

export function summariseCapture(
  context: QuoteContext,
  rows: QuoteRow[],
  mappings: QuoteMapping[],
): QuoteCaptureResult {
  return {
    quoteKey: context.quoteKey,
    mappings: mappings.filter((m) => !m.noGenuinePart).length,
    noGenuinePart: mappings.filter((m) => m.noGenuinePart).length,
    accessories: mappings.filter((m) => m.isAccessory).length,
    sideConflicts: mappings.filter((m) => m.sideConflict),
    requestedLines: rows.filter((row) => row.iteration === 0).length,
    filledRows: rows.filter((row) => row.iteration === 0 && row.partNumber !== '').length,
  };
}
