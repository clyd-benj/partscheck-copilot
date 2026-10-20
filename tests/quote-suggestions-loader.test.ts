// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createQuoteSuggestionsStore, loadQuoteSuggestions } from "@/content/quoteSuggestions";
import { loadQuotePage } from "./partscheckFixtures";

describe("loadQuoteSuggestions", () => {
  it("asks about every unfilled line of a new quote, with its vehicle", async () => {
    const store = createQuoteSuggestionsStore();
    const request = vi.fn(async () => []);
    await loadQuoteSuggestions(store, request, loadQuotePage("quote-empty"));

    expect(request).toHaveBeenCalledTimes(1);
    const [vehicle, lines, excludeQuoteKey] = request.mock.calls[0] as unknown as [
      { vin: string; model: string },
      { id: string; description: string }[],
      string,
    ];
    expect(vehicle).toEqual({ vin: "MMAGUKS10NH000001", model: "Pajero Sport" });
    expect(lines).toHaveLength(19);
    expect(lines[1]).toEqual({ id: "147735272", description: "L/H/F GUARD" });
    expect(excludeQuoteKey).toBe("draft:10000001");
    expect(store.get()).toEqual({ state: "ready", lines: [] });
  });

  it("doesn't ask when every line already has a part number", async () => {
    const store = createQuoteSuggestionsStore();
    const request = vi.fn(async () => []);
    await loadQuoteSuggestions(store, request, loadQuotePage("quote-filled"));
    expect(request).not.toHaveBeenCalled();
    expect(store.get()).toEqual({ state: "ready", lines: [] });
  });
});
