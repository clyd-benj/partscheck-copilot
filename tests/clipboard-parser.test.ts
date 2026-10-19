import { describe, it, expect } from "vitest";
import { classifyClipboardText } from "@/services/asacaps/clipboard-parser";
import { fixture } from "./fixtures";

describe("classifyClipboardText", () => {
  it("classifies vehicle text as VEHICLE", () => {
    const result = classifyClipboardText(fixture("vehicle-with-vin-and-fields.txt"));
    expect(result.classification).toBe("VEHICLE");
    expect(result.vin).toBe("JMFXTGF8WLJ003875");
  });

  it("classifies the real ASA CAPS breadcrumb as VEHICLE", () => {
    const result = classifyClipboardText(fixture("vehicle-asa-caps-real.txt"));
    expect(result.classification).toBe("VEHICLE");
    expect(result.vin).toBe("JMFXTGA2WBZ003283");
  });

  it("classifies a part number as PART", () => {
    const result = classifyClipboardText(fixture("part-number-with-description.txt"));
    expect(result.classification).toBe("PART");
    expect(result.parts[0]?.partNumber).toBe("5253AN28");
  });

  it("classifies irrelevant text as UNKNOWN", () => {
    const result = classifyClipboardText(fixture("irrelevant-clipboard.txt"));
    expect(result.classification).toBe("UNKNOWN");
  });

  it("classifies invalid VIN-like text as UNKNOWN, not VEHICLE", () => {
    const result = classifyClipboardText(fixture("invalid-vin.txt"));
    expect(result.classification).toBe("UNKNOWN");
    expect(result.vin).toBeNull();
  });

  it("prioritises VIN detection over part detection when both could match", () => {
    // A VIN-bearing text should never fall through to part classification.
    const result = classifyClipboardText(fixture("vehicle-vin-only.txt"));
    expect(result.classification).toBe("VEHICLE");
  });
});
