// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { extractQuoteContext, extractQuoteRows } from "@/services/extractors/quoteRows";
import { captureQuote, suggestForQuote } from "@/services/quoteCapture/captureQuote";
import { copyAllText, suggestForLines, type SuggestionVehicle } from "@/services/quoteCapture/suggestions";
import type { PartFitment, Vehicle } from "@/types/asacaps";
import type { QuoteMapping } from "@/types/quoteMapping";
import { loadQuotePage } from "./partscheckFixtures";
import { fitment, mapping, newVin, vehicle, ym } from "./suggestionHelpers";

const KK1T_2011: SuggestionVehicle = { vin: newVin(), model: "Triton", modelCode: "KK1T", buildMonth: ym(2011, 8) };

function suggest(
  query: SuggestionVehicle,
  description: string,
  mappings: QuoteMapping[],
  catalogue: { vehicles?: Vehicle[]; fitments?: PartFitment[] } = {},
) {
  return suggestForLines(query, [{ id: "1", description }], mappings, {
    catalogue: { vehicles: catalogue.vehicles ?? [], fitments: catalogue.fitments ?? [] },
    limit: 5,
  })[0];
}
const levels = (line: ReturnType<typeof suggest>) => line.suggestions.map((s) => [s.partNumber, s.level]);

describe("reported bugs", () => {
  it("a 2011 Outlander is never offered a part used only on a 2018 Outlander", () => {
    const outlander2018 = mapping({ partNumber: "7450B111", model: "Outlander", vin: newVin("JMFXZGL3"), buildMonth: ym(2018, 3) });
    const query = { vin: newVin("JMFXTGF7"), model: "Outlander", buildMonth: ym(2011, 5) };
    // Same model name only: dropped.
    expect(suggest(query, "BONNET", [outlander2018]).suggestions).toEqual([]);
    // Different model codes in the catalogue: still nothing.
    const vehicles = [vehicle(query.vin, { modelCode: "CW5W" }), vehicle(outlander2018.vin!, { modelCode: "ZJ1W" })];
    expect(suggest(query, "BONNET", [outlander2018], { vehicles }).suggestions).toEqual([]);
  });

  it("an R/F shock absorber line is never offered the R/R shock", () => {
    const rearShock = mapping({
      repairerDescription: "R/R SHOCK ABSORBER",
      partNumber: "4162A429",
      eraDescription: "SHOCK ABSORBERRR SUSP",
      vin: KK1T_2011.vin,
    });
    expect(suggest(KK1T_2011, "R/F SHOCK ABSORBER", [rearShock]).suggestions).toEqual([]);
  });

  it("an R/F line matches an earlier R/F or RH FRONT line", () => {
    for (const earlier of ["R/F SHOCK ABSORBER", "RH FRONT SHOCK ABSORBER", "SHOCK ABSORBER R/H/F"]) {
      const frontShock = mapping({
        repairerDescription: earlier,
        partNumber: "4060A124", // even: RH by part-number parity, agreeing with the line
        eraDescription: "SHOCK ABSORBERFR SUSP",
        modelCode: "KK1T",
        buildMonth: ym(2011, 2),
      });
      expect(levels(suggest(KK1T_2011, "R/F SHOCK ABSORBER", [frontShock])), earlier).toEqual([["4060A124", "confirmed"]]);
    }
  });

  it("a part used on 2010 and 2013 KK1T cars is confirmed for a 2011 KK1T", () => {
    const stored = [
      mapping({ partNumber: "5900A001", modelCode: "KK1T", buildMonth: ym(2010, 1) }),
      mapping({ partNumber: "5900A001", modelCode: "KK1T", buildMonth: ym(2013, 6) }),
    ];
    const [s] = suggest(KK1T_2011, "BONNET", stored).suggestions;
    expect(s).toMatchObject({ partNumber: "5900A001", level: "confirmed", cautions: [], tier: "modelCode" });
    expect(s.evidence).toBe("used on 2 vehicles · KK1T Triton built 2010–2013, last 2026-10-01");
  });
});

describe("vehicle evidence", () => {
  it("same VIN is confirmed without date evidence", () => {
    const stored = [mapping({ vin: KK1T_2011.vin, buildMonth: undefined })];
    const [s] = suggest(KK1T_2011, "BONNET", stored).suggestions;
    expect(s).toMatchObject({ level: "confirmed", tier: "vin", evidence: "used on this vehicle (1 time), last 2026-10-01" });
  });

  it("same model code built within 12 months is confirmed", () => {
    const stored = [mapping({ modelCode: "KK1T", buildMonth: ym(2012, 7) })];
    expect(levels(suggest(KK1T_2011, "BONNET", stored))).toEqual([["5900A001", "confirmed"]]);
  });

  it("same model code without date evidence is only possible", () => {
    const stored = [mapping({ modelCode: "KK1T", buildMonth: ym(2016, 1) })];
    const [s] = suggest(KK1T_2011, "BONNET", stored).suggestions;
    expect(s).toMatchObject({ level: "possible", cautions: ["no vehicle built within 12 months"] });
    expect(s.evidence).toContain("(newer build)");
    const unknownBuild = suggest({ ...KK1T_2011, buildMonth: undefined }, "BONNET", stored).suggestions[0];
    expect(unknownBuild.cautions).toEqual(["build date unknown"]);
  });

  it("infers the model code from the VIN pattern only when the catalogue agrees on one", () => {
    const query = { vin: newVin("MMAGUKS1"), model: "Pajero Sport", buildMonth: ym(2022, 6) };
    const used = mapping({ vin: newVin("MMAGUKS1"), model: "Pajero Sport", buildMonth: ym(2022, 1) });
    const agreeing = [vehicle(newVin("MMAGUKS1"), { modelCode: "QF1W" }), vehicle(newVin("MMAGUKS1"), { modelCode: "QF1W" })];
    expect(levels(suggest(query, "BONNET", [used], { vehicles: agreeing }))).toEqual([["5900A001", "confirmed"]]);

    const conflicting = [...agreeing, vehicle(newVin("MMAGUKS1"), { modelCode: "QF2W" })];
    expect(suggest(query, "BONNET", [used], { vehicles: conflicting }).suggestions).toEqual([]);
    // VIN pattern alone, no model codes known: dropped.
    expect(suggest(query, "BONNET", [used]).suggestions).toEqual([]);
  });

  it("looks up a past vehicle's model code by VIN at suggestion time", () => {
    const pastVin = newVin("MMBXXXX1");
    const used = mapping({ vin: pastVin, modelCode: undefined, buildMonth: ym(2011, 1) });
    expect(levels(suggest(KK1T_2011, "BONNET", [used], { vehicles: [vehicle(pastVin, { modelCode: "KK1T" })] }))).toEqual([
      ["5900A001", "confirmed"],
    ]);
  });
});

describe("wording", () => {
  it("different wordings that normalise the same are exact", () => {
    const stored = [mapping({ repairerDescription: "LHR DR OUTSIDE HDL", partNumber: "5716A585", eraDescription: "HANDLERR DOOR OUTSIDE", modelCode: "KK1T", buildMonth: ym(2011, 1) })];
    expect(levels(suggest(KK1T_2011, "L/H REAR DOOR OUTER HANDLE", stored))).toEqual([["5716A585", "confirmed"]]);
  });

  it("a wording linked to the same part by another vehicle counts as exact", () => {
    const evidence = mapping({ repairerDescription: "L/H REAR DOOR OUTER HANDLE", partNumber: "5716A585", modelCode: "KK1T", buildMonth: ym(2011, 3) });
    const otherWording = mapping({ repairerDescription: "LH RR DOOR EXT HANDLE", partNumber: "5716A585", modelCode: "KL1T", vin: newVin("MMAXXXX2") });
    const line = suggest(KK1T_2011, "LH RR DOOR EXT HANDLE", [evidence, otherWording]);
    expect(levels(line)).toEqual([["5716A585", "confirmed"]]);
  });

  it("similar wording is only possible, and says what it was similar to", () => {
    const stored = [mapping({ repairerDescription: "L/H REAR DOOR OUTER HANDLE", partNumber: "5716A585", modelCode: "KK1T", buildMonth: ym(2011, 1) })];
    const [s] = suggest(KK1T_2011, "L/H REAR DOOR OUTER HANDLE ASSY", stored).suggestions;
    expect(s).toMatchObject({ level: "possible", cautions: ["similar wording"], similarWording: "L/H REAR DOOR OUTER HANDLE" });
  });

  it("never treats different positions as similar", () => {
    const stored = [mapping({ repairerDescription: "L/H/F GUARD LINER REAR", eraDescription: "SHIELDFR WHEELHOUSE SPLASHRR", modelCode: "KK1T", buildMonth: ym(2011, 1) })];
    expect(suggest(KK1T_2011, "L/H/F GUARD LINER FRONT", stored).suggestions).toEqual([]);
  });

  it("an unclear line gets nothing and is flagged", () => {
    const stored = [mapping({ repairerDescription: "R/LOWER CONTROL ARM", vin: KK1T_2011.vin })];
    expect(suggest(KK1T_2011, "R/LOWER CONTROL ARM", stored)).toMatchObject({ wordingUnclear: true, suggestions: [] });
  });

  it("an unclear past wording is never matched", () => {
    const stored = [mapping({ repairerDescription: "R LOWER CONTROL ARM", vin: KK1T_2011.vin })];
    expect(suggest(KK1T_2011, "LOWER CONTROL ARM", stored).suggestions).toEqual([]);
  });
});

describe("side", () => {
  const guard = (extra: Partial<QuoteMapping> = {}) =>
    mapping({ repairerDescription: "L/H/F GUARD", partNumber: "5220AX75", eraDescription: "FENDERFR LH", vin: KK1T_2011.vin, ...extra });

  it("never offers a handed part for the other side, or for a line with no side", () => {
    expect(suggest(KK1T_2011, "R/H/F GUARD", [guard()]).suggestions).toEqual([]);
    expect(suggest(KK1T_2011, "FRONT GUARD", [guard()]).suggestions).toEqual([]);
    expect(levels(suggest(KK1T_2011, "L/H/F GUARD", [guard()]))).toEqual([["5220AX75", "confirmed"]]);
  });

  it("a part only ever captured on L/H lines is left-hand: nothing for an R/H line", () => {
    const hubBearing = mapping({ repairerDescription: "L/H/F HUB BEARING", partNumber: "MR992372", eraDescription: "BEARINGFR WHEEL HUB", vin: KK1T_2011.vin });
    expect(suggest(KK1T_2011, "R/H/F HUB BEARING", [hubBearing]).suggestions).toEqual([]);
  });

  it("a part ASA lists without a side, or seen on both sides, is confirmed for either", () => {
    const hubBearing = mapping({ repairerDescription: "L/H/F HUB BEARING", partNumber: "MR992372", eraDescription: "BEARINGFR WHEEL HUB", vin: KK1T_2011.vin });
    const asa = { fitments: [fitment(newVin(), "MR992372", "BEARING,FR WHEEL HUB")] };
    expect(levels(suggest(KK1T_2011, "R/H/F HUB BEARING", [hubBearing], asa))).toEqual([["MR992372", "confirmed"]]);

    const rhLine = mapping({ repairerDescription: "R/H/F HUB BEARING", partNumber: "MR992372", eraDescription: "BEARINGFR WHEEL HUB", vin: newVin() });
    expect(levels(suggest(KK1T_2011, "R/H/F HUB BEARING", [hubBearing, rhLine]))[0]).toEqual(["MR992372", "confirmed"]);
  });

  it("a line asking for both sides is only possible", () => {
    const either = mapping({ repairerDescription: "FRONT WIPER BLADE", eraDescription: "BLADE,WINDSHIELD WIPER", vin: KK1T_2011.vin });
    const asa = { fitments: [fitment(newVin(), "5900A001", "BLADE,WINDSHIELD WIPER")] };
    const [s] = suggest(KK1T_2011, "L/H & R/H FRONT WIPER BLADE", [either], asa).suggestions;
    expect(s.level).toBe("possible");
  });
});

describe("conflicts", () => {
  it("two different part numbers confirmed for one line are both downgraded", () => {
    const stored = [
      mapping({ partNumber: "5900A001", vin: KK1T_2011.vin }),
      mapping({ partNumber: "5900A099", modelCode: "KK1T", buildMonth: ym(2011, 5) }),
    ];
    const line = suggest(KK1T_2011, "BONNET", stored);
    expect(levels(line)).toEqual([
      ["5900A001", "possible"],
      ["5900A099", "possible"],
    ]);
    expect(copyAllText([line])).toBe("");
  });
});

describe("never suggested", () => {
  it("NA rows, ERA ordering slips and the open quote itself", () => {
    const stored = [
      mapping({ partNumber: "NA", noGenuinePart: true, vin: KK1T_2011.vin }),
      mapping({ partNumber: "5900A002", sideConflict: true, vin: KK1T_2011.vin }),
      mapping({ partNumber: "5900A003", quoteKey: "draft:open", vin: KK1T_2011.vin }),
    ];
    const line = suggestForLines(KK1T_2011, [{ id: "1", description: "BONNET" }], stored, { excludeQuoteKey: "draft:open" })[0];
    expect(line.suggestions).toEqual([]);
  });
});

describe("ASA catalogue suggestions follow the same rules", () => {
  it("confirmed by ASA description on the same VIN", () => {
    const asa = { fitments: [fitment(KK1T_2011.vin!, "5716A585", "HANDLE,RR DOOR OUTSIDE,LH")] };
    const [s] = suggest(KK1T_2011, "L/H REAR DOOR OUTER HANDLE", [], asa).suggestions;
    expect(s).toMatchObject({ partNumber: "5716A585", source: "catalogue", level: "confirmed", evidence: "seen in ASA CAPS for this vehicle, last 2026-10-01" });
  });

  it("confirmed by same model code with a near build, never by model name alone", () => {
    const near = newVin("MMBXXXX3");
    const sameNameOnly = newVin("MMBXXXX4");
    const vehicles = [
      vehicle(near, { modelCode: "KK1T", productionFrom: "2011.3.1" }),
      vehicle(sameNameOnly, { productionFrom: "2011.3.1" }),
    ];
    const asa = (vin: string) => ({ vehicles, fitments: [fitment(vin, "5900A001", "HOOD")] });
    expect(levels(suggest(KK1T_2011, "HOOD", [], asa(near)))).toEqual([["5900A001", "confirmed"]]);
    expect(suggest(KK1T_2011, "HOOD", [], asa(sameNameOnly)).suggestions).toEqual([]);
  });

  it("the side must agree with the ASA description", () => {
    const asa = { fitments: [fitment(KK1T_2011.vin!, "5716A585", "HANDLE,RR DOOR OUTSIDE,LH")] };
    expect(suggest(KK1T_2011, "R/H REAR DOOR OUTER HANDLE", [], asa).suggestions).toEqual([]);
  });

  it("a confirmed catalogue match beats a possible quote match for the same part", () => {
    const quote = mapping({ modelCode: "KK1T", buildMonth: ym(2018, 1) }); // too far: possible
    const asa = { fitments: [fitment(KK1T_2011.vin!, "5900A001", "BONNET")] };
    const [s] = suggest(KK1T_2011, "BONNET", [quote], asa).suggestions;
    expect(s).toMatchObject({ source: "catalogue", level: "confirmed" });
  });
});

describe("ordering and copy all", () => {
  it("a confirmed part comes before possible ones", () => {
    const stored = [
      mapping({ partNumber: "POSSIBLE", modelCode: "KK1T", buildMonth: ym(2019, 1) }),
      mapping({ partNumber: "VIN", vin: KK1T_2011.vin }),
    ];
    expect(levels(suggest(KK1T_2011, "BONNET", stored))).toEqual([
      ["VIN", "confirmed"],
      ["POSSIBLE", "possible"],
    ]);
  });

  it("among possible parts, same VIN before model code", () => {
    const stored = [
      mapping({ partNumber: "CODE", modelCode: "KK1T", buildMonth: ym(2011, 6) }),
      mapping({ partNumber: "VIN", vin: KK1T_2011.vin }),
    ];
    expect(suggest(KK1T_2011, "BONNET", stored).suggestions.map((s) => [s.partNumber, s.tier])).toEqual([
      ["VIN", "vin"],
      ["CODE", "modelCode"],
    ]);
  });

  it("copy all uses confirmed suggestions only, blank otherwise", () => {
    const stored = [
      mapping({ repairerDescription: "BONNET", partNumber: "5900A001", vin: KK1T_2011.vin }),
      mapping({ repairerDescription: "GRILLE", partNumber: "7450A001", modelCode: "KK1T", buildMonth: ym(2019, 1) }),
    ];
    const lines = suggestForLines(KK1T_2011, [
      { id: "1", description: "BONNET" },
      { id: "2", description: "GRILLE" },
      { id: "3", description: "TOW BAR" },
    ], stored);
    expect(lines[1].suggestions[0].level).toBe("possible");
    expect(copyAllText(lines)).toBe("5900A001\n\n");
  });
});

describe("suggestForQuote — from the captured real quote", () => {
  beforeEach(async () => {
    await AsaCapsDatabase.resetForTests();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  async function captureAndCatalogue() {
    const filled = loadQuotePage("quote-filled");
    // The captured Pajero Sport is in the ASA catalogue as QF1W.
    await AsaCapsDatabase.putVehicle(vehicle("MMAGUKS10NH000001", { model: "PAJERO SPORT", modelCode: "QF1W" }));
    await captureQuote(extractQuoteContext(filled)!, extractQuoteRows(filled), "2026-10-20T03:30:00.000Z");
  }

  it("confirms the same wording for another QF1W built in the same year", async () => {
    await captureAndCatalogue();
    const lines = extractQuoteRows(loadQuotePage("quote-empty")).map((r) => ({ id: r.draftItemId, description: r.repairerDescription }));
    const result = await suggestForQuote({ vin: "MMAGUKS10NH000999", model: "Pajero Sport", mthYr: "3/2022" }, lines, "draft:new");
    const top = Object.fromEntries(result.map((l) => [l.description, l.suggestions[0] && [l.suggestions[0].partNumber, l.suggestions[0].level]]));
    expect(top["L/H/F GUARD"]).toEqual(["5220AX75", "confirmed"]);
    // ERA says KNUCKLE,LH but 3870A180 is even: parity disagrees, so only possible.
    expect(top["L/H/F STEERING KNUCKLE"]).toEqual(["3870A180", "possible"]);
    expect(top["L/H/F HUB NUT"]).toBeUndefined(); // NA
    expect(result.find((l) => l.description === "L/H/F GUARD")!.suggestions[0].evidence).toBe(
      "used on 1 vehicle · QF1W Pajero Sport built 2022, last 2026-10-20",
    );
  });

  it("mirrored to the right side: nothing, since every captured part is left-hand", async () => {
    await captureAndCatalogue();
    const lines = extractQuoteRows(loadQuotePage("quote-empty")).map((r) => ({
      id: r.draftItemId,
      description: r.repairerDescription.replace(/L\/H/g, "R/H"),
    }));
    const result = await suggestForQuote({ vin: "MMAGUKS10NH000999", model: "Pajero Sport", mthYr: "3/2022" }, lines, "draft:new");
    const top = Object.fromEntries(result.map((l) => [l.description, l.suggestions[0] && [l.suggestions[0].partNumber, l.suggestions[0].level]]));
    expect(top["R/H/F GUARD"]).toBeUndefined();
    expect(top["R/H/F STEERING KNUCKLE"]).toBeUndefined();
    expect(top["R/H/F HUB BEARING"]).toBeUndefined();
    expect(result.every((l) => l.suggestions.length === 0)).toBe(true);
  });

  it("offers nothing for a different model without the catalogue", async () => {
    const filled = loadQuotePage("quote-filled");
    await captureQuote(extractQuoteContext(filled)!, extractQuoteRows(filled), "2026-10-20T03:30:00.000Z");
    const [guard] = await suggestForQuote({ vin: "MMAGUKS10NH000999", model: "Pajero Sport", mthYr: "3/2022" }, [
      { id: "a", description: "L/H/F GUARD" },
    ]);
    expect(guard.suggestions).toEqual([]);
  });
});
