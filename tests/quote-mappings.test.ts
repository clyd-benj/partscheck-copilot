// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { extractQuoteContext, extractQuoteRows } from "@/services/extractors/quoteRows";
import { buildQuoteMappings, summariseCapture } from "@/services/quoteCapture/buildMappings";
import { captureQuote } from "@/services/quoteCapture/captureQuote";
import type { QuoteContext, QuoteRow } from "@/types/quoteMapping";
import { loadQuotePage } from "./partscheckFixtures";

const NOW = "2026-10-20T03:30:00.000Z";
const LATER = "2026-10-21T09:00:00.000Z";

function filledQuote(): { context: QuoteContext; rows: QuoteRow[] } {
  const doc = loadQuotePage("quote-filled");
  return { context: extractQuoteContext(doc)!, rows: extractQuoteRows(doc) };
}

describe("buildQuoteMappings", () => {
  const { context, rows } = filledQuote();
  const mappings = buildQuoteMappings(context, rows, { now: NOW });
  const byRow = (n: number) => mappings.find((m) => m.rowNo === n)!;

  it("builds one record per filled row, keyed by quote + row number", () => {
    expect(mappings).toHaveLength(19);
    expect(byRow(2).id).toBe("draft:10000001::2");
  });

  it("stores description, side, part, prices, note and vehicle", () => {
    expect(byRow(2)).toMatchObject({
      repairerDescription: "L/H/F GUARD",
      repairerNormalised: "FRONT GUARD",
      side: "LH",
      partNumber: "5220AX75",
      eraDescription: "FENDERFR LH",
      listPrice: 671.25,
      buyPrice: 570.56,
      note: "3-5 DAYS STRICTLY NON RETURNABLE",
      noGenuinePart: false,
      isAccessory: false,
      sideConflict: false,
      vin: "MMAGUKS10NH000001",
      model: "Pajero Sport",
      mthYr: "12/2022",
      reference: "R12345",
      eraQuoteNo: "1050894R",
      firstSeen: NOW,
      lastSeen: NOW,
    });
  });

  it("flags NA rows as no genuine part", () => {
    const na = mappings.filter((m) => m.noGenuinePart);
    expect(na.map((m) => m.rowNo)).toEqual([1, 5, 6, 7, 11, 17, 19]);
    expect(na.every((m) => !m.isAccessory && !m.sideConflict)).toBe(true);
  });

  it("tags MZ part numbers as accessories", () => {
    expect(mappings.filter((m) => m.isAccessory).map((m) => m.partNumber)).toEqual(["MZ330934"]);
  });

  it("flags an ERA line for the opposite side (ERA order slip)", () => {
    const swapped = rows.map((r) => (r.rowNo === 15 ? { ...r, eraDescription: "KNUCKLERH" } : r));
    const [conflict] = buildQuoteMappings(context, swapped, { now: NOW }).filter((m) => m.sideConflict);
    expect(conflict).toMatchObject({ rowNo: 15, side: "LH", partNumber: "3870A180" });
  });

  it("skips rows without a part number", () => {
    const partial = rows.map((r) => (r.rowNo > 10 ? { ...r, partNumber: "" } : r));
    expect(buildQuoteMappings(context, partial, { now: NOW })).toHaveLength(10);
  });

  it("summarises the capture for the panel", () => {
    const summary = summariseCapture(context, rows, mappings);
    expect(summary).toMatchObject({
      quoteKey: "draft:10000001",
      mappings: 12,
      noGenuinePart: 7,
      accessories: 1,
      sideConflicts: [],
      requestedLines: 19,
      filledRows: 19,
    });
  });
});

describe("captureQuote (quoteMappings store)", () => {
  beforeEach(async () => {
    await AsaCapsDatabase.resetForTests();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("re-reading the same quote updates rows instead of duplicating them", async () => {
    const { context, rows } = filledQuote();
    await captureQuote(context, rows, NOW);
    const changed = rows.map((r) => (r.rowNo === 2 ? { ...r, buyPrice: 500 } : r));
    await captureQuote(context, changed, LATER);

    const stored = await AsaCapsDatabase.listQuoteMappings();
    expect(stored).toHaveLength(19);
    const row2 = stored.find((m) => m.rowNo === 2)!;
    expect(row2).toMatchObject({ buyPrice: 500, firstSeen: NOW, lastSeen: LATER });
  });

  it("keeps quotes apart by quote key", async () => {
    const { context, rows } = filledQuote();
    await captureQuote(context, rows, NOW);
    await captureQuote({ ...context, quoteKey: "draft:10000002", draftId: "10000002" }, rows, NOW);
    expect(await AsaCapsDatabase.listQuoteMappings()).toHaveLength(38);
    expect(await AsaCapsDatabase.listQuoteMappingsForQuote("draft:10000002")).toHaveLength(19);
  });

  it("takes the model code from the ASA CAPS catalogue when the VIN is known", async () => {
    await AsaCapsDatabase.putVehicle({
      id: "MMAGUKS10NH000001",
      vin: "MMAGUKS10NH000001",
      make: "Mitsubishi",
      model: "PAJERO SPORT",
      modelCode: "QF1W",
      rawText: "",
      firstSeen: NOW,
      lastSeen: NOW,
    });
    const { context, rows } = filledQuote();
    const result = await captureQuote(context, rows, NOW);

    expect(result.mappings).toBe(12);
    const stored = await AsaCapsDatabase.listQuoteMappingsForQuote("draft:10000001");
    expect(stored.every((m) => m.modelCode === "QF1W")).toBe(true);
  });

  it("leaves the model code blank when the VIN isn't in the catalogue", async () => {
    const { context, rows } = filledQuote();
    await captureQuote(context, rows, NOW);
    const stored = await AsaCapsDatabase.listQuoteMappings();
    expect(stored.every((m) => m.modelCode === undefined)).toBe(true);
  });
});
