import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { processClipboardText } from "@/services/asacaps/vehicle-session";
import { buildCatalogueRows, rowsToCsv, importCsv } from "@/services/asacaps/catalogueExport";

async function resetDb() {
  await AsaCapsDatabase.resetForTests();
  vi.stubGlobal("indexedDB", new IDBFactory());
}

describe("CSV export/import round trip", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("re-imports an exported CSV into an empty catalogue with the same data", async () => {
    await processClipboardText(
      "ASX(MMAL) 2000 | LS(2WD),S-CVT VIN: JMFXTGA2WBZ003283 Model: GA2W Classification: XTSHR8 " +
        "Option: M09 Exterior: X42A Interior: 22X From: 2010.12.3 To: 2010.12.3"
    );
    await processClipboardText("5253AN28\nR/H SILL PANEL OUTER");
    await processClipboardText("5253AN28"); // duplicate copy -> timesCopied 2

    const exportedRows = await buildCatalogueRows();
    const csv = rowsToCsv(exportedRows);

    await resetDb();
    const result = await importCsv(csv);
    expect(result.vehiclesImported).toBe(1);
    expect(result.fitmentsImported).toBe(1);

    const vehicle = await AsaCapsDatabase.getVehicle("JMFXTGA2WBZ003283");
    expect(vehicle?.make).toBe("Mitsubishi");
    expect(vehicle?.model).toBe("ASX");
    expect(vehicle?.classification).toBe("XTSHR8");

    const fitment = await AsaCapsDatabase.getFitment("JMFXTGA2WBZ003283::5253AN28");
    expect(fitment?.description).toBe("R/H SILL PANEL OUTER");
    expect(fitment?.timesCopied).toBe(2);
  });

  it("merges into an existing catalogue rather than duplicating on re-import", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    await processClipboardText("5253AN28");
    const csv = rowsToCsv(await buildCatalogueRows());

    // Import the same CSV twice without resetting — should not double timesCopied
    // or create a second fitment record.
    await importCsv(csv);
    await importCsv(csv);

    const fitments = await AsaCapsDatabase.listFitmentsForVin("JMFXTGF8WLJ003875");
    expect(fitments.length).toBe(1);
    expect(fitments[0].timesCopied).toBe(1);
  });

  it("throws a clear error when required columns are missing", async () => {
    await expect(importCsv("Foo,Bar\n1,2")).rejects.toThrow(/VIN.*Part Number/);
  });
});
