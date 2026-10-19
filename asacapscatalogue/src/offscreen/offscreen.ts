// Runs in a hidden offscreen document. The MV3 background service worker
// has no window/DOM, so it can't use the File System Access API itself —
// this document exists solely to do the actual backup file write on its
// behalf, triggered by a message from the service worker's alarm handler.

import { Database } from "../database/database";
import { buildCatalogueRows, rowsToCsv } from "../shared/export";

const LOG_PREFIX = "[ASA CAPS Catalogue:offscreen]";
const BACKUP_FILENAME = "asa-caps-catalogue-backup.csv";

interface BackupResult {
  ok: boolean;
  error?: string;
}

async function performBackup(): Promise<BackupResult> {
  const state = await Database.getBackupState();

  if (!state.enabled || !state.folderHandle) {
    return { ok: false, error: "Auto-backup is not configured (no folder connected)." };
  }

  try {
    const permission = await state.folderHandle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      // requestPermission() needs a user gesture, which an alarm-triggered
      // run doesn't have — surface this so the catalogue page can prompt
      // the user to reconnect the folder instead of failing silently.
      const message = "Backup folder permission was revoked — reconnect it from the catalogue page.";
      await Database.putBackupState({ ...state, lastError: message });
      return { ok: false, error: message };
    }

    const rows = await buildCatalogueRows();
    const csv = rowsToCsv(rows);

    const fileHandle = await state.folderHandle.getFileHandle(BACKUP_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(csv);
    await writable.close();

    await Database.putBackupState({
      ...state,
      lastBackupAt: new Date().toISOString(),
      lastError: undefined,
    });
    console.log(LOG_PREFIX, `backup written: ${rows.length} row(s)`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(LOG_PREFIX, "backup failed:", message);
    await Database.putBackupState({ ...state, lastError: message });
    return { ok: false, error: message };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PERFORM_AUTO_BACKUP") {
    performBackup().then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  return false;
});
