import { buildQuoteMappings, summariseCapture } from './buildMappings';
import { AsaCapsDatabase } from '@/storage/asacapsDb';
import type { QuoteCaptureResult, QuoteContext, QuoteRow } from '@/types/quoteMapping';

/**
 * Background-side half of the PartsCheck quote capture: enriches the rows
 * read by the content script with the model code from the ASA CAPS
 * catalogue (by VIN) and upserts them into `quoteMappings`. Must only run
 * in an extension-origin context (see src/storage/asacapsDb.ts).
 */
export async function captureQuote(
  context: QuoteContext,
  rows: QuoteRow[],
  now: string = new Date().toISOString(),
): Promise<QuoteCaptureResult> {
  const vehicle = context.vin ? await AsaCapsDatabase.getVehicle(context.vin) : undefined;
  const existing = await AsaCapsDatabase.listQuoteMappingsForQuote(context.quoteKey);

  const mappings = buildQuoteMappings(context, rows, {
    modelCode: vehicle?.modelCode,
    now,
    existing: new Map(existing.map((mapping) => [mapping.id, mapping])),
  });
  await AsaCapsDatabase.putQuoteMappings(mappings);

  return summariseCapture(context, rows, mappings);
}
