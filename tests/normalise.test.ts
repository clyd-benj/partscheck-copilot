// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { normaliseDescription, parseDescription, parseEraSide, parseSide } from "@/services/quoteCapture/normalise";
import { extractQuoteRows } from "@/services/extractors/quoteRows";
import { loadQuotePage } from "./partscheckFixtures";

describe("parseSide", () => {
  it.each([
    ["L/H/F GUARD", "LH"],
    ["FRONT B/BAR FLARE SEAL L/H", "LH"],
    ["L/H REAR DOOR OUTER HANDLE", "LH"],
    ["R/H/R QTR PANEL", "RH"],
    ["RHF HEADLAMP", "RH"],
    ["LEFT HAND MIRROR", "LH"],
    ["RIGHT FRONT DOOR", "RH"],
    ["RHS TAIL LAMP", "RH"],
    ["L/H & R/H HEADLAMPS", "BOTH"],
    ["REAR DOOR BELT MOULD", "NONE"],
    ["BONNET", "NONE"],
    // "L/R" as a prefix means left-rear on PartsCheck.
    ["L/R TAIL LAMP", "LH"],
    ["R/F SHOCK ABSORBER", "RH"],
    ["L/F DOOR SHELL", "LH"],
    ["R/R SHOCK ABSORBER", "RH"],
  ])("%s → %s", (text, side) => {
    expect(parseSide(text)).toBe(side);
  });

  it("doesn't read side from words that merely contain LH/RH", () => {
    expect(parseSide("WHEELHOUSE LINER")).toBe("NONE");
  });
});

describe("normaliseDescription", () => {
  it("removes the side and expands shorthand", () => {
    expect(normaliseDescription("L/H/F GUARD W/ARCH MOULD")).toBe("FRONT GUARD WHEEL ARCH MOULDING");
    expect(normaliseDescription("FRONT B/BAR FLARE SEAL L/H")).toBe("FRONT BUMPER FLARE SEAL");
    expect(normaliseDescription("L/H/F DOOR WEATHER SHEILD")).toBe("FRONT DOOR WEATHERSHIELD");
  });

  it("gives different wordings of the same part the same form", () => {
    const forms = ["L/H/F GUARD W/ARCH MOULD", "LEFT FRONT FENDER W/ARCH MOULDING", "LHF GRD WHEEL ARCH MLDG"].map(
      normaliseDescription,
    );
    expect(new Set(forms).size).toBe(1);

    expect(normaliseDescription("RR DR BELT MLDG")).toBe(normaliseDescription("REAR DOOR BELT MOULD"));
    expect(normaliseDescription("R/H REAR DOOR OUTER HANDLE")).toBe(
      normaliseDescription("L/H REAR DOOR OUTER HANDLE"),
    );
  });

  it("strips punctuation and collapses spacing", () => {
    expect(normaliseDescription("  front  bumper, (upper)  grille. ")).toBe("FRONT BUMPER UPPER GRILLE");
  });
});

describe("parseEraSide", () => {
  it("reads LH/RH glued on by PartsCheck stripping ERA's commas", () => {
    expect(parseEraSide("KNUCKLELH")).toBe("LH");
    expect(parseEraSide("STEP ASSYSIDELH")).toBe("LH");
    expect(parseEraSide("FENDERFR LH")).toBe("LH");
    expect(parseEraSide("HEADLAMP ASSY,RH")).toBe("RH");
  });

  it("returns NONE for unsided ERA descriptions", () => {
    expect(parseEraSide("WEATHERSHIELD KITFR/RR")).toBe("NONE");
    expect(parseEraSide("HANDLERR DOOR OUTSIDE")).toBe("NONE");
    expect(parseEraSide("NOT APPLICABLE")).toBe("NONE");
  });
});

describe("parseDescription — side/position shorthand", () => {
  it.each([
    ["R/F SHOCK ABSORBER", "RH", "FRONT SHOCK ABSORBER"],
    ["L/F SHOCK ABSORBER", "LH", "FRONT SHOCK ABSORBER"],
    ["R/R SHOCK ABSORBER", "RH", "REAR SHOCK ABSORBER"],
    ["L/R SHOCK ABSORBER", "LH", "REAR SHOCK ABSORBER"],
    ["SHOCK ABSORBER R/F", "RH", "SHOCK ABSORBER FRONT"],
    ["RH FRONT SHOCK ABSORBER", "RH", "FRONT SHOCK ABSORBER"],
    ["RF SHOCK ABSORBER", "RH", "FRONT SHOCK ABSORBER"],
    ["L/LOWER CONTROL ARM", "LH", "LOWER CONTROL ARM"],
    ["F/LOWER CONTROL ARM", "NONE", "FRONT LOWER CONTROL ARM"],
    ["R/BAR REINF", "NONE", "REAR BUMPER REINFORCEMENT"],
    ["F/LAMP", "NONE", "FOGLAMP"],
  ])("%s → %s, %s", (text, side, words) => {
    expect(parseDescription(text)).toEqual({ side, words: words.split(" "), unclear: false });
  });

  it.each([
    ["R/LOWER CONTROL ARM", "rear or right?"],
    ["TAIL LAMP L/R", "left rear, or left and right?"],
    ["L/R FRONT GUARD", "prefix L/R can't be left-rear with FRONT"],
    ["R FRONT DOOR", "lone R"],
    ["F/R SHOCK ABSORBER", "front/rear?"],
    ["LR DOOR HANDLE", "LR"],
  ])("%s is unclear (%s)", (text) => {
    expect(parseDescription(text).unclear).toBe(true);
  });

  it("never keeps a single R, F or L as a word", () => {
    for (const text of ["R/LOWER CONTROL ARM", "R FRONT DOOR", "F/R SHOCK ABSORBER", "DOOR L"]) {
      const { words } = parseDescription(text);
      expect(words.filter((w) => ["R", "F", "L"].includes(w))).toEqual([]);
    }
  });

  it("reads every line of the real quote clearly, all left-hand", () => {
    const lines = extractQuoteRows(loadQuotePage("quote-empty")).map((r) => r.repairerDescription);
    expect(lines).toHaveLength(19);
    for (const line of lines) {
      expect(parseDescription(line), line).toMatchObject({ side: "LH", unclear: false });
    }
    expect(normaliseDescription("L/H/R QTR PANEL FLARE SEAL")).toBe("REAR QUARTER PANEL FLARE SEAL");
  });
});
