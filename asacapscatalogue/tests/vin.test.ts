import { describe, it, expect } from "vitest";
import { extractVIN, isValidVin } from "../src/vehicle/vin";
import { fixture } from "./fixtures";

describe("extractVIN", () => {
  it("finds a labelled VIN", () => {
    expect(extractVIN(fixture("vehicle-vin-only.txt"))).toBe("JMFXTGF8WLJ003875");
  });

  it("finds a VIN alongside other vehicle fields", () => {
    expect(extractVIN(fixture("vehicle-with-vin-and-fields.txt"))).toBe("JMFXTGF8WLJ003875");
  });

  it("finds a VIN below a 'Vehicle Identification Number' label", () => {
    expect(extractVIN(fixture("vehicle-multiple-fields.txt"))).toBe("JMFXTGF8WLJ003875");
  });

  it("finds the VIN in the real ASA CAPS breadcrumb format", () => {
    expect(extractVIN(fixture("vehicle-asa-caps-real.txt"))).toBe("JMFXTGA2WBZ003283");
  });

  it("returns null for text with no valid VIN (excluded characters)", () => {
    expect(extractVIN(fixture("invalid-vin.txt"))).toBeNull();
  });

  it("returns null for irrelevant text", () => {
    expect(extractVIN(fixture("irrelevant-clipboard.txt"))).toBeNull();
  });

  it("returns null for empty/whitespace input", () => {
    expect(extractVIN("")).toBeNull();
    expect(extractVIN("   ")).toBeNull();
  });

  it("prefers the labelled/most recent VIN when multiple candidates exist", () => {
    const text = `Previous VIN:\nJMFXTGF8WLJ003875\n\nNew VIN:\nMMAJNKB40FD01899X`;
    expect(extractVIN(text)).toBe("MMAJNKB40FD01899X");
  });

  it("normalises to uppercase", () => {
    expect(extractVIN("vin: jmfxtgf8wlj003875")).toBe("JMFXTGF8WLJ003875");
  });

  it("rejects VINs containing I, O or Q", () => {
    expect(isValidVin("JMFXTGFIWLJ00387O")).toBe(false);
  });

  it("rejects all-digit or all-letter 17-char strings", () => {
    expect(isValidVin("11111111111111111".slice(0, 17))).toBe(false);
    expect(isValidVin("ABCDEFGHJKLMNPRST")).toBe(false);
  });

  it("accepts a well-formed 17-char VIN", () => {
    expect(isValidVin("JMFXTGF8WLJ003875")).toBe(true);
  });
});
