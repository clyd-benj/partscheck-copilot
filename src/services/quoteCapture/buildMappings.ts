import { normaliseDescription, parseEraSide, parseSide } from './normalise';
import { withFitmentSource, type PartFitment, type Vehicle } from '@/types/asacaps';
import { looksLikePartNumber } from '@/services/asacaps/part-parser';
import type {
  QuoteCaptureResult,
  QuoteContext,
  QuoteMapping,
  QuoteRow,
  RepairerSuppliedPart,
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

/** A part number that came from ERA via DMS Upload — the only kind that's an answer. */
export function isVerifiedRow(row: QuoteRow): boolean {
  return row.fromDmsUpload && row.partNumber !== '';
}

/** A part number the repairer typed into PartsCheck themselves. */
export function isRepairerSuppliedRow(row: QuoteRow): boolean {
  return !row.fromDmsUpload && row.partNumber !== '';
}

/**
 * One mapping per verified (DMS-uploaded) row. Empty rows and rows the
 * repairer pre-filled themselves are skipped.
 */
export function buildQuoteMappings(
  context: QuoteContext,
  rows: QuoteRow[],
  options: BuildOptions,
): QuoteMapping[] {
  return rows.filter(isVerifiedRow).map((row) => {
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
  repairerSupplied: RepairerSuppliedPart[] = [],
): QuoteCaptureResult {
  return {
    quoteKey: context.quoteKey,
    mappings: mappings.filter((m) => !m.noGenuinePart).length,
    noGenuinePart: mappings.filter((m) => m.noGenuinePart).length,
    accessories: mappings.filter((m) => m.isAccessory).length,
    sideConflicts: mappings.filter((m) => m.sideConflict),
    requestedLines: rows.filter((row) => row.iteration === 0).length,
    verifiedRows: rows.filter((row) => row.iteration === 0 && isVerifiedRow(row)).length,
    repairerSuppliedRows: rows.filter(isRepairerSuppliedRow).length,
    repairerSuppliedLinked: repairerSupplied.filter((r) => r.verifiedPartNumber !== undefined)
      .length,
  };
}

/**
 * Catalogue fitments for a captured quote's part numbers, keyed like ASA
 * CAPS fitments (`${vin}::${partNumber}`) so a part seen both ways is one
 * record. NA rows, rows that look like an ERA ordering slip and rows
 * without a VIN are skipped. The ASA description is never overwritten
 * (the ERA one goes in its own field) and timesCopied stays an ASA CAPS
 * copy count.
 */
export function buildQuoteFitments(
  mappings: QuoteMapping[],
  existing: ReadonlyMap<string, PartFitment>,
  now: string,
): PartFitment[] {
  const byId = new Map<string, PartFitment>();
  for (const mapping of mappings) {
    if (mapping.noGenuinePart || mapping.sideConflict || !mapping.vin) continue;
    const id = `${mapping.vin}::${mapping.partNumber}`;
    const previous = byId.get(id) ?? existing.get(id);
    byId.set(
      id,
      previous
        ? {
            ...previous,
            eraDescription: previous.eraDescription ?? mapping.eraDescription,
            sources: withFitmentSource(previous.sources, 'partscheck-quote'),
            lastCapturedAt: previous.lastCapturedAt > now ? previous.lastCapturedAt : now,
          }
        : {
            id,
            vin: mapping.vin,
            sessionId: 'partscheck-quote',
            partNumber: mapping.partNumber,
            eraDescription: mapping.eraDescription,
            sources: ['partscheck-quote'],
            timesCopied: 0,
            firstCapturedAt: mapping.firstSeen,
            lastCapturedAt: now,
          },
    );
  }
  return Array.from(byId.values());
}

/** A minimal catalogue vehicle for a quote VIN not yet seen in ASA CAPS. */
export function vehicleFromQuote(context: QuoteContext, now: string): Vehicle | undefined {
  if (!context.vin) return undefined;
  return {
    id: context.vin,
    vin: context.vin,
    make: context.make,
    model: context.model,
    variant: context.series,
    year: context.mthYr?.match(/(\d{4})$/)?.[1],
    rawText: '',
    firstSeen: now,
    lastSeen: now,
  };
}

/**
 * Records repairer-supplied part numbers for a quote and pairs each with the
 * verified number once the same row has been DMS-uploaded. Returns every
 * record for the quote that is new or changed:
 *  - rows the repairer pre-filled on this page are upserted (firstSeen kept);
 *  - stored records whose row now has a verified mapping get it linked.
 * A record is never removed, and a link is never undone by a later load.
 */
export function updateRepairerSupplied(
  context: QuoteContext,
  rows: QuoteRow[],
  mappings: QuoteMapping[],
  existing: ReadonlyMap<string, RepairerSuppliedPart>,
  now: string,
): RepairerSuppliedPart[] {
  const records = new Map(existing);
  const changed = new Set<string>();

  for (const row of rows.filter(isRepairerSuppliedRow)) {
    const id = quoteMappingId(context.quoteKey, row);
    const previous = records.get(id);
    records.set(id, {
      ...previous,
      id,
      quoteKey: context.quoteKey,
      draftId: context.draftId,
      reference: context.reference,
      rowNo: row.rowNo,
      iteration: row.iteration,
      draftItemId: row.draftItemId,
      repairerDescription: row.repairerDescription,
      repairerNormalised: normaliseDescription(row.repairerDescription),
      side: parseSide(row.repairerDescription),
      suppliedValue: row.partNumber,
      looksLikePartNumber: looksLikePartNumber(row.partNumber),
      vin: context.vin,
      make: context.make,
      model: context.model,
      firstSeen: previous?.firstSeen ?? now,
      lastSeen: now,
    });
    changed.add(id);
  }

  for (const mapping of mappings) {
    const record = records.get(mapping.id);
    if (!record) continue;
    if (
      record.verifiedPartNumber === mapping.partNumber &&
      record.verifiedEraDescription === mapping.eraDescription
    ) {
      continue;
    }
    records.set(mapping.id, {
      ...record,
      verifiedPartNumber: mapping.partNumber,
      verifiedEraDescription: mapping.eraDescription,
      verifiedNoGenuinePart: mapping.noGenuinePart,
      matchesVerified:
        record.suppliedValue.replace(/\s+/g, '') === mapping.partNumber.replace(/\s+/g, ''),
      linkedAt: record.linkedAt ?? now,
    });
    changed.add(mapping.id);
  }

  return Array.from(changed, (id) => records.get(id)!);
}
