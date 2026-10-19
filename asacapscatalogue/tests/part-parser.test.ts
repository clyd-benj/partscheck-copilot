import { describe, it, expect } from "vitest";
import { extractPart, extractParts } from "../src/parts/part-parser";
import { fixture } from "./fixtures";

describe("extractPart", () => {
  it("recognises a bare part number", () => {
    expect(extractPart(fixture("part-number-only.txt"))).toEqual({ partNumber: "5253AN28" });
  });

  it("recognises part number + description on one line", () => {
    expect(extractPart(fixture("part-number-with-description.txt"))).toEqual({
      partNumber: "5253AN28",
      description: "R/H SILL PANEL OUTER",
    });
  });

  it("recognises description then part number on separate lines", () => {
    expect(extractPart(fixture("description-then-part-number.txt"))).toEqual({
      partNumber: "5253AN28",
      description: "R/H SILL PANEL OUTER",
    });
  });

  it("recognises labelled 'Part No:' / 'Description:' format", () => {
    expect(extractPart(fixture("part-labeled.txt"))).toEqual({
      partNumber: "5253AN28",
      description: "R/H SILL PANEL OUTER",
    });
  });

  it("recognises other Mitsubishi-style part numbers", () => {
    expect(extractPart("5301J910")?.partNumber).toBe("5301J910");
    expect(extractPart("5220G990")?.partNumber).toBe("5220G990");
    expect(extractPart("6400A123")?.partNumber).toBe("6400A123");
    expect(extractPart("MR123456")?.partNumber).toBe("MR123456");
    expect(extractPart("MN123456")?.partNumber).toBe("MN123456");
  });

  it("recognises part numbers with a two-letter body and a trailing suffix letter", () => {
    // e.g. 6400BW040P — 4 digits + 2 letters + 3 digits + 1 suffix letter,
    // missed from a real ASA CAPS capture before the pattern was broadened.
    expect(extractPart("6400BW040P")?.partNumber).toBe("6400BW040P");
    expect(extractPart("6400BW040P\nFACE,FR BUMPER")).toEqual({
      partNumber: "6400BW040P",
      description: "FACE,FR BUMPER",
    });
  });

  it("recognises part numbers with a 5-digit prefix", () => {
    // e.g. 82821W070P — 5 digits + 1 letter + 3 digits + 1 suffix letter,
    // not matched by the original 4-digit-prefix-only pattern.
    expect(extractPart("82821W070P")?.partNumber).toBe("82821W070P");
    expect(extractPart("82821W070P\nDOOR MIRROR ASSY")).toEqual({
      partNumber: "82821W070P",
      description: "DOOR MIRROR ASSY",
    });
  });

  it("recognises the real ASA CAPS 'click to copy' button + row description format", () => {
    // e.g. <button id="copyPartNoBtn">5702A010</button> + row description
    // "BOLT,FR DOOR HINGE" scraped separately from the DOM and joined.
    expect(extractPart("5702A010\nBOLT,FR DOOR HINGE")).toEqual({
      partNumber: "5702A010",
      description: "BOLT,FR DOOR HINGE",
    });
  });

  it("recognises a PNC label alongside the part number and description", () => {
    // content.ts embeds the diagram position code (PNC) as a "PNC: <code>"
    // line alongside the part number and description when clicking the
    // real ASA CAPS copyPartNoBtn button.
    expect(extractPart("6407A143\nPNC: 62070F\nGARNISH,FR BUMPER SIDE")).toEqual({
      partNumber: "6407A143",
      pnc: "62070F",
      description: "GARNISH,FR BUMPER SIDE",
    });
  });

  it("recognises a PNC label with only a bare part number (no description)", () => {
    expect(extractPart("6407A143\nPNC: 62070F")).toEqual({
      partNumber: "6407A143",
      pnc: "62070F",
    });
  });

  it("does not invent a part number from a description alone", () => {
    expect(extractPart("R/H SILL PANEL OUTER")).toBeNull();
  });

  it("returns null for irrelevant text", () => {
    expect(extractPart(fixture("irrelevant-clipboard.txt"))).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(extractPart("")).toBeNull();
  });
});

describe("extractParts", () => {
  it("extracts every part from a bulk multi-row quote/order screen copy", () => {
    const parts = extractParts(fixture("part-multi-row-quote-screen.txt"));
    expect(parts).toEqual([
      { partNumber: "5700C208", description: "NEL ASSY,FR DOOR" },
      { partNumber: "7410A708XA", description: "DOOR SASH-RH BL" },
      { partNumber: "5730B838", description: "NEL ASSY,RR DOOR" },
      { partNumber: "7410A710XA", description: "DOOR SASH-RH BL" },
      { partNumber: "7410A682XA", description: "DOOR SASH-RH BL" },
      { partNumber: "5759A028", description: "DOOR PROTECT,LW" },
      { partNumber: "6512A954XA", description: "AIR DAM,SIDE" },
    ]);
  });

  it("falls back to single-part extraction for a plain single-part copy", () => {
    expect(extractParts(fixture("part-number-with-description.txt"))).toEqual([
      { partNumber: "5253AN28", description: "R/H SILL PANEL OUTER" },
    ]);
  });

  it("returns an empty array when nothing is recognised", () => {
    expect(extractParts(fixture("irrelevant-clipboard.txt"))).toEqual([]);
    expect(extractParts("")).toEqual([]);
  });
});
