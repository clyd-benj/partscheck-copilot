// Core data model for the ASA CAPS VIN → part number catalogue, ported
// from the standalone asa-caps-catalogue extension. Kept intentionally
// extensible: optional fields can be added later (model code, build date,
// engine code, OEM/alt part numbers, etc.) without breaking existing
// records, since IndexedDB is schemaless per-record.

export interface Vehicle {
  id: string; // same as VIN, kept as separate field for future-proofing (e.g. non-VIN identifiers)
  vin: string;
  make?: string;
  model?: string;
  variant?: string;
  year?: string;
  engine?: string;
  transmission?: string;
  // ASA CAPS-specific fields (myasaweb.com breadcrumb), populated only when observed.
  modelCode?: string; // e.g. "GA2W" (internal model/chassis code from the tech-info line)
  chassisCode?: string; // e.g. "MMAL" (parenthetical code on the model breadcrumb)
  classification?: string; // e.g. "XTSHR8"
  option?: string; // e.g. "M09"
  exteriorColor?: string; // e.g. "X42A"
  interiorColor?: string; // e.g. "22X"
  productionFrom?: string; // e.g. "2010.12.3"
  productionTo?: string; // e.g. "2010.12.3"
  rawText: string;
  firstSeen: string; // ISO timestamp
  lastSeen: string; // ISO timestamp
}

export type SessionStatus = 'active' | 'closed';

export interface VehicleSession {
  sessionId: string;
  vin: string;
  startedAt: string;
  lastActivityAt: string;
  closedAt?: string;
  partCount: number;
  status: SessionStatus;
}

/**
 * Where a fitment was learned: copied in ASA CAPS, captured from a priced
 * PartsCheck quote, or restored from a CSV import. Fitments saved before
 * this field existed have no `sources` and came from ASA CAPS.
 */
export type FitmentSource = 'asacaps' | 'partscheck-quote' | 'imported';

export interface PartFitment {
  id: string; // `${vin}::${partNumber}`
  vin: string;
  sessionId: string;
  partNumber: string;
  /** ASA CAPS description. Only ever set from ASA CAPS (or an import of one). */
  description?: string;
  /** ERA description from a PartsCheck quote (commas stripped by PartsCheck). */
  eraDescription?: string;
  sources?: FitmentSource[];
  pnc?: string; // parts diagram position code, e.g. "62070F" — distinct from partNumber
  timesCopied: number; // copies in ASA CAPS; 0 for a part only seen on PartsCheck quotes
  firstCapturedAt: string;
  lastCapturedAt: string;
}

export type ClipboardClassification = 'VEHICLE' | 'PART' | 'UNKNOWN';

export interface ClipboardEventLog {
  id: string;
  capturedAt: string;
  classification: ClipboardClassification;
  textPreview: string;
  fullTextStored: boolean;
}

export interface Settings {
  logUnknownEvents: boolean;
  captureEnabled: boolean;
  debugMode: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  logUnknownEvents: false,
  captureEnabled: true,
  debugMode: false,
};

export interface DebugInfo {
  rawText: string;
  classification: ClipboardClassification;
  detectedVIN: string | null;
  detectedParts: { partNumber: string; description?: string; pnc?: string }[];
  action: string;
  timestamp: string;
}

export interface VinChangeNotification {
  previousVin: string;
  newVin: string;
  partsSavedToPrevious: number;
}

// Auto-backup: writes an overwriting CSV snapshot to a user-granted local
// folder (via the File System Access API) on an hourly alarm. folderHandle
// is a FileSystemDirectoryHandle — structured-cloneable, so it can be
// stored directly in IndexedDB and reused across sessions without
// re-prompting, as long as the browser still considers it granted.
export interface BackupState {
  enabled: boolean;
  folderHandle?: FileSystemDirectoryHandle;
  folderName?: string; // for display only, since the handle itself isn't human-readable
  lastBackupAt?: string;
  lastError?: string;
}

/** Adds a source to a fitment's list (legacy fitments without one came from ASA CAPS). */
export function withFitmentSource(
  sources: FitmentSource[] | undefined,
  source: FitmentSource,
): FitmentSource[] {
  const current = sources ?? ['asacaps'];
  return current.includes(source) ? current : [...current, source];
}
