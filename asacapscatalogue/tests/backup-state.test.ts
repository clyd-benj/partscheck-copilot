import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Database } from "../src/database/database";

async function resetDb() {
  await Database.resetForTests();
  indexedDB = new IDBFactory();
}

describe("Database backup state", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("defaults to disabled with no folder connected", async () => {
    const state = await Database.getBackupState();
    expect(state).toEqual({ enabled: false });
  });

  it("round-trips enabled/folderName/lastBackupAt/lastError", async () => {
    await Database.putBackupState({
      enabled: true,
      folderName: "Documents",
      lastBackupAt: "2026-08-18T00:00:00.000Z",
    });

    const state = await Database.getBackupState();
    expect(state.enabled).toBe(true);
    expect(state.folderName).toBe("Documents");
    expect(state.lastBackupAt).toBe("2026-08-18T00:00:00.000Z");
    expect(state.lastError).toBeUndefined();
  });

  it("preserves other fields when only updating one (via read-modify-write)", async () => {
    await Database.putBackupState({ enabled: true, folderName: "Documents" });
    const current = await Database.getBackupState();
    await Database.putBackupState({ ...current, lastError: "permission revoked" });

    const state = await Database.getBackupState();
    expect(state.enabled).toBe(true);
    expect(state.folderName).toBe("Documents");
    expect(state.lastError).toBe("permission revoked");
  });
});
