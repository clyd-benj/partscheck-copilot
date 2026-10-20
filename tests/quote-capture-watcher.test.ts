// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQuoteCaptureStore, startQuoteCaptureWatcher } from "@/content/quoteCaptureWatcher";
import type { QuoteCaptureResult, QuoteContext, QuoteRow } from "@/types/quoteMapping";
import { loadQuotePage } from "./partscheckFixtures";

function fakeSave() {
  return vi.fn(
    async (context: QuoteContext, rows: QuoteRow[]): Promise<QuoteCaptureResult> => ({
      quoteKey: context.quoteKey,
      mappings: rows.filter((r) => r.partNumber !== "" && r.partNumber !== "NA").length,
      noGenuinePart: 0,
      accessories: 0,
      sideConflicts: [],
      requestedLines: rows.length,
      filledRows: rows.filter((r) => r.partNumber !== "").length,
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
    expect(store.get()).toMatchObject({ state: "saved", result: { mappings: 12, filledRows: 19 } });
  });

  it("doesn't save an unfilled quote", async () => {
    const store = createQuoteCaptureStore();
    const save = fakeSave();
    startQuoteCaptureWatcher(store, save, loadQuotePage("quote-empty"));
    await vi.runAllTimersAsync();

    expect(save).not.toHaveBeenCalled();
    expect(store.get()).toEqual({ state: "empty", requestedLines: 19 });
  });

  it("re-saves when the table changes, but not when nothing did", async () => {
    const doc = loadQuotePage("quote-filled");
    const save = fakeSave();
    startQuoteCaptureWatcher(createQuoteCaptureStore(), save, doc);
    await vi.runAllTimersAsync();

    const table = doc.getElementById("lineTable")!;
    table.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);

    const partInput = doc.querySelector<HTMLInputElement>('input.partNr[data-draft_item_id="147735272"]')!;
    partInput.value = "5220AX76";
    partInput.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1][1].partNumber).toBe("5220AX76");
  });

  it("debounces a burst of DOM mutations into one save", async () => {
    const doc = loadQuotePage("quote-empty");
    const save = fakeSave();
    startQuoteCaptureWatcher(createQuoteCaptureStore(), save, doc);
    await vi.runAllTimersAsync();

    // Simulate a fill: set each part number and touch the row so the observer fires.
    const filled = loadQuotePage("quote-filled");
    for (const input of doc.querySelectorAll<HTMLInputElement>("input.partNr")) {
      const id = input.getAttribute("data-draft_item_id");
      input.value = filled.querySelector<HTMLInputElement>(`input.partNr[data-draft_item_id="${id}"]`)!.value;
      input.setAttribute("value", input.value);
    }
    await vi.runAllTimersAsync();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1].filter((r) => r.partNumber !== "")).toHaveLength(19);
  });

  it("reports an unreachable background", async () => {
    const store = createQuoteCaptureStore();
    startQuoteCaptureWatcher(store, async () => null, loadQuotePage("quote-filled"));
    await vi.runAllTimersAsync();
    expect(store.get().state).toBe("error");
  });
});
