import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Database } from "../src/database/database";
import { processClipboardText } from "../src/vehicle/vehicle-session";
import { buildCoverageSummary } from "../src/shared/coverage";

async function resetDb() {
  await Database.resetForTests();
  indexedDB = new IDBFactory();
}

const TECH_INFO = (vin: string, classification: string) =>
  `ASX(MMAL) 2000 | LS(2WD),S-CVT VIN: ${vin} Model: GA2W Classification: ${classification} ` +
  `Option: M09 Exterior: X42A Interior: 22X From: 2010.12.3 To: 2010.12.3`;

describe("buildCoverageSummary", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("groups vehicles by classification and marks groups with 20+ vehicles as ready", async () => {
    // 20 vehicles sharing classification "XTSHR8" (ready), 5 under "OTHER1" (not ready).
    const vin = (n: number) => `JMFXTGA2WBZ00${String(n).padStart(4, "0")}`;

    for (let i = 0; i < 20; i++) {
      await processClipboardText(TECH_INFO(vin(i), "XTSHR8"));
      if (i < 2) await processClipboardText(i === 0 ? "5253AN28" : "5301J910");
    }

    for (let i = 20; i < 25; i++) {
      await processClipboardText(TECH_INFO(vin(i), "OTHER1"));
    }
    await processClipboardText("6400A123");

    const summary = await buildCoverageSummary();

    expect(summary.totalVehicles).toBe(25);
    expect(summary.totalFitments).toBe(3);

    const shared = summary.groups.find((g) => g.classification === "XTSHR8");
    expect(shared?.vehicleCount).toBe(20);
    expect(shared?.partCount).toBe(2);
    expect(shared?.ready).toBe(true);

    const lone = summary.groups.find((g) => g.classification === "OTHER1");
    expect(lone?.vehicleCount).toBe(5);
    expect(lone?.ready).toBe(false);

    expect(summary.readyGroups).toBe(1);
  });

  it("returns an empty summary when nothing has been captured", async () => {
    const summary = await buildCoverageSummary();
    expect(summary.totalVehicles).toBe(0);
    expect(summary.totalFitments).toBe(0);
    expect(summary.groups).toEqual([]);
  });
});
