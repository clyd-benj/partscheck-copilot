// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { extractQuoteContext, extractQuoteRows } from "@/services/extractors/quoteRows";
import { captureQuote, suggestForQuote } from "@/services/quoteCapture/captureQuote";
import { createQuoteSuggestionsStore, loadQuoteSuggestions } from "@/content/quoteSuggestions";
import { looksLikePartNumber } from "@/services/asacaps/part-parser";
import { loadQuotePage } from "./partscheckFixtures";

const BEFORE = "2026-10-20T01:00:00.000Z";
const AFTER = "2026-10-20T03:30:00.000Z";
const VIN = "MMAGUKS10NH000001";

function capture(name: "quote-filled" | "quote-prefilled", now: string, doc = loadQuotePage(name)) {
  return captureQuote(extractQuoteContext(doc)!, extractQuoteRows(doc), now);
}

const byRow = async () =>
  Object.fromEntries(
    (await AsaCapsDatabase.listRepairerSuppliedForQuote("draft:10000001")).map((r) => [r.rowNo, r]),
  );

describe("repairer-supplied part numbers", () => {
  beforeEach(async () => {
    await AsaCapsDatabase.resetForTests();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("are never captured as mappings, fitments or vehicles", async () => {
    const result = await capture("quote-prefilled", BEFORE);

    expect(result).toMatchObject({
      mappings: 0,
      verifiedRows: 0,
      repairerSuppliedRows: 6,
      repairerSuppliedLinked: 0,
    });
    expect(await AsaCapsDatabase.listQuoteMappings()).toEqual([]);
    expect(await AsaCapsDatabase.listFitments()).toEqual([]);
    expect(await AsaCapsDatabase.getVehicle(VIN)).toBeUndefined();
  });

  it("are stored per quote + row, flagging values that don't look like part numbers", async () => {
    await capture("quote-prefilled", BEFORE);
    const rows = await byRow();

    expect(Object.keys(rows).map(Number).sort((a, b) => a - b)).toEqual([1, 2, 8, 10, 13, 19]);
    expect(rows[2]).toMatchObject({
      id: "draft:10000001::2",
      repairerDescription: "L/H/F GUARD",
      repairerNormalised: "FRONT GUARD",
      side: "LH",
      suppliedValue: "5220AX74",
      looksLikePartNumber: true,
      vin: VIN,
      firstSeen: BEFORE,
    });
    expect(rows[2].verifiedPartNumber).toBeUndefined();
    expect(rows[10]).toMatchObject({ suppliedValue: "TRITON BAGDE", looksLikePartNumber: false });
    expect(rows[19]).toMatchObject({ suppliedValue: "TBA", looksLikePartNumber: false });
    expect(rows[13]).toMatchObject({ suppliedValue: "MR992372", looksLikePartNumber: true });
  });

  it("are linked to the verified number after the same quote is DMS-uploaded", async () => {
    await capture("quote-prefilled", BEFORE);
    const result = await capture("quote-filled", AFTER);

    // The upload still captures exactly as before...
    expect(result).toMatchObject({ mappings: 12, verifiedRows: 19, repairerSuppliedRows: 0 });
    expect(await AsaCapsDatabase.listQuoteMappings()).toHaveLength(19);
    // ...and each repairer value now has its correction.
    expect(result.repairerSuppliedLinked).toBe(6);

    const rows = await byRow();
    expect(rows[2]).toMatchObject({
      suppliedValue: "5220AX74",
      verifiedPartNumber: "5220AX75",
      verifiedEraDescription: "FENDERFR LH",
      verifiedNoGenuinePart: false,
      matchesVerified: false,
      linkedAt: AFTER,
      firstSeen: BEFORE,
    });
    expect(rows[8]).toMatchObject({ verifiedPartNumber: "96111A000P", matchesVerified: true });
    expect(rows[13]).toMatchObject({ verifiedPartNumber: "MR992372", matchesVerified: true });
    expect(rows[10]).toMatchObject({ verifiedPartNumber: "MZ330934", matchesVerified: false });
    expect(rows[1]).toMatchObject({ verifiedPartNumber: "NA", verifiedNoGenuinePart: true });
  });

  it("keeps the link when the quote is read again", async () => {
    await capture("quote-prefilled", BEFORE);
    await capture("quote-filled", AFTER);
    await capture("quote-filled", "2026-10-21T00:00:00.000Z");
    await capture("quote-prefilled", "2026-10-22T00:00:00.000Z");

    const rows = await byRow();
    expect(rows[2]).toMatchObject({ verifiedPartNumber: "5220AX75", linkedAt: AFTER, firstSeen: BEFORE });
    expect(await AsaCapsDatabase.listRepairerSupplied()).toHaveLength(6);
  });

  it("only the plain-<b> rows are ignored on a page that mixes both", async () => {
    const doc = loadQuotePage("quote-filled");
    // Row 2 as the repairer left it: plain bold description, their own number.
    const row = doc.querySelector('tr.lineRow[data-draft_item_id="147735272"]')!;
    row.querySelector("td i")!.previousElementSibling!.remove(); // <br/>
    row.querySelector("td i")!.remove();
    row.querySelector("td b")!.textContent = "L/H/F GUARD";
    row.querySelector("input.partNr")!.setAttribute("value", "5220AX74");

    const result = await capture("quote-filled", AFTER, doc);
    expect(result).toMatchObject({ verifiedRows: 18, repairerSuppliedRows: 1, mappings: 11 });
    const mappings = await AsaCapsDatabase.listQuoteMappings();
    expect(mappings.find((m) => m.rowNo === 2)).toBeUndefined();
    expect(mappings.some((m) => m.partNumber === "5220AX74")).toBe(false);
  });

  it("never feed suggestions", async () => {
    await capture("quote-prefilled", BEFORE);
    const [guard] = await suggestForQuote({ vin: VIN, model: "Pajero Sport" }, [
      { id: "a", description: "L/H/F GUARD" },
    ]);
    expect(guard.suggestions).toEqual([]);
  });

  it("still get suggestions for lines the repairer pre-filled", async () => {
    const store = createQuoteSuggestionsStore();
    const request = vi.fn(async (_vehicle: unknown, _lines: { id: string }[]) => []);
    await loadQuoteSuggestions(store, request, loadQuotePage("quote-prefilled"));
    expect(request.mock.calls[0][1]).toHaveLength(19);
  });
});

describe("looksLikePartNumber (ASA CAPS patterns)", () => {
  it.each([
    ["5220AX75", true],
    ["96111A000P", true],
    ["mr992372", true],
    ["MZ330934", true],
    ["TRITON BAGDE", false],
    ["TBA", false],
    ["", false],
  ])("%s → %s", (value, expected) => {
    expect(looksLikePartNumber(value)).toBe(expected);
  });
});
