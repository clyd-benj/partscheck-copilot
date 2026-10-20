// Thin IndexedDB wrapper for the ASA CAPS vehicle/part catalogue. No
// external dependency, works in both the MV3 service worker and extension
// pages (popup, catalogue). Schema is kept simple and additive so new
// optional fields can be introduced later without a version bump.
//
// This must only be imported from extension-origin contexts (background,
// popup, catalogue page) — never from the content script, which runs in
// the host page's origin and would silently open a different, page-scoped
// database. Content scripts read/write via a message to the background
// worker instead (see src/services/messaging.ts).

import type {
  Vehicle,
  VehicleSession,
  PartFitment,
  ClipboardEventLog,
  Settings,
  BackupState,
} from '@/types/asacaps';
import { DEFAULT_SETTINGS } from '@/types/asacaps';
import type { QuoteMapping } from '@/types/quoteMapping';

const DB_NAME = 'asa-caps-catalogue';
const DB_VERSION = 3;

const STORE_VEHICLES = 'vehicles';
const STORE_SESSIONS = 'sessions';
const STORE_FITMENTS = 'fitments';
const STORE_EVENTS = 'events';
const STORE_SETTINGS = 'settings';
const STORE_BACKUP = 'backup';
const STORE_QUOTE_MAPPINGS = 'quoteMappings';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_VEHICLES)) {
        db.createObjectStore(STORE_VEHICLES, { keyPath: 'vin' });
      }

      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        const store = db.createObjectStore(STORE_SESSIONS, { keyPath: 'sessionId' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('vin', 'vin', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_FITMENTS)) {
        const store = db.createObjectStore(STORE_FITMENTS, { keyPath: 'id' });
        store.createIndex('vin', 'vin', { unique: false });
        store.createIndex('partNumber', 'partNumber', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const store = db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
        store.createIndex('capturedAt', 'capturedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE_BACKUP)) {
        db.createObjectStore(STORE_BACKUP, { keyPath: 'key' });
      }

      // v3: repairer description → part number pairs learned from PartsCheck quotes.
      if (!db.objectStoreNames.contains(STORE_QUOTE_MAPPINGS)) {
        const store = db.createObjectStore(STORE_QUOTE_MAPPINGS, { keyPath: 'id' });
        store.createIndex('quoteKey', 'quoteKey', { unique: false });
        store.createIndex('vin', 'vin', { unique: false });
        store.createIndex('partNumber', 'partNumber', { unique: false });
        store.createIndex('repairerNormalised', 'repairerNormalised', { unique: false });
        store.createIndex('modelCode', 'modelCode', { unique: false });
        store.createIndex('model', 'model', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = () => reject(result.error);
    } else {
      result.then(resolve, reject);
    }
    tx.onerror = () => reject(tx.error);
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const store = tx.objectStore(storeName);
  return promisifyRequest(store.getAll());
}

export const AsaCapsDatabase = {
  async resetForTests(): Promise<void> {
    dbPromise = null;
  },

  // Vehicles
  async getVehicle(vin: string): Promise<Vehicle | undefined> {
    return withStore(STORE_VEHICLES, 'readonly', (store) => store.get(vin));
  },
  async putVehicle(vehicle: Vehicle): Promise<void> {
    await withStore(STORE_VEHICLES, 'readwrite', (store) => store.put(vehicle));
  },
  async listVehicles(): Promise<Vehicle[]> {
    return getAll<Vehicle>(STORE_VEHICLES);
  },

  // Sessions
  async getSession(sessionId: string): Promise<VehicleSession | undefined> {
    return withStore(STORE_SESSIONS, 'readonly', (store) => store.get(sessionId));
  },
  async putSession(session: VehicleSession): Promise<void> {
    await withStore(STORE_SESSIONS, 'readwrite', (store) => store.put(session));
  },
  async getActiveSession(): Promise<VehicleSession | undefined> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const index = tx.objectStore(STORE_SESSIONS).index('status');
    const results = await promisifyRequest(index.getAll('active' as unknown as IDBValidKey));
    return results[0];
  },
  async listSessions(): Promise<VehicleSession[]> {
    return getAll<VehicleSession>(STORE_SESSIONS);
  },
  async listSessionsForVin(vin: string): Promise<VehicleSession[]> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const index = tx.objectStore(STORE_SESSIONS).index('vin');
    return promisifyRequest(index.getAll(vin));
  },

  // Fitments
  async getFitment(id: string): Promise<PartFitment | undefined> {
    return withStore(STORE_FITMENTS, 'readonly', (store) => store.get(id));
  },
  async putFitment(fitment: PartFitment): Promise<void> {
    await withStore(STORE_FITMENTS, 'readwrite', (store) => store.put(fitment));
  },
  async listFitments(): Promise<PartFitment[]> {
    return getAll<PartFitment>(STORE_FITMENTS);
  },
  async listFitmentsForVin(vin: string): Promise<PartFitment[]> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_FITMENTS, 'readonly');
    const index = tx.objectStore(STORE_FITMENTS).index('vin');
    return promisifyRequest(index.getAll(vin));
  },
  async listFitmentsForPartNumber(partNumber: string): Promise<PartFitment[]> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_FITMENTS, 'readonly');
    const index = tx.objectStore(STORE_FITMENTS).index('partNumber');
    return promisifyRequest(index.getAll(partNumber));
  },

  // Events (debug / unknown-clipboard log)
  async addEvent(event: ClipboardEventLog): Promise<void> {
    await withStore(STORE_EVENTS, 'readwrite', (store) => store.put(event));
  },
  async listEvents(limit = 100): Promise<ClipboardEventLog[]> {
    const all = await getAll<ClipboardEventLog>(STORE_EVENTS);
    return all.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, limit);
  },
  async clearEvents(): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    tx.objectStore(STORE_EVENTS).clear();
  },

  // Settings
  async getSettings(): Promise<Settings> {
    const record = await withStore<({ key: string } & Settings) | undefined>(STORE_SETTINGS, 'readonly', (store) =>
      store.get('settings'),
    );
    if (!record) return { ...DEFAULT_SETTINGS };
    return {
      logUnknownEvents: record.logUnknownEvents,
      captureEnabled: record.captureEnabled,
      debugMode: record.debugMode,
    };
  },
  async putSettings(settings: Settings): Promise<void> {
    await withStore(STORE_SETTINGS, 'readwrite', (store) => store.put({ key: 'settings', ...settings }));
  },

  // Auto-backup: a user-granted folder handle (File System Access API) plus
  // status. Stored separately from Settings since FileSystemDirectoryHandle
  // is a special structured-cloneable object, not plain JSON-able state.
  async getBackupState(): Promise<BackupState> {
    const record = await withStore<({ key: string } & BackupState) | undefined>(
      STORE_BACKUP,
      'readonly',
      (store) => store.get('backup'),
    );
    if (!record) return { enabled: false };
    return {
      enabled: record.enabled,
      folderHandle: record.folderHandle,
      folderName: record.folderName,
      lastBackupAt: record.lastBackupAt,
      lastError: record.lastError,
    };
  },
  async putBackupState(state: BackupState): Promise<void> {
    await withStore(STORE_BACKUP, 'readwrite', (store) => store.put({ key: 'backup', ...state }));
  },

  // Quote mappings (PartsCheck repairer description → ASA part number)
  async listQuoteMappings(): Promise<QuoteMapping[]> {
    return getAll<QuoteMapping>(STORE_QUOTE_MAPPINGS);
  },
  async listQuoteMappingsForQuote(quoteKey: string): Promise<QuoteMapping[]> {
    const db = await openDatabase();
    const tx = db.transaction(STORE_QUOTE_MAPPINGS, 'readonly');
    const index = tx.objectStore(STORE_QUOTE_MAPPINGS).index('quoteKey');
    return promisifyRequest(index.getAll(quoteKey));
  },
  /** Upserts by id (quote key + row number), so re-reading a quote never duplicates rows. */
  async putQuoteMappings(mappings: QuoteMapping[]): Promise<void> {
    if (mappings.length === 0) return;
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_QUOTE_MAPPINGS, 'readwrite');
      const store = tx.objectStore(STORE_QUOTE_MAPPINGS);
      for (const mapping of mappings) store.put(mapping);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },
};

export type AsaCapsDatabaseApi = typeof AsaCapsDatabase;
