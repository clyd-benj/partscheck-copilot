// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { extractQuoteContext, extractQuoteRows } from "@/services/extractors/quoteRows";
import { loadEraCsvLines, loadQuotePage } from "./partscheckFixtures";

describe("extractQuoteRows — after DMS Upload", () => {
  const rows = extractQuoteRows(loadQuotePage("quote-filled"));

  it("reads every requested line, skipping price-match and competitor rows", () => {
    expect(rows).toHaveLength(19);
    expect(rows.map((r) => r.rowNo)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(rows.every((r) => r.iteration === 0)).toBe(true);
  });

  it("matches the uploaded ERA CSV line for line (MI prefix stripped by PartsCheck)", () => {
    const csv = loadEraCsvLines();
    expect(rows.map((r) => r.partNumber)).toEqual(csv.map((l) => l.partNumber));
    expect(rows.map((r) => r.note ?? "")).toEqual(csv.map((l) => l.notes));
  });

  it("separates the bold ERA description from the italic repairer description", () => {
    expect(rows[1]).toEqual({
      rowNo: 2,
      iteration: 0,
      draftItemId: "147735272",
      repairerDescription: "L/H/F GUARD",
      eraDescription: "FENDERFR LH",
      partNumber: "5220AX75",
      qty: 1,
      listPrice: 671.25,
      buyPrice: 570.56,
      note: "3-5 DAYS STRICTLY NON RETURNABLE",
    });
  });

  it("reads NA rows and their note", () => {
    expect(rows[0]).toMatchObject({
      repairerDescription: "FRONT B/BAR FLARE SEAL L/H",
      eraDescription: "NOT APPLICABLE",
      partNumber: "NA",
      listPrice: 0.01,
      note: "NOT LISTED",
    });
  });

  it("leaves note undefined when the note input is empty", () => {
    expect(rows[2].note).toBeUndefined();
  });
});

describe("extractQuoteRows — before DMS Upload", () => {
  const rows = extractQuoteRows(loadQuotePage("quote-empty"));

  it("reads the same lines with no part numbers and no ERA description", () => {
    expect(rows).toHaveLength(19);
    expect(rows.every((r) => r.partNumber === "" && r.eraDescription === undefined)).toBe(true);
    expect(rows[1].repairerDescription).toBe("L/H/F GUARD");
    expect(rows[1].listPrice).toBeUndefined(); // Qty is pre-filled with 1 by PartsCheck
  });
});

describe("extractQuoteRows — defensive reading", () => {
  it("logs and returns [] when the line table is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString("<p>not a quote</p>", "text/html");
    expect(extractQuoteRows(doc)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("#lineTable"));
    warn.mockRestore();
  });

  it("logs a missing input but still returns the row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(
      `<table id="lineTable"><tr class="lineRow" data-draft_item_id="1" data-iteration="0" data-print_order="0" data-parttext="BONNET">
         <td>1</td><td><b>BONNET</b></td></tr></table>`,
      "text/html",
    );
    const [row] = extractQuoteRows(doc);
    expect(row).toMatchObject({ rowNo: 1, repairerDescription: "BONNET", partNumber: "" });
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("input.partNr"));
    warn.mockRestore();
  });

  it("skips rows hidden by PartsCheck's delete-row action", () => {
    const doc = loadQuotePage("quote-filled");
    doc.querySelector<HTMLElement>('tr.lineRow[data-draft_item_id="147735272"]')!.style.display = "none";
    expect(extractQuoteRows(doc)).toHaveLength(18);
  });
});

describe("extractQuoteContext", () => {
  it("reads the quote identity and vehicle", () => {
    expect(extractQuoteContext(loadQuotePage("quote-filled"))).toEqual({
      quoteKey: "draft:10000001",
      draftId: "10000001",
      reference: "R12345",
      eraQuoteNo: "1050894R",
      vin: "MMAGUKS10NH000001",
      make: "Mitsubishi",
      model: "Pajero Sport",
      modelNr: undefined,
      series: "QF",
      registration: "TEST01",
      mthYr: "12/2022",
    });
  });

  it("has no ERA quote number before upload", () => {
    expect(extractQuoteContext(loadQuotePage("quote-empty"))?.eraQuoteNo).toBeUndefined();
  });

  it("falls back to the Reference when the draftID input is missing", () => {
    const doc = loadQuotePage("quote-filled");
    doc.querySelector('input[name="draftID"]')!.remove();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(extractQuoteContext(doc)?.quoteKey).toBe("ref:R12345");
    vi.restoreAllMocks();
  });
});
