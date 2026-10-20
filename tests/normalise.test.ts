import { describe, it, expect } from "vitest";
import { normaliseDescription, parseEraSide, parseSide } from "@/services/quoteCapture/normalise";

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
    // "L/R" is ambiguous (left/right or left rear), so it's not treated as a side.
    ["L/R TAIL LAMP", "NONE"],
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
