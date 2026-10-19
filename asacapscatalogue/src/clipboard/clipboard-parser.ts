import { extractVIN } from "../vehicle/vin";
import { extractParts, ExtractedPart } from "../parts/part-parser";
import type { ClipboardClassification } from "../shared/types";

export interface ClassificationResult {
  classification: ClipboardClassification;
  vin: string | null;
  parts: ExtractedPart[];
}

/**
 * Classify clipboard text. VIN detection always takes priority over part
 * detection: text is only considered for PART classification when no VIN
 * was found, matching the required processing order (VIN before parts).
 * A single capture can contain multiple parts (e.g. a bulk copy of several
 * rows from a quote/order screen) — `parts` always holds every part found.
 */
export function classifyClipboardText(text: string): ClassificationResult {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { classification: "UNKNOWN", vin: null, parts: [] };
  }

  const vin = extractVIN(trimmed);
  if (vin) {
    return { classification: "VEHICLE", vin, parts: [] };
  }

  const parts = extractParts(trimmed);
  if (parts.length > 0) {
    return { classification: "PART", vin: null, parts };
  }

  return { classification: "UNKNOWN", vin: null, parts: [] };
}
