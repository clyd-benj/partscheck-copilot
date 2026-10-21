import { normaliseDescription, parseSide } from "@/services/quoteCapture/normalise";
import type { PartFitment, Vehicle } from "@/types/asacaps";
import type { QuoteMapping } from "@/types/quoteMapping";

export const NOW = "2026-10-01T00:00:00.000Z";

/** Build month (year * 12 + month). */
export const ym = (year: number, month: number) => year * 12 + month;

let seq = 0;

/** A fresh VIN; `pattern` sets its first 8 characters (WMI + descriptor). */
export function newVin(pattern = "MMAJYKL1"): string {
  seq += 1;
  return `${pattern}0PH${String(seq).padStart(6, "0")}`;
}

export function mapping(overrides: Partial<QuoteMapping> & { repairerDescription?: string } = {}): QuoteMapping {
  seq += 1;
  const repairerDescription = overrides.repairerDescription ?? "BONNET";
  const quoteKey = overrides.quoteKey ?? `draft:${seq}`;
  return {
    id: `${quoteKey}::1`,
    quoteKey,
    rowNo: 1,
    iteration: 0,
    draftItemId: String(seq),
    repairerDescription,
    repairerNormalised: normaliseDescription(repairerDescription),
    side: parseSide(repairerDescription),
    partNumber: "5900A001",
    eraDescription: "HOOD",
    noGenuinePart: false,
    isAccessory: false,
    sideConflict: false,
    vin: newVin(),
    model: "Triton",
    firstSeen: NOW,
    lastSeen: NOW,
    ...overrides,
  };
}

export function vehicle(vin: string, extra: Partial<Vehicle> = {}): Vehicle {
  return { id: vin, vin, make: "Mitsubishi", model: "TRITON", rawText: "", firstSeen: NOW, lastSeen: NOW, ...extra };
}

export function fitment(vin: string, partNumber: string, description: string, extra: Partial<PartFitment> = {}): PartFitment {
  return {
    id: `${vin}::${partNumber}`,
    vin,
    sessionId: "s1",
    partNumber,
    description,
    sources: ["asacaps"],
    timesCopied: 1,
    firstCapturedAt: NOW,
    lastCapturedAt: NOW,
    ...extra,
  };
}
