import { addCustomer, getAllCustomers } from '@/storage/customerDb';
import { AsaCapsDatabase } from '@/storage/asacapsDb';
import { processClipboardText, setActiveVehicleManually, closeActiveSession } from '@/services/asacaps/vehicle-session';
import { isValidVin } from '@/services/asacaps/vin';
import {
  isAddCustomerMessage,
  isClipboardCaptureMessage,
  isCloseActiveSessionMessage,
  isGetActiveVehicleStateMessage,
  isGetCustomersMessage,
  isRunBackupNowMessage,
  isSetVehicleManuallyMessage,
  type ActiveVehicleState,
} from '@/services/messaging';
import type { DebugInfo, VehicleSession } from '@/types/asacaps';

const LOG_PREFIX = '[Parts Interpreter Toolkit:bg]';
const AUTO_BACKUP_ALARM = 'autoBackup';

function scheduleAutoBackupAlarm(): void {
  chrome.alarms.create(AUTO_BACKUP_ALARM, { periodInMinutes: 60 });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Parts Interpreter Toolkit] installed:', details.reason);
  // getSettings() already returns defaults when nothing is stored yet;
  // writing it back just ensures a record exists for the settings UI to edit.
  const settings = await AsaCapsDatabase.getSettings();
  await AsaCapsDatabase.putSettings(settings);
  scheduleAutoBackupAlarm();
});

// onInstalled doesn't fire on every browser start, but the service worker
// does wake on chrome.runtime.onStartup — re-arm there too so the alarm
// survives a full browser restart (chrome.alarms.create is idempotent by
// name, so this is safe to call redundantly alongside onInstalled).
chrome.runtime.onStartup.addListener(scheduleAutoBackupAlarm);

async function broadcastStateUpdated(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'STATE_UPDATED' });
  } catch {
    // No sidebar/popup listening right now — that's fine, they read fresh state on open.
  }
}

function notifyVinChange(previousVin: string, newVin: string, partsSaved: number): void {
  chrome.notifications?.create(`vin-change-${Date.now()}`, {
    type: 'basic',
    iconUrl: 'src/assets/icons/icon-128.png',
    title: 'New vehicle detected',
    message:
      `Previous: ${previousVin}\n` +
      `New: ${newVin}\n` +
      `${partsSaved} part${partsSaved === 1 ? '' : 's'} saved to previous vehicle.\n` +
      `Active vehicle switched.`,
  });
}

async function handleClipboardCapture(text: string): Promise<void> {
  console.log(LOG_PREFIX, 'received CLIPBOARD_CAPTURE:', text.slice(0, 120));

  const settings = await AsaCapsDatabase.getSettings();
  if (!settings.captureEnabled) {
    console.log(LOG_PREFIX, 'capture is paused, ignoring');
    return;
  }

  const result = await processClipboardText(text);
  console.log(LOG_PREFIX, 'processed:', result.classification, 'action:', result.action);

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
      result.notification.partsSavedToPrevious,
    );
  }

  await broadcastStateUpdated();
}

async function getActiveVehicleState(): Promise<ActiveVehicleState> {
  const session = await AsaCapsDatabase.getActiveSession();
  if (!session) return { session: null, vehicle: null, recentFitments: [] };

  const [vehicle, fitments] = await Promise.all([
    AsaCapsDatabase.getVehicle(session.vin),
    AsaCapsDatabase.listFitmentsForVin(session.vin),
  ]);

  return {
    session,
    vehicle: vehicle ?? null,
    recentFitments: fitments.sort((a, b) => b.lastCapturedAt.localeCompare(a.lastCapturedAt)),
  };
}

async function handleSetVehicleManually(vin: string): Promise<{ ok: true; session: VehicleSession } | { ok: false; error: string }> {
  const normalised = vin.trim().toUpperCase();
  if (!isValidVin(normalised)) {
    return { ok: false, error: 'Not a valid 17-character VIN.' };
  }
  const session = await setActiveVehicleManually(normalised);
  await broadcastStateUpdated();
  return { ok: true, session };
}

// --- Auto-backup: hourly, via a hidden offscreen document (the service
// worker has no window/DOM, so it can't use the File System Access API
// itself — see src/offscreen/offscreen.ts for the actual file write). ---

const OFFSCREEN_URL = 'src/offscreen/index.html';

async function ensureOffscreenDocument(): Promise<void> {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: "Write the ASA CAPS auto-backup CSV snapshot to the user's chosen local folder.",
  });
}

async function runAutoBackup(): Promise<void> {
  try {
    const state = await AsaCapsDatabase.getBackupState();
    if (!state.enabled || !state.folderHandle) return;

    const fitments = await AsaCapsDatabase.listFitments();
    if (fitments.length === 0) {
      console.log(LOG_PREFIX, 'auto-backup: nothing captured yet, skipping');
      return;
    }

    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({ type: 'PERFORM_AUTO_BACKUP' });
    console.log(LOG_PREFIX, 'auto-backup result:', response);
  } catch (err) {
    console.log(LOG_PREFIX, 'auto-backup failed:', err);
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

/**
 * Relays both databases to and from content scripts, which run in the host
 * page's origin (PartsCheck or ASA CAPS) and can't open the extension's own
 * IndexedDB directly. The background worker shares the extension's origin
 * with the popup/catalogue pages, so it reads and writes the same
 * databases they manage.
 */
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isGetCustomersMessage(message)) {
    getAllCustomers().then(sendResponse);
    return true;
  }

  if (isAddCustomerMessage(message)) {
    addCustomer(message.record).then(sendResponse);
    return true;
  }

  if (isClipboardCaptureMessage(message)) {
    handleClipboardCapture(message.text).finally(() => sendResponse({ ok: true }));
    return true;
  }

  if (isRunBackupNowMessage(message)) {
    runAutoBackup().finally(() => sendResponse({ ok: true }));
    return true;
  }

  if (isGetActiveVehicleStateMessage(message)) {
    getActiveVehicleState().then(sendResponse);
    return true;
  }

  if (isSetVehicleManuallyMessage(message)) {
    handleSetVehicleManually(message.vin).then(sendResponse);
    return true;
  }

  if (isCloseActiveSessionMessage(message)) {
    closeActiveSession()
      .then(() => broadcastStateUpdated())
      .finally(() => sendResponse({ ok: true }));
    return true;
  }

  return undefined;
});
