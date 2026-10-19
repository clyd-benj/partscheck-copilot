// Active vehicle session manager. Implements the core rule of the whole
// extension: VIN detection is checked BEFORE part detection on every
// clipboard event, there is only ever one active session, and parts are
// never associated with the wrong vehicle after a VIN change.

import { Database } from "../database/database";
import { classifyClipboardText } from "../clipboard/clipboard-parser";
import { extractVehicleFields } from "./vehicle-extract";
import type {
  ClipboardClassification,
  PartFitment,
  Vehicle,
  VehicleSession,
  VinChangeNotification,
} from "../shared/types";

export interface ProcessClipboardResult {
  classification: ClipboardClassification;
  vin: string | null;
  parts: { partNumber: string; description?: string; pnc?: string }[];
  action: string;
  vinChanged: boolean;
  activeSession: VehicleSession | null;
  notification: VinChangeNotification | null;
}

function newSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function upsertVehicle(vin: string, text: string, now: string): Promise<void> {
  const existing = await Database.getVehicle(vin);
  const fields = extractVehicleFields(text, vin);

  const vehicle: Vehicle = {
    id: vin,
    vin,
    ...(existing ?? {}),
    ...fields,
    rawText: text,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  };
  await Database.putVehicle(vehicle);
}

async function createSession(vin: string, now: string): Promise<VehicleSession> {
  const session: VehicleSession = {
    sessionId: newSessionId(),
    vin,
    startedAt: now,
    lastActivityAt: now,
    partCount: 0,
    status: "active",
  };
  await Database.putSession(session);
  return session;
}

async function closeSession(session: VehicleSession, now: string): Promise<void> {
  const closed: VehicleSession = { ...session, status: "closed", closedAt: now, lastActivityAt: now };
  await Database.putSession(closed);
}

async function savePartToActiveVehicle(
  session: VehicleSession,
  part: { partNumber: string; description?: string; pnc?: string },
  now: string
): Promise<VehicleSession> {
  const fitmentId = `${session.vin}::${part.partNumber}`;
  const existing = await Database.getFitment(fitmentId);

  const fitment: PartFitment = existing
    ? {
        ...existing,
        description: existing.description ?? part.description,
        pnc: existing.pnc ?? part.pnc,
        timesCopied: existing.timesCopied + 1,
        lastCapturedAt: now,
      }
    : {
        id: fitmentId,
        vin: session.vin,
        sessionId: session.sessionId,
        partNumber: part.partNumber,
        description: part.description,
        pnc: part.pnc,
        timesCopied: 1,
        firstCapturedAt: now,
        lastCapturedAt: now,
      };

  await Database.putFitment(fitment);

  const updatedSession: VehicleSession = {
    ...session,
    partCount: existing ? session.partCount : session.partCount + 1,
    lastActivityAt: now,
  };
  await Database.putSession(updatedSession);
  return updatedSession;
}

/**
 * Process one clipboard capture end-to-end: classify, then (in strict
 * order) handle VIN detection before part detection, updating the active
 * vehicle session and database as required.
 */
export async function processClipboardText(text: string): Promise<ProcessClipboardResult> {
  const now = new Date().toISOString();
  const { classification, vin, parts } = classifyClipboardText(text);

  if (classification === "VEHICLE" && vin) {
    const activeSession = await Database.getActiveSession();
    let vinChanged = false;
    let notification: VinChangeNotification | null = null;
    let action: string;
    let resultSession: VehicleSession;

    if (!activeSession) {
      resultSession = await createSession(vin, now);
      action = "New vehicle session created";
    } else if (activeSession.vin !== vin) {
      await closeSession(activeSession, now);
      resultSession = await createSession(vin, now);
      vinChanged = true;
      notification = {
        previousVin: activeSession.vin,
        newVin: vin,
        partsSavedToPrevious: activeSession.partCount,
      };
      action = "Vehicle changed: previous session closed, new session created";
    } else {
      resultSession = { ...activeSession, lastActivityAt: now };
      await Database.putSession(resultSession);
      action = "Active vehicle session updated (same VIN)";
    }

    await upsertVehicle(vin, text, now);

    return { classification, vin, parts: [], action, vinChanged, activeSession: resultSession, notification };
  }

  if (classification === "PART" && parts.length > 0) {
    let activeSession = await Database.getActiveSession();
    if (!activeSession) {
      return {
        classification,
        vin: null,
        parts,
        action: "Ignored: part(s) detected but no active vehicle session",
        vinChanged: false,
        activeSession: null,
        notification: null,
      };
    }

    for (const part of parts) {
      activeSession = await savePartToActiveVehicle(activeSession, part, now);
    }

    return {
      classification,
      vin: null,
      parts,
      action:
        parts.length === 1
          ? `Saved to active vehicle (${activeSession.vin})`
          : `Saved ${parts.length} parts to active vehicle (${activeSession.vin})`,
      vinChanged: false,
      activeSession,
      notification: null,
    };
  }

  // UNKNOWN
  const settings = await Database.getSettings();
  if (settings.logUnknownEvents) {
    await Database.addEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      capturedAt: now,
      classification: "UNKNOWN",
      textPreview: text.slice(0, 80),
      fullTextStored: false,
    });
  }

  const activeSession = await Database.getActiveSession();
  return {
    classification: "UNKNOWN",
    vin: null,
    parts: [],
    action: "Ignored: no VIN or part number recognised",
    vinChanged: false,
    activeSession: activeSession ?? null,
    notification: null,
  };
}

export async function setActiveVehicleManually(vin: string): Promise<VehicleSession> {
  const now = new Date().toISOString();
  const activeSession = await Database.getActiveSession();
  if (activeSession && activeSession.vin !== vin) {
    await closeSession(activeSession, now);
  }
  if (activeSession?.vin === vin) return activeSession;

  const session = await createSession(vin, now);
  const existing = await Database.getVehicle(vin);
  if (!existing) {
    await Database.putVehicle({
      id: vin,
      vin,
      rawText: "",
      firstSeen: now,
      lastSeen: now,
    });
  }
  return session;
}

export async function closeActiveSession(): Promise<void> {
  const activeSession = await Database.getActiveSession();
  if (!activeSession) return;
  await closeSession(activeSession, new Date().toISOString());
}
