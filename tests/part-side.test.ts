import { describe, it, expect } from "vitest";
import {
  neighbourPartNumbers,
  parityHand,
  readEraSide,
  resolvePartSides,
  type PartSideEvidence,
} from "@/services/quoteCapture/partSide";
import { suggestForLines, type SuggestionVehicle } from "@/services/quoteCapture/suggestions";
import type { Side } from "@/types/quoteMapping";
import type { PartFitment } from "@/types/asacaps";
import type { QuoteMapping } from "@/types/quoteMapping";
import { fitment, mapping, newVin, ym } from "./suggestionHelpers";

function resolve(parts: Record<string, Partial<PartSideEvidence>>) {
  const evidence = new Map(
    Object.entries(parts).map(([pn, e]) => [
      pn,
      { eraDescriptions: [], lineSides: [] as Side[], asaDescriptions: [], ...e },
    ]),
  );
  return Object.fromEntries(resolvePartSides(evidence));
}

describe("readEraSide", () => {
  it("finds a side at the end of a glued word", () => {
    expect(readEraSide("KNUCKLELH")).toMatchObject({ clean: "LH", inner: "NONE" });
    expect(readEraSide("STEP ASSYSIDELH")).toMatchObject({ clean: "LH" });
    expect(readEraSide("FENDERFR LH")).toMatchObject({ clean: "LH" });
  });

  it("finds a side glued inside a word, separately (it may be a false hit)", () => {
    expect(readEraSide("MOULDINGRR WHEEL ARCHLHBLAC")).toEqual({ clean: "NONE", inner: "LH", maybeTruncated: false });
  });

  it("ignores real words that contain LH/RH", () => {
    expect(readEraSide("SHIELDFR WHEELHOUSE SPLASHFR")).toMatchObject({ clean: "NONE", inner: "NONE" });
  });

  it("flags long sideless text as possibly truncated", () => {
    expect(readEraSide("PANEL ASSYFR DOOR OUTER SKI").maybeTruncated).toBe(true);
    expect(readEraSide("BEARINGFR WHEEL HUB").maybeTruncated).toBe(false);
  });
});

describe("parityHand", () => {
  it.each([
    ["6400J531", "LH"],
    ["6400J532", "RH"],
    ["5220K573", "LH"],
    ["5220K574", "RH"],
    ["7400A539", "LH"],
    ["5220AX75", "LH"],
    ["6400J531XA", "LH"],
    ["6400J532HA", "RH"],
    ["MR992371", "LH"],
    ["MN123456", "RH"],
    ["7812A512", "RH"], // parity's guess; a learned pair overrides it (below)
  ])("%s → %s", (pn, hand) => {
    expect(parityHand(pn)).toBe(hand);
  });

  it.each([["63113W190P"], ["96111A000P"], ["MZ330934"], ["NA"], ["TRITON BAGDE"]])("%s → not applied", (pn) => {
    expect(parityHand(pn)).toBeUndefined();
  });

  it("finds n±1 neighbours keeping width and colour suffix", () => {
    expect(neighbourPartNumbers("7812A512")).toEqual(["7812A511", "7812A513"]);
    expect(neighbourPartNumbers("6400J531XA")).toEqual(["6400J530XA", "6400J532XA"]);
    expect(neighbourPartNumbers("63113W190P")).toEqual([]);
  });
});

describe("resolvePartSides", () => {
  it("a glued-in side counts when the repairer line agrees", () => {
    expect(resolve({ "7400A538": { eraDescriptions: ["MOULDINGRR WHEEL ARCHLHBLAC"], lineSides: ["LH"] } })["7400A538"]).toEqual({
      hand: "LH",
      weak: "part-number pairing disagrees",
    });
  });

  it("a glued-in side counts when parity agrees, otherwise it's unknown", () => {
    const era = { eraDescriptions: ["MOULDINGRR WHEEL ARCHLHBLAC"], lineSides: ["NONE" as Side] };
    expect(resolve({ "7400A539": era })["7400A539"]).toEqual({ hand: "LH" });
    expect(resolve({ "7400A538": era })["7400A538"]).toEqual({ hand: "UNKNOWN" });
  });

  it("conflicting sources are a conflict", () => {
    expect(resolve({ P: { eraDescriptions: ["FENDERFR LH"], asaDescriptions: ["FENDER,FR RH"] } }).P.hand).toBe("CONFLICT");
    expect(resolve({ P: { eraDescriptions: ["FENDERFR LH"], lineSides: ["RH"] } }).P.hand).toBe("CONFLICT");
    expect(resolve({ P: { eraDescriptions: ["MOULDINGRR WHEEL ARCHLHBLAC"], lineSides: ["RH"] } }).P.hand).toBe("CONFLICT");
  });

  it("NONE only when no source names a side", () => {
    expect(resolve({ MR992372: { lineSides: ["LH"], asaDescriptions: ["BEARING,FR WHEEL HUB"] } }).MR992372).toEqual({ hand: "NONE" });
    expect(resolve({ MR992372: { lineSides: ["LH", "RH"] } }).MR992372).toEqual({ hand: "NONE" });
    expect(resolve({ P: { eraDescriptions: ["HOOD"], lineSides: ["NONE"] } }).P).toEqual({ hand: "NONE" });
    // A repairer's L/H line alone makes the part left-hand.
    expect(resolve({ "40202W030P": { eraDescriptions: ["HUB ASSYFR WHEEL"], lineSides: ["LH"] } })["40202W030P"]).toEqual({ hand: "LH" });
  });

  it("text cut short before the side: parity breaks the tie, weakly; otherwise unknown", () => {
    const truncated = { eraDescriptions: ["PANEL ASSYFR DOOR OUTER SKI"], lineSides: ["NONE" as Side] };
    expect(resolve({ "5700A123": truncated })["5700A123"]).toEqual({ hand: "LH", weak: "side from part number only" });
    expect(resolve({ "57000A123P": truncated })["57000A123P"]).toEqual({ hand: "UNKNOWN" });
  });

  it("parity contradicting a known side makes it weak, unless a learned pair says otherwise", () => {
    expect(resolve({ "7812A512": { asaDescriptions: ["LAMP,REAR COMB,LH"] } })["7812A512"]).toEqual({
      hand: "LH",
      weak: "part-number pairing disagrees",
    });
    const pair = resolve({
      "7812A512": { asaDescriptions: ["LAMP,REAR COMB,LH"] },
      "7812A513": { asaDescriptions: ["LAMP,REAR COMB,RH"] },
    });
    expect(pair["7812A512"]).toEqual({ hand: "LH" });
    expect(pair["7812A513"]).toEqual({ hand: "RH" });
  });

  it("parity is never applied to 10-character P numbers", () => {
    expect(resolve({ "63113W190P": { asaDescriptions: ["DOOR,FR LH"] } })["63113W190P"]).toEqual({ hand: "LH" });
  });
});

describe("part side in suggestions", () => {
  const OUTLANDER: SuggestionVehicle = { vin: newVin("JMFXTGF7"), model: "Outlander", modelCode: "GM4W", buildMonth: ym(2022, 5) };
  const wheelArch = (repairerDescription: string) =>
    mapping({
      repairerDescription,
      partNumber: "7400A539",
      eraDescription: "MOULDINGRR WHEEL ARCHLHBLAC",
      model: "Outlander",
      modelCode: "GM4W",
      vin: newVin("JMFXTGF7"),
      buildMonth: ym(2022, 3),
    });
  const suggest = (description: string, mappings: QuoteMapping[], fitments: PartFitment[] = []) =>
    suggestForLines(OUTLANDER, [{ id: "1", description }], mappings, { catalogue: { vehicles: [], fitments } })[0].suggestions.map(
      (s) => [s.partNumber, s.level],
    );

  it("7400A539 (MOULDING,RR WHEEL ARCH,LH,BLAC…) is never offered for an R/H/R line", () => {
    expect(suggest("R/H/R Wheel Arch Mould", [wheelArch("L/H/R WHEEL ARCH MOULD")])).toEqual([]);
    expect(suggest("R/H/R Wheel Arch Mould", [wheelArch("REAR WHEEL ARCH MOULD")])).toEqual([]);
  });

  it("7400A539 is offered for an L/H/R line", () => {
    expect(suggest("L/H/R Wheel Arch Mould", [wheelArch("L/H/R WHEEL ARCH MOULD")])).toEqual([["7400A539", "confirmed"]]);
    // Repairer gave no side: the glued-in LH agrees with parity, so still left-hand.
    expect(suggest("L/H/R Wheel Arch Mould", [wheelArch("REAR WHEEL ARCH MOULD")])).toEqual([["7400A539", "confirmed"]]);
  });

  it("a genuinely unhanded part (hub bearing ASA lists without a side) fits either side", () => {
    const hub = mapping({ repairerDescription: "L/H/F HUB BEARING", partNumber: "MR992372", eraDescription: "BEARINGFR WHEEL HUB", vin: OUTLANDER.vin });
    const asa = [fitment(newVin(), "MR992372", "BEARING,FR WHEEL HUB")];
    expect(suggest("R/H/F HUB BEARING", [hub], asa)).toEqual([["MR992372", "confirmed"]]);
    expect(suggest("L/H/F HUB BEARING", [hub], asa)).toEqual([["MR992372", "confirmed"]]);
  });

  it("a part with conflicting side sources is never suggested", () => {
    const guard = mapping({ repairerDescription: "L/H/F GUARD", partNumber: "5220AX75", eraDescription: "FENDERFR LH", vin: OUTLANDER.vin });
    const asa = [fitment(newVin(), "5220AX75", "FENDER,FR RH")];
    expect(suggest("L/H/F GUARD", [guard], asa)).toEqual([]);
    expect(suggest("R/H/F GUARD", [guard], asa)).toEqual([]);
  });

  it("parity contradicting the other sources drops a part to possible", () => {
    const knuckle = mapping({ repairerDescription: "L/H/F STEERING KNUCKLE", partNumber: "3870A180", eraDescription: "KNUCKLELH", vin: OUTLANDER.vin });
    const [s] = suggestForLines(OUTLANDER, [{ id: "1", description: "L/H/F STEERING KNUCKLE" }], [knuckle])[0].suggestions;
    expect(s).toMatchObject({ level: "possible", cautions: ["part-number pairing disagrees"] });
  });

  it("a reversed pair learned from the catalogue is confirmed", () => {
    const tail = mapping({ repairerDescription: "L/H TAIL LAMP", partNumber: "7812A512", eraDescription: "LAMP ASSYRR COMBLH", vin: OUTLANDER.vin });
    const asa = [fitment(newVin(), "7812A513", "LAMP ASSY,RR COMB,RH")];
    expect(suggest("L/H TAIL LAMP", [tail], asa)).toEqual([["7812A512", "confirmed"]]);
    expect(suggest("L/H TAIL LAMP", [tail])).toEqual([["7812A512", "possible"]]);
  });
});
