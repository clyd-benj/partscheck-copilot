// Message contract between content script/catalogue page and the background
// service worker. (Popup/catalogue pages talk to the database directly for
// everything else — they share the extension's chrome-extension:// origin,
// so no messaging is needed there — except triggering actions that must run
// in the background, like an on-demand backup.)

export interface ClipboardCaptureMessage {
  type: "CLIPBOARD_CAPTURE";
  text: string;
}

export interface StateUpdatedMessage {
  type: "STATE_UPDATED";
}

export interface RunBackupNowMessage {
  type: "RUN_BACKUP_NOW";
}

export type RuntimeMessage = ClipboardCaptureMessage | StateUpdatedMessage | RunBackupNowMessage;
