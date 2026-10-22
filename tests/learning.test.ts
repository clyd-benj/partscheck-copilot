// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { captureQuote, suggestForQuote } from "@/services/quoteCapture/captureQuote";
import {
  isLinkConfirmed,
  learnedLinkId,
  linkStatusFor,
  withObservation,
  type LearnedLink,
} from "@/services/quoteCapture/learning";
import type { QuoteContext, QuoteRow } from "@/types/quoteMapping";
import { mapping, newVin, vehicle, ym } from "./suggestionHelpers";

const LINE = "L/H/R DOOR MOULD";
const WORDING = "DOOR MOULDING REAR";
const LINK_763 = learnedLinkId(WORDING, "LH", "5757A763", "GK1W");
const LINK_787 = learnedLinkId(WORDING, "LH", "5757A787", "GK1W");

let quoteSeq = 0;

/** A GK1W Eclipse Cross in the ASA catalogue, built in the given month. */
async function eclipseCross(year: number, month: number): Promise<string> {
  const vin = newVin("JMFXDGK1");
  await AsaCapsDatabase.putVehicle(
    vehicle(vin, {
      model: "ECLIPSE CROSS",
      modelCode: "GK1W",
      classification: "XTHUR8",
      exteriorColor: "W37",
      productionFrom: `${year}.${month}.1`,
    }),
  );
  return vin;
}

function row(partNumber: string): QuoteRow {
  return {
    rowNo: 1,
    iteration: 0,
    draftItemId: "L1",
    repairerDescription: LINE,
    eraDescription: "MOULDING RR DOOR LH",
    partNumber,
    fromDmsUpload: true,
  };
}

/** Suggests for one "L/H/R DOOR MOULD" line on a new quote, then DMS-uploads `chosen`. */
async function quote(vin: string, chosen?: string, quoteKey = `draft:learn-${++quoteSeq}`) {
  const context: QuoteContext = { quoteKey, vin, model: "Eclipse Cross" };
  const [line] = await suggestForQuote({ vin, model: "Eclipse Cross" }, [{ id: "L1", description: LINE }], quoteKey);
  const upload = chosen ? await captureQuote(context, [row(chosen)], "2026-10-21T00:00:00.000Z") : undefined;
  return { line, upload, quoteKey };
}

const confirmed = (line: { suggestions: { level: string; partNumber: string }[] }) =>
  line.suggestions.filter((s) => s.level === "confirmed").map((s) => s.partNumber);

const link = async (id: string) => (await AsaCapsDatabase.listLearnedLinks()).find((l) => l.id === id);

describe("learning from hidden suggestions", () => {
  beforeEach(async () => {
    await AsaCapsDatabase.resetForTests();
    vi.stubGlobal("indexedDB", new IDBFactory());
    // Both parts were used on GK1W Eclipse Crosses with this exact wording,
    // but built years before the cars quoted here: possible only (hidden).
    await AsaCapsDatabase.putQuoteMappings([
      mapping({ repairerDescription: LINE, partNumber: "5757A787", eraDescription: "MOULDING RR DOOR LH", modelCode: "GK1W", buildMonth: ym(2019, 1) }),
      mapping({ repairerDescription: LINE, partNumber: "5757A763", eraDescription: "MOULDING RR DOOR LH", modelCode: "GK1W", buildMonth: ym(2020, 1) }),
    ]);
  });

  it("the screenshot case: hidden 5757A787 and 5757A763, upload picks 5757A763", async () => {
    const vin = await eclipseCross(2023, 6);
    const { line, upload, quoteKey } = await quote(vin, "5757A763");

    // Nothing shown before the upload; both candidates logged as hidden.
    expect(confirmed(line)).toEqual([]);
    const [entry] = await AsaCapsDatabase.listPredictionsForQuote(quoteKey);
    expect(entry).toMatchObject({
      lineId: "L1",
      wording: WORDING,
      side: "LH",
      vin,
      modelCode: "GK1W",
      classification: "XTHUR8",
      exteriorColour: "W37",
      productionDate: "2023.6.1",
      buildMonth: ym(2023, 6),
    });
    expect(entry.candidates.map((c) => [c.partNumber, c.reason]).sort()).toEqual([
      ["5757A763", "outside build window"],
      ["5757A787", "outside build window"],
    ]);

    expect(upload!.learning).toEqual({ verified: 1, nowConfirmed: 0, contradicted: 1 });
    const l763 = (await link(LINK_763))!;
    expect(l763.verifications.map((v) => v.vin)).toEqual([vin]);
    expect(linkStatusFor(l763, { modelCode: "GK1W", buildMonth: ym(2023, 6) })).toBe("partial");
    expect((await link(LINK_787))!).toMatchObject({ verifications: [], contradictions: [{ vin }] });
  });

  it("one verification is PARTIAL: still hidden, and the upload doesn't confirm it by the back door", async () => {
    await quote(await eclipseCross(2023, 6), "5757A763");
    // The uploaded row is within 12 months of this car, but it only verified
    // a hidden suggestion: it counts for nothing until the link is confirmed.
    const { line } = await quote(await eclipseCross(2023, 9));
    expect(confirmed(line)).toEqual([]);
  });

  it("a second VIN confirms it, for that model code built within the verified range ±12 months", async () => {
    await quote(await eclipseCross(2023, 6), "5757A763");
    const { upload } = await quote(await eclipseCross(2023, 9), "5757A763");
    expect(upload!.learning).toEqual({ verified: 1, nowConfirmed: 1, contradicted: 1 });

    const inRange = await quote(await eclipseCross(2024, 9));
    expect(confirmed(inRange.line)).toEqual(["5757A763"]);
    expect(inRange.line.suggestions[0].evidence).toBe("verified by uploads on 2 GK1W vehicles built 2023");

    // Built outside the range (2022-06 to 2024-09): still hidden.
    expect(confirmed((await quote(await eclipseCross(2024, 10))).line)).toEqual([]);
    expect(confirmed((await quote(await eclipseCross(2022, 5))).line)).toEqual([]);
  });

  it("the same VIN uploaded twice counts once", async () => {
    const vin = await eclipseCross(2023, 6);
    await quote(vin, "5757A763");
    const again = await quote(vin, "5757A763");
    expect(again.upload!.learning).toEqual({ verified: 1, nowConfirmed: 0, contradicted: 1 });
    expect((await link(LINK_763))!.verifications).toHaveLength(1);
    expect(confirmed((await quote(await eclipseCross(2023, 7))).line)).toEqual([]);
  });

  it("reloading an uploaded quote doesn't count it again", async () => {
    const vin = await eclipseCross(2023, 6);
    const { quoteKey } = await quote(vin, "5757A763");
    const reload = await captureQuote({ quoteKey, vin }, [row("5757A763")], "2026-10-22T00:00:00.000Z");
    expect(reload.learning).toEqual({ verified: 1, nowConfirmed: 0, contradicted: 1 });
    expect((await link(LINK_787))!.contradictions).toHaveLength(1);
  });

  it("a contradiction in range demotes a confirmed link until it has 2 more verifications than contradictions", async () => {
    await quote(await eclipseCross(2023, 6), "5757A763");
    await quote(await eclipseCross(2023, 9), "5757A763");

    // Shown as confirmed, still logged, and this upload chooses the other part.
    const contradicting = await quote(await eclipseCross(2023, 12), "5757A787");
    expect(confirmed(contradicting.line)).toEqual(["5757A763"]);
    expect((await link(LINK_763))!.contradictions).toHaveLength(1);
    expect(confirmed((await quote(await eclipseCross(2024, 1))).line)).toEqual([]);

    // One more verification: 3 against 1.
    await quote(await eclipseCross(2023, 8), "5757A763");
    expect(confirmed((await quote(await eclipseCross(2024, 1))).line)).toEqual(["5757A763"]);
  });

  it("NA answers prove nothing either way", async () => {
    const { upload } = await quote(await eclipseCross(2023, 6), "NA");
    expect(upload!.learning).toEqual({ verified: 0, nowConfirmed: 0, contradicted: 0 });
    expect(await AsaCapsDatabase.listLearnedLinks()).toEqual([]);
  });
});

describe("learned link status", () => {
  const base: LearnedLink = {
    id: "x",
    wording: "BONNET",
    side: "NONE",
    partNumber: "5900A001",
    modelCode: "KK1T",
    verifications: [],
    contradictions: [],
  };
  const obs = (vin: string, buildMonth?: number) => ({ vin, buildMonth, quoteKey: "q", at: "t" });
  const kk1t = (buildMonth: number) => ({ modelCode: "KK1T", buildMonth });

  it("needs two dated verifications on different VINs", () => {
    const one = withObservation(base, "verifications", obs("A", ym(2022, 1)));
    expect(linkStatusFor(one, kk1t(ym(2022, 1)))).toBe("partial");
    expect(withObservation(one, "verifications", obs("a", ym(2022, 3)))).toBe(one);
    const two = withObservation(one, "verifications", obs("B", ym(2022, 3)));
    expect(linkStatusFor(two, kk1t(ym(2022, 2)))).toBe("confirmed");
    expect(linkStatusFor(two, { modelCode: "KK1W", buildMonth: ym(2022, 2) })).toBe("partial");
    expect(linkStatusFor(two, { modelCode: "KK1T" })).toBe("partial");
    expect(isLinkConfirmed({ ...base, verifications: [obs("A"), obs("B")] })).toBe(false);
  });

  it("ignores contradictions from builds outside the verified range", () => {
    const two = { ...base, verifications: [obs("A", ym(2022, 1)), obs("B", ym(2022, 3))] };
    expect(isLinkConfirmed({ ...two, contradictions: [obs("C", ym(2025, 1))] })).toBe(true);
    expect(isLinkConfirmed({ ...two, contradictions: [obs("C", ym(2022, 6))] })).toBe(false);
  });
});
