// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQuoteCaptureStore, startQuoteCaptureWatcher } from "@/content/quoteCaptureWatcher";
import type { QuoteCaptureResult, QuoteContext, QuoteRow } from "@/types/quoteMapping";
import { loadQuotePage } from "./partscheckFixtures";

function fakeSave() {
  return vi.fn(
    async (context: QuoteContext, rows: QuoteRow[]): Promise<QuoteCaptureResult> => ({
      quoteKey: context.quoteKey,
      mappings: rows.filter((r) => r.fromDmsUpload && r.partNumber !== "" && r.partNumber !== "NA").length,
      noGenuinePart: 0,
      accessories: 0,
      sideConflicts: [],
      requestedLines: rows.length,
      verifiedRows: rows.filter((r) => r.fromDmsUpload && r.partNumber !== "").length,
      repairerSuppliedRows: rows.filter((r) => !r.fromDmsUpload && r.partNumber !== "").length,
      repairerSuppliedLinked: 0,
    }),
  );
}

describe("startQuoteCaptureWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("captures an already-filled quote on load", async () => {
    const store = createQuoteCaptureStore();
    const save = fakeSave();
    startQuoteCaptureWatcher(store, save, loadQuotePage("quote-filled"));
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(1);
    expect(store.get()).toMatchObject({ state: "saved", result: { mappings: 12, verifiedRows: 19 } });
  });

  it("doesn't save an unfilled quote", async () => {
    const store = createQuoteCaptureStore();
    const save = fakeSave();
    startQuoteCaptureWatcher(store, save, loadQuotePage("quote-empty"));
    await vi.runAllTimersAsync();

    expect(save).not.toHaveBeenCalled();
    expect(store.get()).toEqual({ state: "empty", requestedLines: 19 });
  });

  it("never captures hand edits", async () => {
    const doc = loadQuotePage("quote-filled");
    const save = fakeSave();
    startQuoteCaptureWatcher(createQuoteCaptureStore(), save, doc);
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);

    // Typing into a Part Number box: no listener fires a capture...
    const partInput = doc.querySelector<HTMLInputElement>('input.partNr[data-draft_item_id="147735272"]')!;
    partInput.value = "5220AX76";
    partInput.dispatchEvent(new Event("input", { bubbles: true }));
    partInput.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);

    // ...and if PartsCheck's own script touches the row (an observed DOM
    // change), the re-read still sees the server-rendered value, so nothing new is saved.
    doc.querySelector('tr.lineRow[data-draft_item_id="147735272"]')!.setAttribute("data-touched", "1");
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("captures a fill that rebuilds the table in place, debounced into one save", async () => {
    const doc = loadQuotePage("quote-empty");
    const save = fakeSave();
    startQuoteCaptureWatcher(createQuoteCaptureStore(), save, doc);
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();

    doc.getElementById("lineTable")!.innerHTML = loadQuotePage("quote-filled").getElementById("lineTable")!.innerHTML;
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].filter((r) => r.fromDmsUpload && r.partNumber !== "")).toHaveLength(19);
  });

  it("sends a repairer-prefilled quote so its values are stored, flagged as not uploaded", async () => {
    const store = createQuoteCaptureStore();
    const save = fakeSave();
    startQuoteCaptureWatcher(store, save, loadQuotePage("quote-prefilled"));
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(1);
    expect(store.get()).toMatchObject({
      state: "saved",
      result: { mappings: 0, verifiedRows: 0, repairerSuppliedRows: 6 },
    });
  });

  it("reports an unreachable background", async () => {
    const store = createQuoteCaptureStore();
    startQuoteCaptureWatcher(store, async () => null, loadQuotePage("quote-filled"));
    await vi.runAllTimersAsync();
    expect(store.get().state).toBe("error");
  });
});
