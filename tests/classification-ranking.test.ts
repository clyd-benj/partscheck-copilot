// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { suggestForLines, type SuggestionVehicle } from "@/services/quoteCapture/suggestions";
import { suggestForQuote } from "@/services/quoteCapture/captureQuote";
import { normaliseDescription, parseSide } from "@/services/quoteCapture/normalise";
import { asaVehicleUpdatedMessage, isAsaVehicleUpdatedMessage } from "@/services/messaging";
import { createQuoteSuggestionsStore, refreshSuggestionsOnAsaVehicle } from "@/content/quoteSuggestions";
import type { PartFitment, Vehicle } from "@/types/asacaps";
import type { QuoteMapping } from "@/types/quoteMapping";
import { loadQuotePage } from "./partscheckFixtures";

const ym = (year: number, month: number) => year * 12 + month;
const NOW = "2026-10-01T00:00:00.000Z";

let seq = 0;
function vin(): string {
  seq += 1;
  return `MMBXXXXXXXX${String(seq).padStart(6, "0")}`;
}

function vehicle(v: string, classification?: string, extra: Partial<Vehicle> = {}): Vehicle {
  return { id: v, vin: v, model: "Triton", modelCode: "KK1T", classification, rawText: "", firstSeen: NOW, lastSeen: NOW, ...extra };
}

function mapping(v: string, partNumber: string, extra: Partial<QuoteMapping> = {}): QuoteMapping {
  seq += 1;
  return {
    id: `draft:${seq}::1`,
    quoteKey: `draft:${seq}`,
    rowNo: 1,
    iteration: 0,
    draftItemId: String(seq),
    repairerDescription: "BONNET",
    repairerNormalised: normaliseDescription("BONNET"),
    side: parseSide("BONNET"),
    partNumber,
    eraDescription: "HOOD",
    noGenuinePart: false,
    isAccessory: false,
    sideConflict: false,
    vin: v,
    model: "Triton",
    modelCode: "KK1T",
    firstSeen: NOW,
    lastSeen: NOW,
    ...extra,
  };
}

const QUERY: SuggestionVehicle = {
  vin: "MMAJYKL10PH999999",
  model: "Triton",
  modelCode: "KK1T",
  buildMonth: ym(2022, 6),
  classification: "XTSHR8",
};

function rank(query: SuggestionVehicle, mappings: QuoteMapping[], vehicles: Vehicle[], fitments: PartFitment[] = []) {
  return suggestForLines(query, [{ id: "1", description: "BONNET" }], mappings, {
    catalogue: { fitments, vehicles },
    limit: 5,
  })[0].suggestions;
}

describe("same-trim (ASA CAPS classification) ranking", () => {
  it("ranks parts used on the same trim first within a tier, ahead of build-date closeness", () => {
    const sameTrimOld = vin();
    const otherTrimNew = vin();
    const ranked = rank(
      QUERY,
      [mapping(sameTrimOld, "SAME-TRIM", { buildMonth: ym(2016, 1) }), mapping(otherTrimNew, "OTHER-TRIM", { buildMonth: ym(2022, 5) })],
      [vehicle(sameTrimOld, "XTSHR8"), vehicle(otherTrimNew, "XTSLR8")],
    );
    expect(ranked.map((s) => [s.partNumber, s.sameTrimCount, s.buildGap])).toEqual([
      ["SAME-TRIM", 1, 77],
      ["OTHER-TRIM", 0, 1],
    ]);
  });

  it("uses build-date closeness among same-trim parts", () => {
    const [a, b] = [vin(), vin()];
    const ranked = rank(
      QUERY,
      [mapping(a, "FAR", { buildMonth: ym(2018, 1) }), mapping(b, "NEAR", { buildMonth: ym(2022, 1) })],
      [vehicle(a, "XTSHR8"), vehicle(b, "XTSHR8")],
    );
    expect(ranked.map((s) => s.partNumber)).toEqual(["NEAR", "FAR"]);
  });

  it("never overrides the vehicle tier", () => {
    const [codeOtherTrim, modelSameTrim] = [vin(), vin()];
    const ranked = rank(
      QUERY,
      [mapping(codeOtherTrim, "CODE"), mapping(modelSameTrim, "MODEL", { modelCode: undefined })],
      [vehicle(codeOtherTrim, "XTSLR8"), vehicle(modelSameTrim, "XTSHR8", { modelCode: undefined })],
    );
    expect(ranked.map((s) => [s.partNumber, s.tier])).toEqual([
      ["CODE", "modelCode"],
      ["MODEL", "model"],
    ]);
  });

  it("never filters: a part only seen on other trims is still suggested", () => {
    const other = vin();
    const ranked = rank(QUERY, [mapping(other, "OTHER-TRIM")], [vehicle(other, "GLXR8")]);
    expect(ranked.map((s) => [s.partNumber, s.sameTrimCount])).toEqual([["OTHER-TRIM", 0]]);
  });

  it("shows how many vehicles share the trim in the evidence", () => {
    const [a, b, c] = [vin(), vin(), vin()];
    const [s] = rank(
      QUERY,
      [
        mapping(a, "5900A001", { buildMonth: ym(2021, 4) }),
        mapping(b, "5900A001", { buildMonth: ym(2022, 2) }),
        mapping(c, "5900A001", { buildMonth: ym(2022, 8) }),
      ],
      [vehicle(a, "XTSHR8"), vehicle(b, "XTSHR8"), vehicle(c, "GLXR8")],
    );
    expect(s.evidence).toBe("used on 3 vehicles · KK1T Triton (2 same trim XTSHR8) built 2021–2022, last 2026-10-01");
  });

  it("applies to ASA catalogue suggestions too", () => {
    const [same, other] = [vin(), vin()];
    const fitment = (v: string, partNumber: string): PartFitment => ({
      id: `${v}::${partNumber}`,
      vin: v,
      sessionId: "s",
      partNumber,
      description: "HOOD",
      sources: ["asacaps"],
      timesCopied: 1,
      firstCapturedAt: NOW,
      lastCapturedAt: NOW,
    });
    const ranked = suggestForLines(QUERY, [{ id: "1", description: "HOOD" }], [], {
      catalogue: {
        vehicles: [vehicle(other, "XTSLR8", { productionFrom: "2022.5.1" }), vehicle(same, "XTSHR8", { productionFrom: "2015.1.1" })],
        fitments: [fitment(other, "OTHER-TRIM"), fitment(same, "SAME-TRIM")],
      },
    })[0].suggestions;
    expect(ranked.map((s) => [s.partNumber, s.source])).toEqual([
      ["SAME-TRIM", "catalogue"],
      ["OTHER-TRIM", "catalogue"],
    ]);
    expect(ranked[0].evidence).toBe(
      "seen in ASA CAPS on 1 vehicle · KK1T Triton (1 same trim XTSHR8) built 2015 (older build), last 2026-10-01",
    );
  });
});

describe("unknown classification leaves the current order unchanged", () => {
  const [a, b, c] = ["MMBXXXXXXXX100001", "MMBXXXXXXXX100002", "MMBXXXXXXXX100003"];
  const mappings = [
    mapping(a, "COMMON", { buildMonth: ym(2019, 1) }),
    mapping(b, "COMMON", { buildMonth: ym(2019, 2) }),
    mapping(c, "CLOSE", { buildMonth: ym(2022, 6) }),
  ];
  const strip = (list: ReturnType<typeof rank>) => list.map(({ partNumber, evidence }) => ({ partNumber, evidence }));
  const baseline = strip(rank({ ...QUERY, classification: undefined }, mappings, []));

  it("when the quoted VIN isn't in the catalogue", () => {
    const withVehicles = [vehicle(a, "XTSHR8"), vehicle(b, "XTSHR8"), vehicle(c, "GLXR8")];
    expect(strip(rank({ ...QUERY, classification: undefined }, mappings, withVehicles))).toEqual(baseline);
    expect(baseline.map((s) => s.partNumber)).toEqual(["CLOSE", "COMMON"]);
  });

  it("when the past vehicles have no classification", () => {
    expect(strip(rank(QUERY, mappings, [vehicle(a), vehicle(b), vehicle(c)]))).toEqual(baseline);
    expect(strip(rank(QUERY, mappings, []))).toEqual(baseline);
  });
});

describe("suggestForQuote uses the quoted VIN's classification from the catalogue", () => {
  beforeEach(async () => {
    await AsaCapsDatabase.resetForTests();
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  it("ranks the same-trim part first once the quoted VIN is in ASA CAPS", async () => {
    const [same, other] = [vin(), vin()];
    await AsaCapsDatabase.putQuoteMappings([
      mapping(other, "OTHER-TRIM", { buildMonth: ym(2022, 6) }),
      mapping(same, "SAME-TRIM", { buildMonth: ym(2017, 1) }),
    ]);
    await AsaCapsDatabase.putVehicle(vehicle(same, "XTSHR8"));
    await AsaCapsDatabase.putVehicle(vehicle(other, "XTSLR8"));
    const quoted = { vin: QUERY.vin, model: "Triton", mthYr: "6/2022" };
    const lines = [{ id: "1", description: "BONNET" }];

    // Not yet captured in ASA CAPS: no trim, so the closer build wins.
    expect((await suggestForQuote(quoted, lines))[0].suggestions.map((s) => s.partNumber)).toEqual([
      "OTHER-TRIM",
      "SAME-TRIM",
    ]);

    await AsaCapsDatabase.putVehicle(vehicle(QUERY.vin!, "XTSHR8", { modelCode: undefined }));
    expect((await suggestForQuote(quoted, lines))[0].suggestions.map((s) => s.partNumber)).toEqual([
      "SAME-TRIM",
      "OTHER-TRIM",
    ]);
  });
});

describe("refresh when ASA CAPS captures the open quote's VIN", () => {
  function setup() {
    let listener: ((message: unknown) => void) | undefined;
    const store = createQuoteSuggestionsStore();
    const request = vi.fn(async () => []);
    refreshSuggestionsOnAsaVehicle(store, request, loadQuotePage("quote-empty"), (fn) => {
      listener = fn;
      return () => (listener = undefined);
    });
    return { request, send: (message: unknown) => listener!(message) };
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("recomputes suggestions for the matching VIN", async () => {
    const { request, send } = setup();
    send(asaVehicleUpdatedMessage("MMAGUKS10NH000001"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    send(asaVehicleUpdatedMessage("mmaguks10nh000001"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it("ignores other VINs and other messages", async () => {
    const { request, send } = setup();
    send(asaVehicleUpdatedMessage("JMFXTGA2WBZ003283"));
    send({ type: "STATE_UPDATED" });
    send({ type: "ASA_VEHICLE_UPDATED" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request).not.toHaveBeenCalled();
  });

  it("only accepts well-formed messages", () => {
    expect(isAsaVehicleUpdatedMessage(asaVehicleUpdatedMessage("X"))).toBe(true);
    expect(isAsaVehicleUpdatedMessage({ type: "ASA_VEHICLE_UPDATED", vin: 1 })).toBe(false);
  });
});
