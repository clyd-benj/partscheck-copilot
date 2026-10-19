import { Database } from "../database/database";
import { processClipboardText } from "../vehicle/vehicle-session";
import type { RuntimeMessage } from "../shared/messages";
import type { DebugInfo } from "../shared/types";

const LOG_PREFIX = "[ASA CAPS Catalogue:bg]";
const AUTO_BACKUP_ALARM = "autoBackup";
console.log(LOG_PREFIX, "service worker started");

function scheduleAutoBackupAlarm(): void {
  chrome.alarms.create(AUTO_BACKUP_ALARM, { periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(async () => {
  // getSettings() already returns defaults when nothing is stored yet;
  // writing it back just ensures a record exists for the settings UI to edit.
  const settings = await Database.getSettings();
  await Database.putSettings(settings);
  scheduleAutoBackupAlarm();
});

// onInstalled doesn't fire on every browser start, but the service worker
// does wake on chrome.runtime.onStartup — re-arm there too so the alarm
// survives a full browser restart (chrome.alarms.create is idempotent by
// name, so this is safe to call redundantly alongside onInstalled).
chrome.runtime.onStartup.addListener(scheduleAutoBackupAlarm);

async function broadcastStateUpdated(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "STATE_UPDATED" });
  } catch {
    // No popup listening right now — that's fine, it reads fresh state on open.
  }
}

function notifyVinChange(previousVin: string, newVin: string, partsSaved: number): void {
  chrome.notifications?.create(`vin-change-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "New vehicle detected",
    message:
      `Previous: ${previousVin}\n` +
      `New: ${newVin}\n` +
      `${partsSaved} part${partsSaved === 1 ? "" : "s"} saved to previous vehicle.\n` +
      `Active vehicle switched.`,
  });
}

async function handleClipboardCapture(text: string): Promise<void> {
  console.log(LOG_PREFIX, "received CLIPBOARD_CAPTURE:", text.slice(0, 120));

  const settings = await Database.getSettings();
  if (!settings.captureEnabled) {
    console.log(LOG_PREFIX, "capture is paused (settings.captureEnabled=false), ignoring");
    return;
  }

  const result = await processClipboardText(text);
  console.log(LOG_PREFIX, "processed:", result.classification, "action:", result.action);

  const debugInfo: DebugInfo = {
    rawText: text,
    classification: result.classification,
    detectedVIN: result.vin,
    detectedParts: result.parts,
    action: result.action,
    timestamp: new Date().toISOString(),
  };
  await chrome.storage.local.set({ lastDebugEvent: debugInfo });

  if (result.vinChanged && result.notification) {
    notifyVinChange(
      result.notification.previousVin,
      result.notification.newVin,
      result.notification.partsSavedToPrevious
    );
  }

  await broadcastStateUpdated();
}

// --- Auto-backup: hourly, via a hidden offscreen document (the service
// worker has no window/DOM, so it can't use the File System Access API
// itself — see src/offscreen/offscreen.ts for the actual file write). ---

const OFFSCREEN_URL = "dist/offscreen/offscreen.html";

async function ensureOffscreenDocument(): Promise<void> {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: "Write the auto-backup CSV snapshot to the user's chosen local folder.",
  });
}

async function runAutoBackup(): Promise<void> {
  try {
    const state = await Database.getBackupState();
    if (!state.enabled || !state.folderHandle) return;

    const fitments = await Database.listFitments();
    if (fitments.length === 0) {
      console.log(LOG_PREFIX, "auto-backup: nothing captured yet, skipping");
      return;
    }

    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({ type: "PERFORM_AUTO_BACKUP" });
    console.log(LOG_PREFIX, "auto-backup result:", response);
  } catch (err) {
    console.log(LOG_PREFIX, "auto-backup failed:", err);
  } finally {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // no offscreen document open — nothing to close
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_BACKUP_ALARM) {
    runAutoBackup();
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message?.type === "CLIPBOARD_CAPTURE") {
    handleClipboardCapture(message.text).finally(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
  if (message?.type === "RUN_BACKUP_NOW") {
    runAutoBackup().finally(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
