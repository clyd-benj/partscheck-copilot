import { describe, it, expect } from "vitest";
import { suggestForLines, type SuggestionVehicle } from "@/services/quoteCapture/suggestions";
import { checkVariants } from "@/services/quoteCapture/variants";
import { parseAsaProductionDay } from "@/services/quoteCapture/buildDate";
import type { PartFitment, Vehicle } from "@/types/asacaps";
import { fitment, newVin, vehicle } from "./suggestionHelpers";

/** Builds a catalogue: each entry is one vehicle with the part copied in ASA CAPS. */
function catalogue(entries: { part: string; description: string; vehicle: Partial<Vehicle>; vin?: string }[]) {
  const vehicles: Vehicle[] = [];
  const fitments: PartFitment[] = [];
  for (const entry of entries) {
    const vin = entry.vin ?? newVin("MMBXXXX1");
    vehicles.push(vehicle(vin, entry.vehicle));
    fitments.push(fitment(vin, entry.part, entry.description));
  }
  return { vehicles, fitments };
}

function confirmedFor(query: SuggestionVehicle, line: string, data: ReturnType<typeof catalogue>) {
  return suggestForLines(query, [{ id: "1", description: line }], [], { catalogue: data, limit: 5 })[0]
    .suggestions.filter((s) => s.level === "confirmed")
    .map((s) => s.partNumber);
}

const day = (date: string) => parseAsaProductionDay(date)!;
const month = (date: string) => Math.floor(day(date) / 31);
const at = (date: string, extra: Partial<SuggestionVehicle> = {}): SuggestionVehicle => ({
  buildMonth: month(date),
  productionDate: date,
  ...extra,
});

describe("Eclipse Cross FACE,FR BUMPER: 62022W410P / 62022W430P split by build date", () => {
  // The user's catalogue (PNC 62040). Same trim and year on GK1W, different part.
  const gk1w = (vin: string, productionFrom: string) => ({
    vin,
    vehicle: { model: "ECLIPSE CROSS", modelCode: "GK1W", classification: "XTHUR8", productionFrom },
  });
  const gl3w = (vin: string, productionFrom: string) => ({
    vin,
    vehicle: { model: "ECLIPSE CROSS", modelCode: "GL3W", productionFrom },
  });
  const face = "FACE,FR BUMPER";
  const data = catalogue([
    { part: "62022W410P", description: face, ...gk1w("JMFXTGK1WMZ002908", "2021.3.10") },
    { part: "62022W410P", description: face, ...gl3w("JMFXDGL3WNZ001088", "2021.8.2") },
    { part: "62022W430P", description: face, ...gk1w("JMFXTGK1WNZ001287", "2021.10.20") },
    { part: "62022W430P", description: face, ...gk1w("JMFXTGK1WRZ008197", "2024.2.1") },
    { part: "62022W430P", description: face, ...gl3w("JMFXDGL3WNZ003769", "2022.4.5") },
    { part: "62022W430P", description: face, ...gl3w("JMFXDGL3WPZ002616", "2023.3.1") },
    { part: "62022W430P", description: face, ...gl3w("JMFXDGL3WPZ002058", "2023.1.9") },
  ]);
  const GK1W = { modelCode: "GK1W", classification: "XTHUR8" };
  const LINE = "FRONT BUMPER FACE";

  it("each number confirms only on its own side of the changeover", () => {
    expect(confirmedFor(at("2020.12.1", GK1W), LINE, data)).toEqual(["62022W410P"]);
    expect(confirmedFor(at("2021.3.10", GK1W), LINE, data)).toEqual(["62022W410P"]);
    expect(confirmedFor(at("2022.3.1", GK1W), LINE, data)).toEqual(["62022W430P"]);
    expect(confirmedFor(at("2024.6.1", GK1W), LINE, data)).toEqual(["62022W430P"]);
    expect(confirmedFor(at("2022.6.1", { modelCode: "GL3W" }), LINE, data)).toEqual(["62022W430P"]);
    // Four days before the first GL3W 430P build, after the last GL3W 410P: the changeover gap.
    expect(confirmedFor(at("2022.4.1", { modelCode: "GL3W" }), LINE, data)).toEqual([]);
  });

  it("the 12-month window never reaches across the changeover", () => {
    // 2022-03 is within 12 months of the 2021-03 410P build: without the split it would
    // count as date evidence for 410P too (and the two would cancel out).
    const [line] = suggestForLines(at("2022.3.1", GK1W), [{ id: "1", description: LINE }], [], {
      catalogue: data,
    });
    expect(line.suggestions.find((s) => s.partNumber === "62022W410P")).toMatchObject({
      level: "possible",
      cautions: ["varies by build date: other part for this vehicle"],
    });
  });

  it("between the last 410P and the first 430P build is unknown: nothing", () => {
    expect(confirmedFor(at("2021.7.1", GK1W), LINE, data)).toEqual([]);
  });

  it("no confirmed suggestion until the vehicle's ASA production date is known", () => {
    expect(confirmedFor({ ...GK1W, buildMonth: month("2022.3.1") }, LINE, data)).toEqual([]);
  });
});

describe("trim and colour splits", () => {
  const kk1t = (classification: string, productionFrom: string, exteriorColor = "W37") => ({
    model: "TRITON",
    modelCode: "KK1T",
    classification,
    exteriorColor,
    productionFrom,
  });

  it("confirms only for the same trim; an unseen trim gets nothing", () => {
    // Interleaved build dates, so only the trim separates them.
    const data = catalogue([
      { part: "6402A001", description: "GRILLE,RADIATOR", vehicle: kk1t("XTSHR8", "2021.1.5") },
      { part: "6402A002", description: "GRILLE,RADIATOR", vehicle: kk1t("XTSLR8", "2021.3.5") },
      { part: "6402A001", description: "GRILLE,RADIATOR", vehicle: kk1t("XTSHR8", "2021.5.5") },
      { part: "6402A002", description: "GRILLE,RADIATOR", vehicle: kk1t("XTSLR8", "2021.7.5") },
    ]);
    const query = (classification: string) => at("2021.6.1", { modelCode: "KK1T", classification });
    expect(confirmedFor(query("XTSHR8"), "RADIATOR GRILLE", data)).toEqual(["6402A001"]);
    expect(confirmedFor(query("XTSLR8"), "RADIATOR GRILLE", data)).toEqual(["6402A002"]);
    expect(confirmedFor(query("GLXR8"), "RADIATOR GRILLE", data)).toEqual([]);
  });

  it("colour-suffix numbers confirm only for the same exterior colour", () => {
    const data = catalogue([
      { part: "7407A123XA", description: "GARNISH,FR BUMPER,LH", vehicle: kk1t("XTSHR8", "2021.1.5", "X42A") },
      { part: "7407A123HA", description: "GARNISH,FR BUMPER,LH", vehicle: kk1t("XTSHR8", "2021.3.5", "W37") },
      { part: "7407A123XA", description: "GARNISH,FR BUMPER,LH", vehicle: kk1t("XTSHR8", "2021.5.5", "X42A") },
    ]);
    const query = (exteriorColour?: string) =>
      at("2021.4.1", { modelCode: "KK1T", classification: "XTSHR8", exteriorColour });
    expect(confirmedFor(query("X42A"), "L/H/F BUMPER GARNISH", data)).toEqual(["7407A123XA"]);
    expect(confirmedFor(query("W37"), "L/H/F BUMPER GARNISH", data)).toEqual(["7407A123HA"]);
    expect(confirmedFor(query("U17"), "L/H/F BUMPER GARNISH", data)).toEqual([]);
    expect(confirmedFor(query(undefined), "L/H/F BUMPER GARNISH", data)).toEqual([]);
  });

  it("no clean split: never confirmed for that wording and model code", () => {
    // Same trim, interleaved dates, and not colour variants (colour can't be what separates them).
    const data = catalogue([
      { part: "6400A001", description: "HOOD", vehicle: kk1t("XTSHR8", "2021.1.5", "X42A") },
      { part: "6400A002", description: "HOOD", vehicle: kk1t("XTSHR8", "2021.3.5", "W37") },
      { part: "6400A001", description: "HOOD", vehicle: kk1t("XTSHR8", "2021.5.5", "X42A") },
    ]);
    for (const exteriorColour of ["X42A", "W37"]) {
      expect(
        confirmedFor(at("2021.4.1", { modelCode: "KK1T", classification: "XTSHR8", exteriorColour }), "BONNET", data),
      ).toEqual([]);
    }
  });

  it("a split must hold for every answer: a missing value means no split on that dimension", () => {
    const check = checkVariants(
      [
        { partNumber: "A", vin: "1", classification: "X", productionDay: 10 },
        { partNumber: "B", vin: "2", productionDay: 20 },
      ],
      { classification: "X", productionDay: 25 },
    );
    expect(check.splits).toEqual(["build date"]);
    expect(check.veto("B")).toBeUndefined();
    expect(check.veto("A")).toBe("varies by build date: other part for this vehicle");
  });

  it("one part number per wording doesn't vary", () => {
    const check = checkVariants([{ partNumber: "A", vin: "1" }, { partNumber: "a", vin: "2" }], {});
    expect(check.varies).toBe(false);
    expect(check.veto("A")).toBeUndefined();
  });
});
