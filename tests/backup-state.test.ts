import { describe, it, expect, beforeEach, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { AsaCapsDatabase } from "@/storage/asacapsDb";

async function resetDb() {
  await AsaCapsDatabase.resetForTests();
  vi.stubGlobal("indexedDB", new IDBFactory());
}

describe("AsaCapsDatabase backup state", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("defaults to disabled with no folder connected", async () => {
    const state = await AsaCapsDatabase.getBackupState();
    expect(state).toEqual({ enabled: false });
  });

  it("round-trips enabled/folderName/lastBackupAt/lastError", async () => {
    await AsaCapsDatabase.putBackupState({
      enabled: true,
      folderName: "Documents",
      lastBackupAt: "2026-08-18T00:00:00.000Z",
    });

    const state = await AsaCapsDatabase.getBackupState();
    expect(state.enabled).toBe(true);
    expect(state.folderName).toBe("Documents");
    expect(state.lastBackupAt).toBe("2026-08-18T00:00:00.000Z");
    expect(state.lastError).toBeUndefined();
  });

  it("preserves other fields when only updating one (via read-modify-write)", async () => {
    await AsaCapsDatabase.putBackupState({ enabled: true, folderName: "Documents" });
    const current = await AsaCapsDatabase.getBackupState();
    await AsaCapsDatabase.putBackupState({ ...current, lastError: "permission revoked" });

    const state = await AsaCapsDatabase.getBackupState();
    expect(state.enabled).toBe(true);
    expect(state.folderName).toBe("Documents");
    expect(state.lastError).toBe("permission revoked");
  });
});
