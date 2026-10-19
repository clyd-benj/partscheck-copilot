import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Database } from "../src/database/database";
import { processClipboardText } from "../src/vehicle/vehicle-session";

async function resetDb() {
  await Database.resetForTests();
  indexedDB = new IDBFactory();
}

describe("vehicle session pipeline", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("Test 1 — first VIN creates an active session", async () => {
    const result = await processClipboardText("VIN: JMFXTGF8WLJ003875\nMitsubishi Triton GLX-R");
    expect(result.classification).toBe("VEHICLE");
    expect(result.activeSession?.vin).toBe("JMFXTGF8WLJ003875");
    expect(result.activeSession?.status).toBe("active");
  });

  it("Test 2 — part after VIN is fitted to that VIN", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    await processClipboardText("5253AN28\nR/H SILL PANEL OUTER");

    const fitment = await Database.getFitment("JMFXTGF8WLJ003875::5253AN28");
    expect(fitment?.vin).toBe("JMFXTGF8WLJ003875");
    expect(fitment?.partNumber).toBe("5253AN28");
    expect(fitment?.timesCopied).toBe(1);
  });

  it("Test 3 — multiple parts all assigned to the current VIN", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    await processClipboardText("5253AN28");
    await processClipboardText("5301J910");

    const fitments = await Database.listFitmentsForVin("JMFXTGF8WLJ003875");
    const partNumbers = fitments.map((f) => f.partNumber).sort();
    expect(partNumbers).toEqual(["5253AN28", "5301J910"]);
  });

  it("Test 4 — same VIN copied again does not create a new session", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    const first = await Database.listSessions();

    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    const second = await Database.listSessions();

    expect(second.length).toBe(first.length);
    expect(second.filter((s) => s.status === "active").length).toBe(1);
  });

  it("Test 5 — new VIN closes the previous session and creates a new one", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    const result = await processClipboardText("VIN: MMAJNKB40FD01899X");

    expect(result.vinChanged).toBe(true);
    expect(result.notification?.previousVin).toBe("JMFXTGF8WLJ003875");
    expect(result.notification?.newVin).toBe("MMAJNKB40FD01899X");

    const sessions = await Database.listSessionsForVin("JMFXTGF8WLJ003875");
    expect(sessions[0].status).toBe("closed");

    const active = await Database.getActiveSession();
    expect(active?.vin).toBe("MMAJNKB40FD01899X");
  });

  it("Test 6 — part after a VIN change belongs to the new VIN, not the old one", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    await processClipboardText("5253AN28");
    await processClipboardText("VIN: MMAJNKB40FD01899X");
    await processClipboardText("6400A123");

    const oldFitments = await Database.listFitmentsForVin("JMFXTGF8WLJ003875");
    const newFitments = await Database.listFitmentsForVin("MMAJNKB40FD01899X");

    expect(oldFitments.map((f) => f.partNumber)).toEqual(["5253AN28"]);
    expect(newFitments.map((f) => f.partNumber)).toEqual(["6400A123"]);
  });

  it("Test 7 — invalid VIN does not change the active vehicle", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    const result = await processClipboardText("Chassis No: JMFXTGFIWLJ00387O");

    expect(result.classification).toBe("UNKNOWN");
    const active = await Database.getActiveSession();
    expect(active?.vin).toBe("JMFXTGF8WLJ003875");
  });

  it("Test 8 — unknown clipboard content is ignored (no records created)", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    const before = await Database.listFitments();

    await processClipboardText("Customer: John Smith\n123 Example Street");

    const after = await Database.listFitments();
    expect(after.length).toBe(before.length);
  });

  it("Test 9 — duplicate part copies increment timesCopied, no duplicate fitment", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    await processClipboardText("5253AN28");
    await processClipboardText("5253AN28");
    await processClipboardText("5253AN28");

    const fitments = await Database.listFitmentsForVin("JMFXTGF8WLJ003875");
    expect(fitments.length).toBe(1);
    expect(fitments[0].timesCopied).toBe(3);
  });

  it("never loses data across a VIN change: both vehicles retain their own parts", async () => {
    await processClipboardText("VIN: JMFXTGF8WLJ003875");
    await processClipboardText("5253AN28");
    await processClipboardText("5301J910");
    await processClipboardText("VIN: MMAJNKB40FD01899X");
    await processClipboardText("6400A123");

    const vinA = await Database.listFitmentsForVin("JMFXTGF8WLJ003875");
    const vinB = await Database.listFitmentsForVin("MMAJNKB40FD01899X");

    expect(vinA.map((f) => f.partNumber).sort()).toEqual(["5253AN28", "5301J910"]);
    expect(vinB.map((f) => f.partNumber)).toEqual(["6400A123"]);
  });

  it("handles the real ASA CAPS breadcrumb clipboard format end to end", async () => {
    const result = await processClipboardText(
      "ASX(MMAL) 2000 | LS(2WD),S-CVT VIN: JMFXTGA2WBZ003283 Model: GA2W Classification: XTSHR8 Option: M09 Exterior: X42A Interior: 22X From: 2010.12.3 To: 2010.12.3"
    );
    expect(result.classification).toBe("VEHICLE");
    expect(result.activeSession?.vin).toBe("JMFXTGA2WBZ003283");

    const vehicle = await Database.getVehicle("JMFXTGA2WBZ003283");
    expect(vehicle?.make).toBe("Mitsubishi");
    expect(vehicle?.model).toBe("ASX");
  });
});
