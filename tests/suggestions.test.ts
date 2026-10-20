// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { extractQuoteContext, extractQuoteRows } from "@/services/extractors/quoteRows";
import { captureQuote, suggestForQuote } from "@/services/quoteCapture/captureQuote";
import { copyAllText, suggestForLines } from "@/services/quoteCapture/suggestions";
import { normaliseDescription, parseSide } from "@/services/quoteCapture/normalise";
import type { QuoteMapping } from "@/types/quoteMapping";
import { loadQuotePage } from "./partscheckFixtures";

let seq = 0;
function mapping(overrides: Partial<QuoteMapping> & { repairerDescription: string }): QuoteMapping {
  seq += 1;
  const quoteKey = overrides.quoteKey ?? `draft:${seq}`;
  return {
    id: `${quoteKey}::1`,
    quoteKey,
    rowNo: 1,
    iteration: 0,
    draftItemId: String(seq),
    repairerNormalised: normaliseDescription(overrides.repairerDescription),
    side: parseSide(overrides.repairerDescription),
    partNumber: "5716A585",
    eraDescription: "HANDLERR DOOR OUTSIDE",
    noGenuinePart: false,
    isAccessory: false,
    sideConflict: false,
    vin: `MMAJYKL10PH${String(seq).padStart(6, "0")}`,
    make: "Mitsubishi",
    model: "Triton",
    firstSeen: "2026-10-01T00:00:00.000Z",
    lastSeen: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const TRITON = { vin: "MMAJYKL10PH999999", model: "Triton" };
const line = (description: string) => ({ id: "1", description });
const partsFor = (vehicle: typeof TRITON, description: string, mappings: QuoteMapping[]) =>
  suggestForLines(vehicle, [line(description)], mappings)[0].suggestions.map((s) => s.partNumber);

describe("suggestForLines — wording", () => {
  it("suggests a part used for the same wording, with evidence", () => {
    const [result] = suggestForLines(
      TRITON,
      [line("L/H REAR DOOR OUTER HANDLE")],
      [mapping({ repairerDescription: "L/H REAR DOOR OUTER HANDLE", lastSeen: "2026-10-12T05:00:00.000Z" })],
    );
    expect(result.side).toBe("LH");
    expect(result.suggestions).toEqual([
      expect.objectContaining({
        partNumber: "5716A585",
        tier: "vinPattern",
        wordingScore: 1,
        similarWording: undefined,
        evidence: "used on 1 vehicle with this VIN pattern · Triton, last 2026-10-12",
      }),
    ]);
  });

  it("matches different wordings that normalise the same", () => {
    const stored = [mapping({ repairerDescription: "LHR DR OUTSIDE HDL" })];
    expect(partsFor(TRITON, "L/H REAR DOOR OUTER HANDLE", stored)).toEqual(["5716A585"]);
  });

  it("accepts close wording and says what it was similar to", () => {
    const stored = [mapping({ repairerDescription: "L/H REAR DOOR OUTER HANDLE" })];
    const [s] = suggestForLines(TRITON, [line("L/H REAR DOOR OUTER HANDLE ASSY")], stored)[0].suggestions;
    expect(s.wordingScore).toBe(0.8);
    expect(s.similarWording).toBe("L/H REAR DOOR OUTER HANDLE");
  });

  it("never treats different positions as similar wording", () => {
    const rearLiner = mapping({ repairerDescription: "L/H/F GUARD LINER REAR", eraDescription: "SHIELDFR WHEELHOUSE SPLASHRR" });
    expect(partsFor(TRITON, "L/H/F GUARD LINER FRONT", [rearLiner])).toEqual([]);
    const outerHandle = mapping({ repairerDescription: "L/H REAR DOOR OUTER HANDLE" });
    expect(partsFor(TRITON, "L/H REAR DOOR HANDLE", [outerHandle])).toEqual([]);
  });

  it("doesn't suggest a guard for a guard liner", () => {
    const stored = [mapping({ repairerDescription: "L/H/F GUARD", partNumber: "5220AX75", eraDescription: "FENDERFR LH" })];
    expect(partsFor(TRITON, "L/H/F GUARD LINER", stored)).toEqual([]);
  });
});

describe("suggestForLines — side", () => {
  const handed = mapping({ repairerDescription: "L/H/F GUARD", partNumber: "5220AX75", eraDescription: "FENDERFR LH" });
  const unhanded = mapping({
    repairerDescription: "L/H/F HUB BEARING",
    partNumber: "MR992372",
    eraDescription: "BEARINGFR WHEEL HUB",
  });

  it("never suggests a handed part for the other side", () => {
    expect(partsFor(TRITON, "R/H/F GUARD", [handed])).toEqual([]);
    expect(partsFor(TRITON, "L/H/F GUARD", [handed])).toEqual(["5220AX75"]);
  });

  it("doesn't guess a hand when the line names no side", () => {
    expect(partsFor(TRITON, "FRONT GUARD", [handed])).toEqual([]);
  });

  it("offers either hand when the line names both sides", () => {
    expect(partsFor(TRITON, "L/H & R/H FRONT GUARD", [handed])).toEqual(["5220AX75"]);
  });

  it("suggests an unhanded part for either side, whatever the repairer wrote", () => {
    expect(partsFor(TRITON, "R/H/F HUB BEARING", [unhanded])).toEqual(["MR992372"]);
    expect(partsFor(TRITON, "FRONT HUB BEARING", [unhanded])).toEqual(["MR992372"]);
  });

  it("falls back to the repairer's side when there's no ERA description", () => {
    const typed = mapping({ repairerDescription: "L/H/F GUARD", eraDescription: undefined });
    expect(partsFor(TRITON, "R/H/F GUARD", [typed])).toEqual([]);
  });
});

describe("suggestForLines — what's never suggested", () => {
  it("skips NA rows, likely ERA ordering slips, and the quote itself", () => {
    const stored = [
      mapping({ repairerDescription: "L/H/F GUARD", partNumber: "NA", noGenuinePart: true }),
      mapping({ repairerDescription: "L/H/F GUARD", partNumber: "5220AX76", sideConflict: true }),
      mapping({ repairerDescription: "L/H/F GUARD", partNumber: "5220AX77", quoteKey: "draft:open" }),
    ];
    expect(
      suggestForLines(TRITON, [line("L/H/F GUARD")], stored, { excludeQuoteKey: "draft:open" })[0].suggestions,
    ).toEqual([]);
  });

  it("skips other models", () => {
    const stored = [mapping({ repairerDescription: "BONNET", vin: "MMAGUKS10NH000001", model: "Pajero Sport" })];
    expect(partsFor(TRITON, "BONNET", stored)).toEqual([]);
  });
});

describe("suggestForLines — ranking", () => {
  it("ranks exact VIN > model code > VIN pattern > model", () => {
    const vehicle = { ...TRITON, modelCode: "KK1T" };
    const stored = [
      mapping({ repairerDescription: "BONNET", partNumber: "MODEL", vin: "MMBXXXXXXXX000001" }),
      mapping({ repairerDescription: "BONNET", partNumber: "PATTERN" }),
      mapping({ repairerDescription: "BONNET", partNumber: "CODE", vin: "MMBXXXXXXXX000002", modelCode: "KK1T" }),
      mapping({ repairerDescription: "BONNET", partNumber: "VIN", vin: TRITON.vin }),
    ];
    const ranked = suggestForLines(vehicle, [line("BONNET")], stored, { limit: 4 })[0].suggestions;
    expect(ranked.map((s) => [s.partNumber, s.tier])).toEqual([
      ["VIN", "vin"],
      ["CODE", "modelCode"],
      ["PATTERN", "vinPattern"],
      ["MODEL", "model"],
    ]);
    expect(ranked[0].evidence).toBe("used on this vehicle (1 time), last 2026-10-01");
    expect(ranked[1].evidence).toBe("used on 1 vehicle · KK1T Triton, last 2026-10-01");
  });

  it("counts distinct vehicles, prefers the more-used part, and caps at 3", () => {
    const stored = [
      mapping({ repairerDescription: "BONNET", partNumber: "A", vin: "MMBXXXXXXXX000001" }),
      mapping({ repairerDescription: "BONNET", partNumber: "B", vin: "MMBXXXXXXXX000002" }),
      mapping({ repairerDescription: "BONNET", partNumber: "B", vin: "MMBXXXXXXXX000003", lastSeen: "2026-10-20T00:00:00.000Z" }),
      mapping({ repairerDescription: "BONNET", partNumber: "C", vin: "MMBXXXXXXXX000004" }),
      mapping({ repairerDescription: "BONNET", partNumber: "D", vin: "MMBXXXXXXXX000005" }),
    ];
    const ranked = suggestForLines(TRITON, [line("BONNET")], stored)[0].suggestions;
    expect(ranked).toHaveLength(3);
    expect(ranked[0]).toMatchObject({
      partNumber: "B",
      vehicleCount: 2,
      evidence: "used on 2 vehicles · Triton, last 2026-10-20",
    });
  });
});

describe("copyAllText", () => {
  it("puts the top suggestion per line in order, blank where there's none", () => {
    const stored = [
      mapping({ repairerDescription: "BONNET", partNumber: "5900A" }),
      mapping({ repairerDescription: "GRILLE", partNumber: "7450A" }),
    ];
    const lines = suggestForLines(TRITON, [line("BONNET"), line("TOW BAR"), line("GRILLE")], stored);
    expect(copyAllText(lines)).toBe("5900A\n\n7450A");
  });
});

describe("suggestForQuote — from captured quotes", () => {
  beforeEach(async () => {
    await AsaCapsDatabase.resetForTests();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("suggests from a captured Pajero Sport quote for the next one", async () => {
    const filled = loadQuotePage("quote-filled");
    await captureQuote(extractQuoteContext(filled)!, extractQuoteRows(filled), "2026-10-20T03:30:00.000Z");

    // A new quote on another Pajero Sport of the same series, mirrored to the right side.
    const lines = extractQuoteRows(loadQuotePage("quote-empty")).map((r) => ({
      id: r.draftItemId,
      description: r.repairerDescription.replace(/L\/H/g, "R/H"),
    }));
    const result = await suggestForQuote({ vin: "MMAGUKS10NH000999", model: "Pajero Sport" }, lines, "draft:new");
    const top = Object.fromEntries(result.map((l) => [l.description, l.suggestions[0]?.partNumber]));

    // Handed parts aren't offered for the other side...
    expect(top["R/H/F GUARD"]).toBeUndefined();
    expect(top["R/H/F STEERING KNUCKLE"]).toBeUndefined();
    // ...unhanded ones are, and NA lines never are.
    expect(top["R/H/F HUB BEARING"]).toBe("MR992372");
    expect(top["R/H/F HUB ASSEMBLY"]).toBe("40202W030P");
    expect(top["R/H/F LOWER BALL JOINT"]).toBe("4013A314");
    expect(top["R/H/F DOOR WEATHER SHEILD"]).toBe("MZ330934");
    expect(top["R/H/F HUB NUT"]).toBeUndefined();
    expect(result.find((l) => l.description === "R/H/F HUB BEARING")!.suggestions[0].evidence).toBe(
      "used on 1 vehicle with this VIN pattern · Pajero Sport built 2022, last 2026-10-20",
    );
  });

  it("suggests the same-side parts for the same wording", async () => {
    const filled = loadQuotePage("quote-filled");
    await captureQuote(extractQuoteContext(filled)!, extractQuoteRows(filled), "2026-10-20T03:30:00.000Z");
    const [guard, knuckle] = await suggestForQuote(
      { vin: "MMAGUKS10NH000999", model: "Pajero Sport" },
      [
        { id: "a", description: "LEFT FRONT FENDER" },
        { id: "b", description: "L/H/F STEERING KNUCKLE" },
      ],
    );
    expect(guard.suggestions[0].partNumber).toBe("5220AX75");
    expect(knuckle.suggestions[0].partNumber).toBe("3870A180");
  });

  it("uses the ASA CAPS catalogue's model code for the open vehicle", async () => {
    const filled = loadQuotePage("quote-filled");
    await AsaCapsDatabase.putVehicle({
      id: "MMAGUKS10NH000001",
      vin: "MMAGUKS10NH000001",
      modelCode: "QF1W",
      rawText: "",
      firstSeen: "2026-10-20T00:00:00.000Z",
      lastSeen: "2026-10-20T00:00:00.000Z",
    });
    await captureQuote(extractQuoteContext(filled)!, extractQuoteRows(filled), "2026-10-20T03:30:00.000Z");
    await AsaCapsDatabase.putVehicle({
      id: "MMBOTHERVIN000002",
      vin: "MMBOTHERVIN000002",
      modelCode: "QF1W",
      rawText: "",
      firstSeen: "2026-10-20T00:00:00.000Z",
      lastSeen: "2026-10-20T00:00:00.000Z",
    });

    const [hub] = await suggestForQuote({ vin: "MMBOTHERVIN000002", model: "Pajero Sport" }, [
      { id: "a", description: "R/H/F HUB BEARING" },
    ]);
    expect(hub.suggestions[0]).toMatchObject({ partNumber: "MR992372", tier: "modelCode" });
  });
});
