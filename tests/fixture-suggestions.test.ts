// @vitest-environment jsdom
// Pins the suggestions produced from the real captured quote, so any change
// to them is deliberate (HANDOFF.md §9.9 has the before/after report).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { extractQuoteContext, extractQuoteRows } from "@/services/extractors/quoteRows";
import { captureQuote, suggestForQuote } from "@/services/quoteCapture/captureQuote";
import { loadQuotePage } from "./partscheckFixtures";
import { vehicle } from "./suggestionHelpers";

const FILLED_VIN = "MMAGUKS10NH000001";
const OTHER_VIN = "MMAGUKS10NH000999";

async function setup(withCatalogue: boolean) {
  await AsaCapsDatabase.resetForTests();
  vi.stubGlobal("indexedDB", new IDBFactory());
  if (withCatalogue) await AsaCapsDatabase.putVehicle(vehicle(FILLED_VIN, { model: "PAJERO SPORT", modelCode: "QF1W" }));
  const filled = loadQuotePage("quote-filled");
  await captureQuote(extractQuoteContext(filled)!, extractQuoteRows(filled), "2026-10-20T03:30:00.000Z");
}

async function run(vin: string, mirror: boolean) {
  const lines = extractQuoteRows(loadQuotePage("quote-empty")).map((r) => ({
    id: r.draftItemId,
    description: mirror ? r.repairerDescription.replace(/L\/H/g, "R/H") : r.repairerDescription,
  }));
  const result = await suggestForQuote({ vin, model: "Pajero Sport", mthYr: "3/2022" }, lines, "draft:new");
  return Object.fromEntries(
    result
      .filter((l) => l.suggestions.length > 0)
      .map((l) => [l.description, l.suggestions.map((s) => `${s.partNumber} ${s.level}`).join(", ")]),
  );
}

const LH_RESULTS = {
  "L/H/F GUARD": "5220AX75 confirmed",
  "L/H/F GUARD LINER FRONT": "5370C287 confirmed",
  "L/H/F GUARD LINER REAR": "5370C283 confirmed",
  "L/H STEP PANEL ASSEMBLY": "96111A000P confirmed",
  "L/H SIDE STEP PANEL MOULD": "5360A415 confirmed",
  "L/H/F DOOR WEATHER SHEILD": "MZ330934 confirmed",
  "L/H/F LOWER CONTROL ARM": "54503W000P confirmed",
  // Part-number parity (even = RH) disagrees with the LH side from the
  // other sources, so these are only possible.
  "L/H/F HUB BEARING": "MR992372 possible",
  "L/H/F HUB ASSEMBLY": "40202W030P confirmed",
  "L/H/F STEERING KNUCKLE": "3870A180 possible",
  "L/H/F LOWER BALL JOINT": "4013A314 possible",
  "L/H STEERING TIE ROD END": "4422A096 possible",
};

describe("suggestions from the real captured quote", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));

  it("same VIN, same left-hand lines", async () => {
    await setup(false);
    expect(await run(FILLED_VIN, false)).toEqual(LH_RESULTS);
  });

  it("same VIN, mirrored to right-hand lines: nothing (every captured part is left-hand)", async () => {
    await setup(false);
    expect(await run(FILLED_VIN, true)).toEqual({});
  });

  it("another VIN with the same pattern and no catalogue: nothing (no model code)", async () => {
    await setup(false);
    expect(await run(OTHER_VIN, false)).toEqual({});
  });

  it("another VIN once the catalogue knows the pattern is QF1W: same as the same VIN", async () => {
    await setup(true);
    expect(await run(OTHER_VIN, false)).toEqual(LH_RESULTS);
  });

  it("another QF1W, right-hand lines: nothing", async () => {
    await setup(true);
    expect(await run(OTHER_VIN, true)).toEqual({});
  });
});
