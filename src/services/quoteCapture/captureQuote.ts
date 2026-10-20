import { buildQuoteMappings, summariseCapture } from './buildMappings';
import {
  suggestForLines,
  type LineSuggestions,
  type SuggestionLine,
  type SuggestionVehicle,
} from './suggestions';
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

/**
 * Background-side suggestions for a quote's unfilled lines, ranked against
 * every stored mapping. The vehicle's model code comes from the ASA CAPS
 * catalogue when the VIN has been seen there.
 */
export async function suggestForQuote(
  vehicle: Omit<SuggestionVehicle, 'modelCode'>,
  lines: SuggestionLine[],
  excludeQuoteKey?: string,
): Promise<LineSuggestions[]> {
  const known = vehicle.vin ? await AsaCapsDatabase.getVehicle(vehicle.vin) : undefined;
  const mappings = await AsaCapsDatabase.listQuoteMappings();
  return suggestForLines({ ...vehicle, modelCode: known?.modelCode }, lines, mappings, {
    excludeQuoteKey,
  });
}
