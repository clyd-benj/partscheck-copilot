import type { AddCustomerResult } from '@/storage/customerDb';
import type { CustomerRecord } from '@/types/customer';
import type { PartFitment, Settings, Vehicle, VehicleSession } from '@/types/asacaps';
import type { QuoteCaptureResult, QuoteContext, QuoteRow } from '@/types/quoteMapping';

/**
 * Content scripts run in the host page's origin (PartsCheck or ASA CAPS),
 * so they can't open the extension's own IndexedDB directly (see
 * src/storage/customerDb.ts and src/storage/asacapsDb.ts). Everything that
 * needs the databases goes through the background service worker instead,
 * which shares the extension's origin with the popup/catalogue pages.
 */

const GET_CUSTOMERS_MESSAGE_TYPE = 'GET_CUSTOMERS';
const ADD_CUSTOMER_MESSAGE_TYPE = 'ADD_CUSTOMER';
const CLIPBOARD_CAPTURE_MESSAGE_TYPE = 'CLIPBOARD_CAPTURE';
const RUN_BACKUP_NOW_MESSAGE_TYPE = 'RUN_BACKUP_NOW';
const GET_ACTIVE_VEHICLE_STATE_MESSAGE_TYPE = 'GET_ACTIVE_VEHICLE_STATE';
const SET_VEHICLE_MANUALLY_MESSAGE_TYPE = 'SET_VEHICLE_MANUALLY';
const CLOSE_ACTIVE_SESSION_MESSAGE_TYPE = 'CLOSE_ACTIVE_SESSION';
const GET_SETTINGS_MESSAGE_TYPE = 'GET_SETTINGS';
const SET_CAPTURE_ENABLED_MESSAGE_TYPE = 'SET_CAPTURE_ENABLED';
const SAVE_QUOTE_CAPTURE_MESSAGE_TYPE = 'SAVE_QUOTE_CAPTURE';

interface GetCustomersMessage {
  type: typeof GET_CUSTOMERS_MESSAGE_TYPE;
}

interface AddCustomerMessage {
  type: typeof ADD_CUSTOMER_MESSAGE_TYPE;
  record: CustomerRecord;
}

export interface ClipboardCaptureMessage {
  type: typeof CLIPBOARD_CAPTURE_MESSAGE_TYPE;
  text: string;
}

export interface RunBackupNowMessage {
  type: typeof RUN_BACKUP_NOW_MESSAGE_TYPE;
}

interface GetActiveVehicleStateMessage {
  type: typeof GET_ACTIVE_VEHICLE_STATE_MESSAGE_TYPE;
}

interface SetVehicleManuallyMessage {
  type: typeof SET_VEHICLE_MANUALLY_MESSAGE_TYPE;
  vin: string;
}

interface CloseActiveSessionMessage {
  type: typeof CLOSE_ACTIVE_SESSION_MESSAGE_TYPE;
}

interface GetSettingsMessage {
  type: typeof GET_SETTINGS_MESSAGE_TYPE;
}

interface SetCaptureEnabledMessage {
  type: typeof SET_CAPTURE_ENABLED_MESSAGE_TYPE;
  captureEnabled: boolean;
}

interface SaveQuoteCaptureMessage {
  type: typeof SAVE_QUOTE_CAPTURE_MESSAGE_TYPE;
  context: QuoteContext;
  rows: QuoteRow[];
}

export type RuntimeMessage =
  | GetCustomersMessage
  | AddCustomerMessage
  | ClipboardCaptureMessage
  | RunBackupNowMessage
  | GetActiveVehicleStateMessage
  | SetVehicleManuallyMessage
  | CloseActiveSessionMessage
  | GetSettingsMessage
  | SetCaptureEnabledMessage
  | SaveQuoteCaptureMessage;

function hasType(message: unknown, type: string): boolean {
  return typeof message === 'object' && message !== null && (message as { type?: unknown }).type === type;
}

export function isGetCustomersMessage(message: unknown): message is GetCustomersMessage {
  return hasType(message, GET_CUSTOMERS_MESSAGE_TYPE);
}

export function isAddCustomerMessage(message: unknown): message is AddCustomerMessage {
  return hasType(message, ADD_CUSTOMER_MESSAGE_TYPE);
}

export function isClipboardCaptureMessage(message: unknown): message is ClipboardCaptureMessage {
  return hasType(message, CLIPBOARD_CAPTURE_MESSAGE_TYPE);
}

export function isRunBackupNowMessage(message: unknown): message is RunBackupNowMessage {
  return hasType(message, RUN_BACKUP_NOW_MESSAGE_TYPE);
}

export function isGetActiveVehicleStateMessage(message: unknown): message is GetActiveVehicleStateMessage {
  return hasType(message, GET_ACTIVE_VEHICLE_STATE_MESSAGE_TYPE);
}

export function isSetVehicleManuallyMessage(message: unknown): message is SetVehicleManuallyMessage {
  return hasType(message, SET_VEHICLE_MANUALLY_MESSAGE_TYPE);
}

export function isCloseActiveSessionMessage(message: unknown): message is CloseActiveSessionMessage {
  return hasType(message, CLOSE_ACTIVE_SESSION_MESSAGE_TYPE);
}

export function isGetSettingsMessage(message: unknown): message is GetSettingsMessage {
  return hasType(message, GET_SETTINGS_MESSAGE_TYPE);
}

export function isSetCaptureEnabledMessage(message: unknown): message is SetCaptureEnabledMessage {
  return hasType(message, SET_CAPTURE_ENABLED_MESSAGE_TYPE);
}

export function isSaveQuoteCaptureMessage(message: unknown): message is SaveQuoteCaptureMessage {
  return hasType(message, SAVE_QUOTE_CAPTURE_MESSAGE_TYPE);
}

// --- Customer database (content script ↔ background) ---

export async function requestCustomers(): Promise<CustomerRecord[]> {
  const message: GetCustomersMessage = { type: GET_CUSTOMERS_MESSAGE_TYPE };
  const response = (await chrome.runtime.sendMessage(message)) as CustomerRecord[] | undefined;
  return response ?? [];
}

export type AddCustomerMessageResult = AddCustomerResult | { ok: false; error: 'unreachable' };

export async function requestAddCustomer(record: CustomerRecord): Promise<AddCustomerMessageResult> {
  const message: AddCustomerMessage = { type: ADD_CUSTOMER_MESSAGE_TYPE, record };
  const response = (await chrome.runtime.sendMessage(message)) as AddCustomerResult | undefined;
  return response ?? { ok: false, error: 'unreachable' };
}

// --- ASA CAPS catalogue (content script ↔ background) ---

/** Fire-and-forget: the content script doesn't need the background's response. */
export function sendClipboardCapture(text: string): void {
  const message: ClipboardCaptureMessage = { type: CLIPBOARD_CAPTURE_MESSAGE_TYPE, text };
  chrome.runtime.sendMessage(message).catch(() => {
    // Background not ready yet (e.g. just installed) — nothing to recover, drop it.
  });
}

export interface ActiveVehicleState {
  session: VehicleSession | null;
  vehicle: Vehicle | null;
  recentFitments: PartFitment[];
}

export async function requestActiveVehicleState(): Promise<ActiveVehicleState> {
  const message: GetActiveVehicleStateMessage = { type: GET_ACTIVE_VEHICLE_STATE_MESSAGE_TYPE };
  const response = (await chrome.runtime.sendMessage(message)) as ActiveVehicleState | undefined;
  return response ?? { session: null, vehicle: null, recentFitments: [] };
}

export type SetVehicleManuallyResult = { ok: true; session: VehicleSession } | { ok: false; error: string };

export async function requestSetVehicleManually(vin: string): Promise<SetVehicleManuallyResult> {
  const message: SetVehicleManuallyMessage = { type: SET_VEHICLE_MANUALLY_MESSAGE_TYPE, vin };
  const response = (await chrome.runtime.sendMessage(message)) as SetVehicleManuallyResult | undefined;
  return response ?? { ok: false, error: 'Background script unreachable.' };
}

export async function requestCloseActiveSession(): Promise<void> {
  const message: CloseActiveSessionMessage = { type: CLOSE_ACTIVE_SESSION_MESSAGE_TYPE };
  await chrome.runtime.sendMessage(message);
}

export async function requestSettings(): Promise<Settings> {
  const message: GetSettingsMessage = { type: GET_SETTINGS_MESSAGE_TYPE };
  const response = (await chrome.runtime.sendMessage(message)) as Settings | undefined;
  return response ?? { logUnknownEvents: false, captureEnabled: true, debugMode: false };
}

export async function requestSetCaptureEnabled(captureEnabled: boolean): Promise<Settings> {
  const message: SetCaptureEnabledMessage = { type: SET_CAPTURE_ENABLED_MESSAGE_TYPE, captureEnabled };
  const response = (await chrome.runtime.sendMessage(message)) as Settings | undefined;
  return response ?? { logUnknownEvents: false, captureEnabled, debugMode: false };
}

// --- PartsCheck quote capture (content script ↔ background) ---

/** Saves the filled rows of the open quote; null if the background couldn't be reached. */
export async function requestSaveQuoteCapture(
  context: QuoteContext,
  rows: QuoteRow[],
): Promise<QuoteCaptureResult | null> {
  const message: SaveQuoteCaptureMessage = { type: SAVE_QUOTE_CAPTURE_MESSAGE_TYPE, context, rows };
  const response = (await chrome.runtime.sendMessage(message)) as QuoteCaptureResult | undefined;
  return response ?? null;
}
