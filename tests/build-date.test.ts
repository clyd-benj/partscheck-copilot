import { describe, it, expect } from "vitest";
import {
  buildYear,
  formatBuildMonth,
  parseAsaProductionDate,
  parseBuildMonthText,
  parsePartsCheckMthYr,
  vehicleBuildMonth,
} from "@/services/quoteCapture/buildDate";

describe("parseAsaProductionDate", () => {
  it.each([
    ["2010.12.3", 2010 * 12 + 12],
    ["2022.6.15", 2022 * 12 + 6],
    ["2022.06.15", 2022 * 12 + 6],
    ["2022.6", 2022 * 12 + 6],
    [" 2019.1.1 ", 2019 * 12 + 1],
  ])("%s → %i", (value, expected) => {
    expect(parseAsaProductionDate(value)).toBe(expected);
  });

  it.each([[""], [undefined], ["2022.13.1"], ["2022.0.1"], ["12/2022"], ["2022"], ["abc"], ["1800.1.1"]])(
    "%s → undefined",
    (value) => {
      expect(parseAsaProductionDate(value)).toBeUndefined();
    },
  );
});

describe("parsePartsCheckMthYr", () => {
  it.each([
    ["6/2022", 2022 * 12 + 6],
    ["06/2022", 2022 * 12 + 6],
    ["12/2022", 2022 * 12 + 12],
    ["6 / 2022", 2022 * 12 + 6],
  ])("%s → %i", (value, expected) => {
    expect(parsePartsCheckMthYr(value)).toBe(expected);
  });

  it.each([[""], [undefined], ["13/2022"], ["0/2022"], ["2022"], ["6/22"], ["2010.12.3"], ["June 2022"]])(
    "%s → undefined",
    (value) => {
      expect(parsePartsCheckMthYr(value)).toBeUndefined();
    },
  );
});

describe("vehicleBuildMonth", () => {
  it("prefers the ASA CAPS production date", () => {
    expect(vehicleBuildMonth({ productionFrom: "2010.12.3" }, "6/2022")).toEqual({
      month: 2010 * 12 + 12,
      source: "asacaps",
    });
  });

  it("falls back to PartsCheck Mth/Yr", () => {
    expect(vehicleBuildMonth(undefined, "6/2022")).toEqual({ month: 2022 * 12 + 6, source: "partscheck" });
    expect(vehicleBuildMonth({ productionFrom: "garbled" }, "06/2022")).toEqual({
      month: 2022 * 12 + 6,
      source: "partscheck",
    });
  });

  it("is undefined when neither is usable", () => {
    expect(vehicleBuildMonth(undefined, undefined)).toBeUndefined();
    expect(vehicleBuildMonth({ productionFrom: "" }, "")).toBeUndefined();
  });
});

describe("buildYear", () => {
  it("keeps December in its own year", () => {
    expect(buildYear(2010 * 12 + 12)).toBe(2010);
    expect(buildYear(2022 * 12 + 1)).toBe(2022);
  });
});

describe("formatBuildMonth / parseBuildMonthText", () => {
  it("round-trips through the CSV form", () => {
    expect(formatBuildMonth(2022 * 12 + 6)).toBe("2022-06");
    expect(formatBuildMonth(2010 * 12 + 12)).toBe("2010-12");
    expect(parseBuildMonthText("2022-06")).toBe(2022 * 12 + 6);
    expect(parseBuildMonthText("2010-12")).toBe(2010 * 12 + 12);
    expect(parseBuildMonthText("")).toBeUndefined();
    expect(parseBuildMonthText("2022-13")).toBeUndefined();
  });
});
