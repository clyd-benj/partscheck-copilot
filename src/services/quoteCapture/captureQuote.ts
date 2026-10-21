import { vehicleBuildMonth } from './buildDate';
import {
  buildQuoteFitments,
  buildQuoteMappings,
  summariseCapture,
  updateRepairerSupplied,
  vehicleFromQuote,
} from './buildMappings';
import {
  suggestForLines,
  type LineSuggestions,
  type QuoteVehicle,
  type SuggestionLine,
  type SuggestionVehicle,
} from './suggestions';
import { AsaCapsDatabase } from '@/storage/asacapsDb';
import type { QuoteCaptureResult, QuoteContext, QuoteRow } from '@/types/quoteMapping';

/**
 * Background-side half of the PartsCheck quote capture: enriches the
 * DMS-uploaded (verified) rows read by the content script with the model
 * code and build month from the ASA CAPS catalogue (by VIN; build month
 * falls back to PartsCheck Mth/Yr), upserts them into
 * `quoteMappings`, and adds them to the catalogue as fitments for the VIN.
 * Rows the repairer filled in themselves only go to `repairerSupplied`.
 * Must only run in an extension-origin context (see src/storage/asacapsDb.ts).
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
    buildMonth: vehicleBuildMonth(vehicle, context.mthYr),
    now,
    existing: new Map(existing.map((mapping) => [mapping.id, mapping])),
  });
  await AsaCapsDatabase.putQuoteMappings(mappings);

  // Part numbers the repairer typed in are never answers; keep them, and
  // pair them with the verified number once this quote has been uploaded.
  const storedSupplied = await AsaCapsDatabase.listRepairerSuppliedForQuote(context.quoteKey);
  const changedSupplied = updateRepairerSupplied(
    context,
    rows,
    mappings,
    new Map(storedSupplied.map((record) => [record.id, record])),
    now,
  );
  await AsaCapsDatabase.putRepairerSupplied(changedSupplied);
  const allSupplied = new Map(storedSupplied.map((record) => [record.id, record]));
  for (const record of changedSupplied) allSupplied.set(record.id, record);

  // Feed the ASA CAPS catalogue too: each verified part becomes a fitment
  // for this VIN, and an unknown VIN gets a basic vehicle record.
  if (context.vin && mappings.length > 0) {
    const existingFitments = await AsaCapsDatabase.listFitmentsForVin(context.vin);
    const fitments = buildQuoteFitments(
      mappings,
      new Map(existingFitments.map((fitment) => [fitment.id, fitment])),
      now,
    );
    if (fitments.length > 0 && !vehicle) {
      const created = vehicleFromQuote(context, now);
      if (created) await AsaCapsDatabase.putVehicle(created);
    }
    for (const fitment of fitments) await AsaCapsDatabase.putFitment(fitment);
  }

  return summariseCapture(context, rows, mappings, Array.from(allSupplied.values()));
}

/**
 * Background-side suggestions for a quote's unfilled lines: past quote
 * mappings first, then the ASA CAPS catalogue's fitments. The vehicle's
 * model code, classification (trim) and build month come from the catalogue
 * when the VIN has been seen there; the build month falls back to the
 * quote's Mth/Yr.
 */
export async function suggestForQuote(
  vehicle: QuoteVehicle,
  lines: SuggestionLine[],
  excludeQuoteKey?: string,
): Promise<LineSuggestions[]> {
  const known = vehicle.vin ? await AsaCapsDatabase.getVehicle(vehicle.vin) : undefined;
  const query: SuggestionVehicle = {
    vin: vehicle.vin,
    model: vehicle.model,
    modelCode: known?.modelCode,
    buildMonth: vehicleBuildMonth(known, vehicle.mthYr)?.month,
    classification: known?.classification,
  };
  const [mappings, fitments, vehicles] = await Promise.all([
    AsaCapsDatabase.listQuoteMappings(),
    AsaCapsDatabase.listFitments(),
    AsaCapsDatabase.listVehicles(),
  ]);
  return suggestForLines(query, lines, mappings, {
    excludeQuoteKey,
    catalogue: { fitments, vehicles },
  });
}
