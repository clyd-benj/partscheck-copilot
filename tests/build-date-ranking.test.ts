import { describe, it, expect } from "vitest";
import { suggestForLines, type SuggestionVehicle } from "@/services/quoteCapture/suggestions";
import { normaliseDescription, parseSide } from "@/services/quoteCapture/normalise";
import type { QuoteMapping } from "@/types/quoteMapping";

const ym = (year: number, month: number) => year * 12 + month;

let seq = 0;
function mapping(overrides: Partial<QuoteMapping>): QuoteMapping {
  seq += 1;
  const repairerDescription = overrides.repairerDescription ?? "BONNET";
  return {
    id: `draft:${seq}::1`,
    quoteKey: `draft:${seq}`,
    rowNo: 1,
    iteration: 0,
    draftItemId: String(seq),
    repairerDescription,
    repairerNormalised: normaliseDescription(repairerDescription),
    side: parseSide(repairerDescription),
    partNumber: "5900A001",
    eraDescription: "HOOD",
    noGenuinePart: false,
    isAccessory: false,
    sideConflict: false,
    vin: `MMBXXXXXXXX${String(seq).padStart(6, "0")}`,
    model: "Triton",
    firstSeen: "2026-10-01T00:00:00.000Z",
    lastSeen: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const TRITON: SuggestionVehicle = { vin: "MMAJYKL10PH999999", model: "Triton", buildMonth: ym(2022, 6) };
const rank = (vehicle: SuggestionVehicle, mappings: QuoteMapping[], limit = 5) =>
  suggestForLines(vehicle, [{ id: "1", description: "BONNET" }], mappings, { limit })[0].suggestions;

describe("build-date ranking", () => {
  it("ranks the closest build first within a tier, ahead of vehicle count", () => {
    const stored = [
      mapping({ partNumber: "OLD", buildMonth: ym(2016, 3) }),
      mapping({ partNumber: "OLD", buildMonth: ym(2016, 5) }),
      mapping({ partNumber: "OLD", buildMonth: ym(2016, 8) }),
      mapping({ partNumber: "NEW", buildMonth: ym(2022, 1) }),
    ];
    const ranked = rank(TRITON, stored);
    expect(ranked.map((s) => [s.partNumber, s.buildGap, s.vehicleCount])).toEqual([
      ["NEW", 5, 1],
      ["OLD", 70, 3],
    ]);
  });

  it("never filters: a far-off build is still suggested", () => {
    const ranked = rank(TRITON, [mapping({ partNumber: "OLD", buildMonth: ym(2008, 1) })]);
    expect(ranked.map((s) => s.partNumber)).toEqual(["OLD"]);
  });

  it("doesn't override the vehicle tier", () => {
    const stored = [
      mapping({ partNumber: "SAME-CODE-OLD", modelCode: "KK1T", buildMonth: ym(2015, 1) }),
      mapping({ partNumber: "MODEL-CLOSE", buildMonth: ym(2022, 6) }),
    ];
    const ranked = rank({ ...TRITON, modelCode: "KK1T" }, stored);
    expect(ranked.map((s) => [s.partNumber, s.tier])).toEqual([
      ["SAME-CODE-OLD", "modelCode"],
      ["MODEL-CLOSE", "model"],
    ]);
  });

  it("puts undated suggestions after dated ones in the same tier", () => {
    const stored = [
      mapping({ partNumber: "UNDATED" }),
      mapping({ partNumber: "UNDATED" }),
      mapping({ partNumber: "DATED", buildMonth: ym(2019, 1) }),
    ];
    expect(rank(TRITON, stored).map((s) => s.partNumber)).toEqual(["DATED", "UNDATED"]);
  });

  it("falls back to the existing order when the quoted vehicle has no build date", () => {
    const stored = [
      mapping({ partNumber: "CLOSE-BUT-RARE", buildMonth: ym(2022, 6) }),
      mapping({ partNumber: "COMMON", buildMonth: ym(2012, 1) }),
      mapping({ partNumber: "COMMON", buildMonth: ym(2012, 2) }),
    ];
    const ranked = rank({ ...TRITON, buildMonth: undefined }, stored);
    expect(ranked.map((s) => [s.partNumber, s.buildGap])).toEqual([
      ["COMMON", undefined],
      ["CLOSE-BUT-RARE", undefined],
    ]);
  });

  it("uses Mth/Yr on mappings captured before build months were stored", () => {
    const stored = [
      mapping({ partNumber: "OLD", mthYr: "1/2014" }),
      mapping({ partNumber: "OLD", mthYr: "2/2014" }),
      mapping({ partNumber: "NEW", mthYr: "06/2022" }),
    ];
    expect(rank(TRITON, stored).map((s) => [s.partNumber, s.buildGap])).toEqual([
      ["NEW", 0],
      ["OLD", 100],
    ]);
  });
});

describe("build range in the evidence", () => {
  it("shows the build years of the vehicles the part was used on", () => {
    const stored = [2021, 2022, 2022].map((year, i) =>
      mapping({ partNumber: "5900A001", modelCode: "KK1T", buildMonth: ym(year, 3 + i) }),
    );
    const [s] = rank({ ...TRITON, modelCode: "KK1T" }, stored);
    expect(s.evidence).toBe("used on 3 vehicles · KK1T Triton built 2021–2022, last 2026-10-01");
  });

  it("shows a single year once", () => {
    const [s] = rank(TRITON, [mapping({ buildMonth: ym(2022, 2) })]);
    expect(s.evidence).toBe("used on 1 vehicle · Triton built 2022, last 2026-10-01");
  });

  it("flags builds more than 24 months older or newer", () => {
    const [older] = rank(TRITON, [mapping({ buildMonth: ym(2020, 5) })]);
    expect(older.buildGap).toBe(25);
    expect(older.evidence).toBe("used on 1 vehicle · Triton built 2020 (older build), last 2026-10-01");

    const [newer] = rank({ ...TRITON, buildMonth: ym(2016, 1) }, [mapping({ buildMonth: ym(2018, 2) })]);
    expect(newer.evidence).toBe("used on 1 vehicle · Triton built 2018 (newer build), last 2026-10-01");
  });

  it("doesn't flag a gap of exactly 24 months", () => {
    const [s] = rank(TRITON, [mapping({ buildMonth: ym(2020, 6) })]);
    expect(s.evidence).toBe("used on 1 vehicle · Triton built 2020, last 2026-10-01");
  });

  it("says nothing about builds when no record has a date", () => {
    const [s] = rank(TRITON, [mapping({})]);
    expect(s.evidence).toBe("used on 1 vehicle · Triton, last 2026-10-01");
  });
});
