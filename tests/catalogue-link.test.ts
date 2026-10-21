// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { processClipboardText } from "@/services/asacaps/vehicle-session";
import { buildCatalogueRows, importCsv, rowsToCsv, rowsToJson } from "@/services/asacaps/catalogueExport";
import { extractQuoteContext, extractQuoteRows } from "@/services/extractors/quoteRows";
import { captureQuote, suggestForQuote } from "@/services/quoteCapture/captureQuote";
import { suggestForLines } from "@/services/quoteCapture/suggestions";
import type { PartFitment, Vehicle } from "@/types/asacaps";
import { loadQuotePage } from "./partscheckFixtures";

const NOW = "2026-10-20T03:30:00.000Z";
const QUOTE_VIN = "MMAGUKS10NH000001";

async function resetDb() {
  await AsaCapsDatabase.resetForTests();
  vi.stubGlobal("indexedDB", new IDBFactory());
}

async function captureFilledQuote(now = NOW) {
  const doc = loadQuotePage("quote-filled");
  return captureQuote(extractQuoteContext(doc)!, extractQuoteRows(doc), now);
}

function vehicle(vin: string, extra: Partial<Vehicle> = {}): Vehicle {
  return { id: vin, vin, make: "Mitsubishi", rawText: "", firstSeen: NOW, lastSeen: NOW, ...extra };
}

function asaFitment(vin: string, partNumber: string, description: string, extra: Partial<PartFitment> = {}): PartFitment {
  return {
    id: `${vin}::${partNumber}`,
    vin,
    sessionId: "s1",
    partNumber,
    description,
    sources: ["asacaps"],
    timesCopied: 1,
    firstCapturedAt: "2026-10-12T00:00:00.000Z",
    lastCapturedAt: "2026-10-12T00:00:00.000Z",
    ...extra,
  };
}

describe("captured quotes feed the ASA CAPS catalogue", () => {
  beforeEach(resetDb);

  it("adds each quoted part as a fitment for the VIN, skipping NA rows", async () => {
    await captureFilledQuote();
    const fitments = await AsaCapsDatabase.listFitmentsForVin(QUOTE_VIN);
    expect(fitments).toHaveLength(12);
    expect(fitments.some((f) => f.partNumber === "NA")).toBe(false);
    const guard = fitments.find((f) => f.partNumber === "5220AX75")!;
    expect(guard).toMatchObject({
      sessionId: "partscheck-quote",
      sources: ["partscheck-quote"],
      eraDescription: "FENDERFR LH",
      timesCopied: 0,
    });
    expect(guard.description).toBeUndefined();
  });

  it("creates a basic vehicle record for a VIN not yet in the catalogue", async () => {
    await captureFilledQuote();
    expect(await AsaCapsDatabase.getVehicle(QUOTE_VIN)).toMatchObject({
      make: "Mitsubishi",
      model: "Pajero Sport",
      variant: "QF",
      year: "2022",
    });
  });

  it("never duplicates fitments when a quote is read again", async () => {
    await captureFilledQuote();
    await captureFilledQuote("2026-10-21T00:00:00.000Z");
    expect(await AsaCapsDatabase.listFitmentsForVin(QUOTE_VIN)).toHaveLength(12);
  });

  it("merges into a part already copied in ASA CAPS without touching its ASA data", async () => {
    const asaVehicle = vehicle(QUOTE_VIN, { model: "PAJERO SPORT", modelCode: "QF1W", classification: "X" });
    await AsaCapsDatabase.putVehicle(asaVehicle);
    await AsaCapsDatabase.putFitment(asaFitment(QUOTE_VIN, "5220AX75", "FENDER,FR LH", { timesCopied: 3 }));

    await captureFilledQuote();

    expect(await AsaCapsDatabase.getVehicle(QUOTE_VIN)).toEqual(asaVehicle);
    expect(await AsaCapsDatabase.getFitment(`${QUOTE_VIN}::5220AX75`)).toMatchObject({
      description: "FENDER,FR LH",
      eraDescription: "FENDERFR LH",
      sources: ["asacaps", "partscheck-quote"],
      timesCopied: 3,
      sessionId: "s1",
    });
    expect(await AsaCapsDatabase.listFitmentsForVin(QUOTE_VIN)).toHaveLength(12);
  });

  it("tags fitments copied in ASA CAPS with their source", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    await processClipboardText("5253AN28");
    expect((await AsaCapsDatabase.listFitments())[0].sources).toEqual(["asacaps"]);
  });
});

describe("ASA catalogue as a suggestion source", () => {
  const TRITON_VIN = "MMAJYKL10PH999999";
  const vehicles = [
    vehicle(TRITON_VIN, { model: "TRITON", modelCode: "KK1T" }),
    vehicle("MMAJYKL10PH000002", { model: "TRITON", modelCode: "KK1T" }),
    vehicle("MMBXXXXXXXX000003", { model: "TRITON", modelCode: "MV1T" }),
  ];
  const query = { vin: TRITON_VIN, model: "Triton", modelCode: "KK1T" };
  const line = (description: string) => ({ id: "1", description });

  it("matches the repairer's wording to the ASA description, labelled as catalogue", () => {
    const fitments = [asaFitment(TRITON_VIN, "5716A585", "HANDLE,RR DOOR OUTSIDE,LH")];
    const [result] = suggestForLines(query, [line("L/H REAR DOOR OUTER HANDLE")], [], {
      catalogue: { fitments, vehicles },
    });
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        partNumber: "5716A585",
        source: "catalogue",
        tier: "vin",
        description: "HANDLE,RR DOOR OUTSIDE,LH",
        evidence: "seen in ASA CAPS for this vehicle, last 2026-10-12",
      }),
    ]);
  });

  it("requires the side to agree", () => {
    const fitments = [asaFitment(TRITON_VIN, "5716A585", "HANDLE,RR DOOR OUTSIDE,LH")];
    const [result] = suggestForLines(query, [line("R/H REAR DOOR OUTER HANDLE")], [], {
      catalogue: { fitments, vehicles },
    });
    expect(result.suggestions).toEqual([]);
  });

  it("offers same VIN (confirmed) and same model code (possible without a build date), never model name alone", () => {
    const fitments = [
      asaFitment("MMBXXXXXXXX000003", "MODEL", "BONNET"),
      asaFitment("MMAJYKL10PH000002", "CODE", "BONNET"),
      asaFitment(TRITON_VIN, "VIN", "BONNET"),
    ];
    const [result] = suggestForLines(query, [line("BONNET")], [], { catalogue: { fitments, vehicles } });
    expect(result.suggestions.map((s) => [s.partNumber, s.tier, s.level])).toEqual([
      ["VIN", "vin", "confirmed"],
      ["CODE", "modelCode", "possible"],
    ]);
    expect(result.suggestions[1].evidence).toBe("seen in ASA CAPS on 1 vehicle · KK1T TRITON, last 2026-10-12");
  });

  it("downgrades two different part numbers confirmed for the same line", async () => {
    await resetDb();
    await captureFilledQuote();
    await AsaCapsDatabase.putFitment(asaFitment(QUOTE_VIN, "5220AX99", "FENDER,FR LH"));
    await AsaCapsDatabase.putFitment(asaFitment(QUOTE_VIN, "5900A001", "HOOD"));

    const [guard, bonnet] = await suggestForQuote({ vin: QUOTE_VIN, model: "Pajero Sport" }, [
      { id: "a", description: "L/H/F GUARD" },
      { id: "b", description: "HOOD" },
    ]);
    expect(guard.suggestions.map((s) => [s.partNumber, s.source, s.level])).toEqual([
      ["5220AX75", "quotes", "possible"],
      ["5220AX99", "catalogue", "possible"],
    ]);
    expect(guard.suggestions[0].cautions).toEqual(["another part number also matches"]);
    expect(bonnet.suggestions.map((s) => [s.partNumber, s.source, s.level])).toEqual([
      ["5900A001", "catalogue", "confirmed"],
    ]);
  });

  it("ignores quote-only fitments (no ASA description) and NA", () => {
    const fitments = [
      { ...asaFitment(TRITON_VIN, "5220AX75", "x"), description: undefined, eraDescription: "BONNET" },
      asaFitment(TRITON_VIN, "NA", "BONNET"),
    ];
    const [result] = suggestForLines(query, [line("BONNET")], [], { catalogue: { fitments, vehicles } });
    expect(result.suggestions).toEqual([]);
  });
});

describe("CSV/JSON export and import with quote mappings", () => {
  beforeEach(resetDb);

  async function exportCsvText() {
    return rowsToCsv(await buildCatalogueRows(), await AsaCapsDatabase.listQuoteMappings());
  }

  it("round-trips fitments, sources and quote mappings", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    await processClipboardText("5253AN28\nR/H SILL PANEL OUTER");
    await captureFilledQuote();
    const before = await AsaCapsDatabase.listQuoteMappings();
    const csv = await exportCsvText();

    await resetDb();
    const result = await importCsv(csv);
    expect(result).toEqual({ vehiclesImported: 2, fitmentsImported: 13, quoteMappingsImported: 19 });

    const after = await AsaCapsDatabase.listQuoteMappings();
    const sortById = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    expect(sortById(after)).toEqual(sortById(before));

    expect(await AsaCapsDatabase.getFitment("JMFXTGF8WLJ003875::5253AN28")).toMatchObject({
      description: "R/H SILL PANEL OUTER",
      sources: ["asacaps"],
      timesCopied: 1,
    });
    expect(await AsaCapsDatabase.getFitment(`${QUOTE_VIN}::5220AX75`)).toMatchObject({
      eraDescription: "FENDERFR LH",
      sources: ["partscheck-quote"],
      timesCopied: 0,
    });
  });

  it("re-importing the same file never duplicates", async () => {
    await captureFilledQuote();
    const csv = await exportCsvText();
    await importCsv(csv);
    await importCsv(csv);
    expect(await AsaCapsDatabase.listQuoteMappings()).toHaveLength(19);
    expect(await AsaCapsDatabase.listFitmentsForVin(QUOTE_VIN)).toHaveLength(12);
  });

  it("keeps the original columns first, in their original order", async () => {
    const header = (await exportCsvText()).split("\n")[0].split(",");
    expect(header.slice(0, 17)).toEqual([
      "VIN", "Make", "Model", "Variant", "Year", "Model Code", "Chassis Code", "Classification", "Option",
      "Exterior Color", "Interior Color", "Part Number", "PNC", "Description", "Times Copied",
      "First Captured", "Last Captured",
    ]);
    expect(header).toContain("Record Type");
  });

  it("exports and re-imports ASA CAPS production dates", async () => {
    await processClipboardText(
      "ASX(MMAL) 2000 | LS(2WD),S-CVT VIN: JMFXTGA2WBZ003283 Model: GA2W Classification: XTSHR8 " +
        "Option: M09 Exterior: X42A Interior: 22X From: 2010.12.3 To: 2011.2.14",
    );
    await processClipboardText("5253AN28");
    const csv = await exportCsvText();
    // Last Captured, then Production From and Production To.
    expect(csv.split("\n")[0]).toContain("Last Captured,Production From,Production To,");
    expect(csv).toMatch(/Z,2010\.12\.3,2011\.2\.14,/);

    await resetDb();
    await importCsv(csv);
    expect(await AsaCapsDatabase.getVehicle("JMFXTGA2WBZ003283")).toMatchObject({
      productionFrom: "2010.12.3",
      productionTo: "2011.2.14",
    });
  });

  it("keeps a vehicle's production dates when importing a CSV without those columns", async () => {
    await AsaCapsDatabase.putVehicle({
      id: "JMFXTGF8WLJ003875",
      vin: "JMFXTGF8WLJ003875",
      productionFrom: "2019.4.1",
      rawText: "",
      firstSeen: NOW,
      lastSeen: NOW,
    });
    const legacy =
      "VIN,Make,Model,Part Number,Description\nJMFXTGF8WLJ003875,Mitsubishi,ASX,5253AN28,SILL PANEL";
    await importCsv(legacy);
    expect((await AsaCapsDatabase.getVehicle("JMFXTGF8WLJ003875"))?.productionFrom).toBe("2019.4.1");
  });

  it("still imports a CSV exported before quote capture existed", async () => {
    const legacy =
      "VIN,Make,Model,Part Number,PNC,Description,Times Copied,First Captured,Last Captured\n" +
      "JMFXTGF8WLJ003875,Mitsubishi,ASX,5253AN28,,SILL PANEL,2,2026-01-01T00:00:00.000Z,2026-01-02T00:00:00.000Z";
    expect(await importCsv(legacy)).toEqual({ vehiclesImported: 1, fitmentsImported: 1, quoteMappingsImported: 0 });
    expect(await AsaCapsDatabase.getFitment("JMFXTGF8WLJ003875::5253AN28")).toMatchObject({
      timesCopied: 2,
      sources: ["imported"],
    });
  });

  it("exports JSON with fitments and quote mappings", async () => {
    await captureFilledQuote();
    const json = JSON.parse(rowsToJson(await buildCatalogueRows(), await AsaCapsDatabase.listQuoteMappings()));
    expect(json.fitments).toHaveLength(12);
    expect(json.quoteMappings).toHaveLength(19);
  });
});
