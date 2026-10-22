// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";
import { captureQuote, suggestForQuote } from "@/services/quoteCapture/captureQuote";
import {
  contradictionVeto,
  emptyPartLink,
  partLinkId,
  scoreTotals,
  withContradiction,
  withVerification,
} from "@/services/quoteCapture/learning";
import type { QuoteRow } from "@/types/quoteMapping";
import { mapping, newVin, vehicle, ym } from "./suggestionHelpers";

let quoteSeq = 0;

async function triton(year: number, month: number, classification = "XTSHR8"): Promise<string> {
  const vin = newVin("MMAJYKL1");
  await AsaCapsDatabase.putVehicle(
    vehicle(vin, { modelCode: "KK1T", classification, productionFrom: `${year}.${month}.1` }),
  );
  return vin;
}

/** Suggests for the lines of a new quote, then DMS-uploads `answers` (line description → part number). */
async function quote(vin: string, answers: Record<string, string>) {
  quoteSeq += 1;
  const quoteKey = `draft:score-${quoteSeq}`;
  const descriptions = Object.keys(answers);
  const lines = await suggestForQuote(
    { vin, model: "Triton" },
    descriptions.map((description, i) => ({ id: `L${i}`, description })),
    quoteKey,
  );
  const rows: QuoteRow[] = descriptions.map((description, i) => ({
    rowNo: i + 1,
    iteration: 0,
    draftItemId: `L${i}`,
    repairerDescription: description,
    eraDescription: answers[description] === "NA" ? "NOT APPLICABLE" : "PART",
    partNumber: answers[description],
    fromDmsUpload: true,
  }));
  const upload = await captureQuote({ quoteKey, vin, model: "Triton", reference: `RO-${quoteSeq}` }, rows, `2026-10-2${quoteSeq}T00:00:00.000Z`);
  return { lines, upload, vin };
}

const confirmed = (line: { suggestions: { level: string; partNumber: string }[] }) =>
  line.suggestions.filter((s) => s.level === "confirmed").map((s) => s.partNumber);

describe("self-scoring on DMS Upload", () => {
  beforeEach(async () => {
    await AsaCapsDatabase.resetForTests();
    vi.stubGlobal("indexedDB", new IDBFactory());
    quoteSeq = 0;
    // BONNET → 5900A001 on a KK1T built 2022-01: confirmed for KK1Ts built within 12 months.
    await AsaCapsDatabase.putQuoteMappings([
      mapping({ vin: await triton(2022, 1), repairerDescription: "BONNET", partNumber: "5900A001", modelCode: "KK1T", buildMonth: ym(2022, 1) }),
    ]);
  });

  it("counts lines, confirmed lines and correct ones; NA lines aren't scored", async () => {
    const { lines, upload } = await quote(await triton(2022, 3), {
      BONNET: "5900A001",
      "L/H/F GUARD": "5220A123",
      "R/H/F GUARD": "NA",
    });
    expect(lines.map(confirmed)).toEqual([["5900A001"], [], []]);
    expect(upload.learning).toMatchObject({ lines: 2, confirmed: 1, correct: 1 });
  });

  it("a miss is listed with its quote, vehicle, numbers and rule, and contradicts the part link", async () => {
    await quote(await triton(2022, 3), { BONNET: "5900A001" });
    // Another trim, where the bonnet turns out to differ.
    const { lines, upload, vin } = await quote(await triton(2022, 2, "XTSLR8"), { BONNET: "5900A002" });
    expect(confirmed(lines[0])).toEqual(["5900A001"]);
    expect(upload.learning).toMatchObject({ lines: 1, confirmed: 1, correct: 0 });

    const totals = scoreTotals(await AsaCapsDatabase.listPredictions());
    expect(totals).toMatchObject({ lines: 2, confirmed: 2, correct: 1 });
    expect(totals.misses).toEqual([
      {
        id: "draft:score-2::L0",
        at: "2026-10-22T00:00:00.000Z",
        quoteRef: "RO-2",
        description: "BONNET",
        vehicle: `Triton · KK1T · ${vin}`,
        suggested: "5900A001",
        uploaded: ["5900A002"],
        rule: "same model code + build date, exact wording (your quotes)",
      },
    ]);

    const link = (await AsaCapsDatabase.listPartLinks()).find((l) => l.id === partLinkId("5900A001", "KK1T"))!;
    expect(link.contradictions.map((c) => c.vin)).toEqual([vin]);

    // Next XTSHR8 KK1T in range: the trim split still points at 5900A001, but the miss
    // (a build two months away) holds it back until verifications outweigh it.
    const next = await suggestForQuote({ vin: await triton(2022, 4), model: "Triton" }, [{ id: "L0", description: "BONNET" }], "draft:next");
    expect(confirmed(next[0])).toEqual([]);
    expect(next[0].suggestions.find((s) => s.partNumber === "5900A001")!.cautions).toEqual(["contradicted by an upload"]);
  });

  it("reloading an uploaded quote doesn't score it again", async () => {
    const { upload, vin } = await quote(await triton(2022, 3), { BONNET: "5900A001" });
    const row: QuoteRow = { rowNo: 1, iteration: 0, draftItemId: "L0", repairerDescription: "BONNET", eraDescription: "PART", partNumber: "5900A001", fromDmsUpload: true };
    const again = await captureQuote({ quoteKey: upload.quoteKey, vin }, [row], "2026-10-30T00:00:00.000Z");
    expect(again.learning).toMatchObject({ lines: 1, confirmed: 1, correct: 1 });
    expect(scoreTotals(await AsaCapsDatabase.listPredictions())).toMatchObject({ lines: 1, confirmed: 1, correct: 1 });
  });
});

describe("contradiction veto", () => {
  const obs = (vin: string, buildMonth?: number) => ({ vin, buildMonth, quoteKey: "q", at: "t" });
  const contradicted = withContradiction(emptyPartLink("5900A001", "KK1T"), obs("C", ym(2022, 1)));

  it("holds back a part contradicted on a build within 12 months", () => {
    expect(contradictionVeto(contradicted, { buildMonth: ym(2022, 6) })).toBe("contradicted by an upload");
    expect(contradictionVeto(contradicted, { buildMonth: ym(2023, 2) })).toBeUndefined();
    expect(contradictionVeto(undefined, { buildMonth: ym(2022, 6) })).toBeUndefined();
  });

  it("lifts once verifications outnumber contradictions by 2", () => {
    const bonnet = { wording: "BONNET", side: "NONE" as const };
    let link = withVerification(contradicted, obs("A", ym(2022, 2)), bonnet);
    link = withVerification(link, obs("B", ym(2022, 3)), bonnet);
    expect(contradictionVeto(link, { buildMonth: ym(2022, 6) })).toBe("contradicted by an upload");
    link = withVerification(link, obs("D", ym(2022, 4)), bonnet);
    expect(contradictionVeto(link, { buildMonth: ym(2022, 6) })).toBeUndefined();
  });
});
