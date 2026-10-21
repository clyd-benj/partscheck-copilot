import { describe, it, expect } from "vitest";
import { suggestForLines, type SuggestionVehicle } from "@/services/quoteCapture/suggestions";
import type { QuoteMapping } from "@/types/quoteMapping";
import { fitment, mapping, newVin, vehicle, ym } from "./suggestionHelpers";

const QUERY: SuggestionVehicle = { vin: newVin(), model: "Triton", modelCode: "KK1T", buildMonth: ym(2022, 6) };
const rank = (query: SuggestionVehicle, mappings: QuoteMapping[]) =>
  suggestForLines(query, [{ id: "1", description: "BONNET" }], mappings, { limit: 5 })[0].suggestions;
const kk1t = (partNumber: string, buildMonth?: number, extra: Partial<QuoteMapping> = {}) =>
  mapping({ partNumber, modelCode: "KK1T", buildMonth, ...extra });

describe("build-date evidence and ranking", () => {
  it("ranks the closest build first, ahead of vehicle count (two matches: both possible)", () => {
    const stored = [
      kk1t("FAR", ym(2021, 7)),
      kk1t("FAR", ym(2021, 8)),
      kk1t("FAR", ym(2021, 9)),
      kk1t("NEAR", ym(2022, 4)),
    ];
    expect(rank(QUERY, stored).map((s) => [s.partNumber, s.level, s.buildGap, s.vehicleCount])).toEqual([
      ["NEAR", "possible", 2, 1],
      ["FAR", "possible", 9, 3],
    ]);
  });

  it("builds on both sides of this one are date evidence even when both are far", () => {
    const stored = [kk1t("SPAN", ym(2019, 1)), kk1t("SPAN", ym(2025, 1))];
    expect(rank(QUERY, stored)[0]).toMatchObject({ level: "confirmed", buildGap: 31 });
  });

  it("a far build on one side only is possible, flagged older/newer", () => {
    const [older] = rank(QUERY, [kk1t("OLD", ym(2020, 5))]);
    expect(older).toMatchObject({ level: "possible", buildGap: 25 });
    expect(older.evidence).toBe("used on 1 vehicle · KK1T Triton built 2020 (older build), last 2026-10-01");

    const [newer] = rank({ ...QUERY, buildMonth: ym(2016, 1) }, [kk1t("NEW", ym(2018, 2))]);
    expect(newer.evidence).toBe("used on 1 vehicle · KK1T Triton built 2018 (newer build), last 2026-10-01");
  });

  it("exactly 12 months away still counts; 13 doesn't", () => {
    expect(rank(QUERY, [kk1t("A", ym(2021, 6))])[0].level).toBe("confirmed");
    expect(rank(QUERY, [kk1t("B", ym(2021, 5))])[0].level).toBe("possible");
  });

  it("puts undated parts after dated ones, and an undated part is only possible", () => {
    const stored = [kk1t("UNDATED"), kk1t("UNDATED"), kk1t("DATED", ym(2022, 1))];
    expect(rank(QUERY, stored).map((s) => [s.partNumber, s.level])).toEqual([
      ["DATED", "confirmed"],
      ["UNDATED", "possible"],
    ]);
  });

  it("uses Mth/Yr on mappings captured before build months were stored", () => {
    expect(rank(QUERY, [kk1t("OLD-RECORD", undefined, { mthYr: "1/2022" })])[0]).toMatchObject({
      level: "confirmed",
      buildGap: 5,
    });
  });

  it("shows the build range of the vehicles behind the suggestion", () => {
    const stored = [kk1t("P", ym(2021, 9)), kk1t("P", ym(2022, 2)), kk1t("P", ym(2022, 8))];
    expect(rank(QUERY, stored)[0].evidence).toBe("used on 3 vehicles · KK1T Triton built 2021–2022, last 2026-10-01");
  });

  it("uses ASA production dates for catalogue suggestions", () => {
    const near = newVin("MMBXXXX5");
    const far = newVin("MMBXXXX6");
    const result = suggestForLines(QUERY, [{ id: "1", description: "HOOD" }], [], {
      catalogue: {
        vehicles: [
          vehicle(near, { modelCode: "KK1T", productionFrom: "2021.11.30" }),
          vehicle(far, { modelCode: "KK1T", productionFrom: "2015.4.1" }),
        ],
        fitments: [fitment(near, "NEAR", "HOOD"), fitment(far, "FAR", "HOOD")],
      },
    })[0].suggestions;
    expect(result.map((s) => [s.partNumber, s.source, s.level, s.buildGap])).toEqual([
      ["NEAR", "catalogue", "confirmed", 7],
      ["FAR", "catalogue", "possible", 86],
    ]);
    expect(result[0].evidence).toBe("seen in ASA CAPS on 1 vehicle · KK1T TRITON built 2021, last 2026-10-01");
  });
});
