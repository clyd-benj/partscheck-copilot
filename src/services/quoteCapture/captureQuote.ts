import {
  buildQuoteFitments,
  buildQuoteMappings,
  summariseCapture,
  vehicleFromQuote,
} from './buildMappings';
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
 * catalogue (by VIN), upserts them into `quoteMappings`, and adds the
 * quoted part numbers to the catalogue as fitments for the VIN. Must only
 * run in an extension-origin context (see src/storage/asacapsDb.ts).
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

  // Feed the ASA CAPS catalogue too: each quoted part becomes a fitment for
  // this VIN, and an unknown VIN gets a basic vehicle record.
  if (context.vin) {
    if (!vehicle) {
      const created = vehicleFromQuote(context, now);
      if (created) await AsaCapsDatabase.putVehicle(created);
    }
    const existingFitments = await AsaCapsDatabase.listFitmentsForVin(context.vin);
    const fitments = buildQuoteFitments(
      mappings,
      new Map(existingFitments.map((fitment) => [fitment.id, fitment])),
      now,
    );
    for (const fitment of fitments) await AsaCapsDatabase.putFitment(fitment);
  }

  return summariseCapture(context, rows, mappings);
}

/**
 * Background-side suggestions for a quote's unfilled lines: past quote
 * mappings first, then the ASA CAPS catalogue's fitments. The vehicle's
 * model code comes from the catalogue when the VIN has been seen there.
 */
export async function suggestForQuote(
  vehicle: Omit<SuggestionVehicle, 'modelCode'>,
  lines: SuggestionLine[],
  excludeQuoteKey?: string,
): Promise<LineSuggestions[]> {
  const known = vehicle.vin ? await AsaCapsDatabase.getVehicle(vehicle.vin) : undefined;
  const [mappings, fitments, vehicles] = await Promise.all([
    AsaCapsDatabase.listQuoteMappings(),
    AsaCapsDatabase.listFitments(),
    AsaCapsDatabase.listVehicles(),
  ]);
  return suggestForLines({ ...vehicle, modelCode: known?.modelCode }, lines, mappings, {
    excludeQuoteKey,
    catalogue: { fitments, vehicles },
  });
}
