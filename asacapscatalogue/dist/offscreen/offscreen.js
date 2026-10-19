"use strict";
(() => {
  // src/shared/types.ts
  var DEFAULT_SETTINGS = {
    logUnknownEvents: false,
    captureEnabled: true,
    debugMode: false
  };

  // src/database/database.ts
  var DB_NAME = "asa-caps-catalogue";
  var DB_VERSION = 2;
  var STORE_VEHICLES = "vehicles";
  var STORE_SESSIONS = "sessions";
  var STORE_FITMENTS = "fitments";
  var STORE_EVENTS = "events";
  var STORE_SETTINGS = "settings";
  var STORE_BACKUP = "backup";
  var dbPromise = null;
  function openDatabase() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_VEHICLES)) {
          db.createObjectStore(STORE_VEHICLES, { keyPath: "vin" });
        }
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const store = db.createObjectStore(STORE_SESSIONS, { keyPath: "sessionId" });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("vin", "vin", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_FITMENTS)) {
          const store = db.createObjectStore(STORE_FITMENTS, { keyPath: "id" });
          store.createIndex("vin", "vin", { unique: false });
          store.createIndex("partNumber", "partNumber", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          const store = db.createObjectStore(STORE_EVENTS, { keyPath: "id" });
          store.createIndex("capturedAt", "capturedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_BACKUP)) {
          db.createObjectStore(STORE_BACKUP, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function withStore(storeName, mode, fn) {
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
  async function getAll(storeName) {
    const db = await openDatabase();
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    return promisifyRequest(store.getAll());
  }
  var Database = {
    async resetForTests() {
      dbPromise = null;
    },
    // Vehicles
    async getVehicle(vin) {
      return withStore(STORE_VEHICLES, "readonly", (store) => store.get(vin));
    },
    async putVehicle(vehicle) {
      await withStore(STORE_VEHICLES, "readwrite", (store) => store.put(vehicle));
    },
    async listVehicles() {
      return getAll(STORE_VEHICLES);
    },
    // Sessions
    async getSession(sessionId) {
      return withStore(STORE_SESSIONS, "readonly", (store) => store.get(sessionId));
    },
    async putSession(session) {
      await withStore(STORE_SESSIONS, "readwrite", (store) => store.put(session));
    },
    async getActiveSession() {
      const db = await openDatabase();
      const tx = db.transaction(STORE_SESSIONS, "readonly");
      const index = tx.objectStore(STORE_SESSIONS).index("status");
      const results = await promisifyRequest(index.getAll("active"));
      return results[0];
    },
    async listSessions() {
      return getAll(STORE_SESSIONS);
    },
    async listSessionsForVin(vin) {
      const db = await openDatabase();
      const tx = db.transaction(STORE_SESSIONS, "readonly");
      const index = tx.objectStore(STORE_SESSIONS).index("vin");
      return promisifyRequest(index.getAll(vin));
    },
    // Fitments
    async getFitment(id) {
      return withStore(STORE_FITMENTS, "readonly", (store) => store.get(id));
    },
    async putFitment(fitment) {
      await withStore(STORE_FITMENTS, "readwrite", (store) => store.put(fitment));
    },
    async listFitments() {
      return getAll(STORE_FITMENTS);
    },
    async listFitmentsForVin(vin) {
      const db = await openDatabase();
      const tx = db.transaction(STORE_FITMENTS, "readonly");
      const index = tx.objectStore(STORE_FITMENTS).index("vin");
      return promisifyRequest(index.getAll(vin));
    },
    async listFitmentsForPartNumber(partNumber) {
      const db = await openDatabase();
      const tx = db.transaction(STORE_FITMENTS, "readonly");
      const index = tx.objectStore(STORE_FITMENTS).index("partNumber");
      return promisifyRequest(index.getAll(partNumber));
    },
    // Events (debug / unknown-clipboard log)
    async addEvent(event) {
      await withStore(STORE_EVENTS, "readwrite", (store) => store.put(event));
    },
    async listEvents(limit = 100) {
      const all = await getAll(STORE_EVENTS);
      return all.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, limit);
    },
    async clearEvents() {
      const db = await openDatabase();
      const tx = db.transaction(STORE_EVENTS, "readwrite");
      tx.objectStore(STORE_EVENTS).clear();
    },
    // Settings
    async getSettings() {
      const record = await withStore(
        STORE_SETTINGS,
        "readonly",
        (store) => store.get("settings")
      );
      if (!record) return { ...DEFAULT_SETTINGS };
      const { key, ...settings } = record;
      return settings;
    },
    async putSettings(settings) {
      await withStore(STORE_SETTINGS, "readwrite", (store) => store.put({ key: "settings", ...settings }));
    },
    // Auto-backup: a user-granted folder handle (File System Access API) plus
    // status. Stored separately from Settings since FileSystemDirectoryHandle
    // is a special structured-cloneable object, not plain JSON-able state.
    async getBackupState() {
      const record = await withStore(
        STORE_BACKUP,
        "readonly",
        (store) => store.get("backup")
      );
      if (!record) return { enabled: false };
      const { key, ...state } = record;
      return state;
    },
    async putBackupState(state) {
      await withStore(STORE_BACKUP, "readwrite", (store) => store.put({ key: "backup", ...state }));
    }
  };

  // src/shared/export.ts
  async function buildCatalogueRows() {
    const [fitments, vehicles] = await Promise.all([Database.listFitments(), Database.listVehicles()]);
    const vehicleByVin = new Map(vehicles.map((v) => [v.vin, v]));
    return fitments.map((f) => {
      const vehicle = vehicleByVin.get(f.vin);
      return {
        vin: f.vin,
        make: vehicle?.make,
        model: vehicle?.model,
        variant: vehicle?.variant,
        year: vehicle?.year,
        modelCode: vehicle?.modelCode,
        chassisCode: vehicle?.chassisCode,
        classification: vehicle?.classification,
        option: vehicle?.option,
        exteriorColor: vehicle?.exteriorColor,
        interiorColor: vehicle?.interiorColor,
        partNumber: f.partNumber,
        description: f.description,
        pnc: f.pnc,
        timesCopied: f.timesCopied,
        firstCapturedAt: f.firstCapturedAt,
        lastCapturedAt: f.lastCapturedAt
      };
    }).sort((a, b) => b.lastCapturedAt.localeCompare(a.lastCapturedAt));
  }
  function csvEscape(value) {
    const str = value === void 0 || value === null ? "" : String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
  function rowsToCsv(rows) {
    const headers = [
      "VIN",
      "Make",
      "Model",
      "Variant",
      "Year",
      "Model Code",
      "Chassis Code",
      "Classification",
      "Option",
      "Exterior Color",
      "Interior Color",
      "Part Number",
      "PNC",
      "Description",
      "Times Copied",
      "First Captured",
      "Last Captured"
    ];
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(
        [
          row.vin,
          row.make,
          row.model,
          row.variant,
          row.year,
          row.modelCode,
          row.chassisCode,
          row.classification,
          row.option,
          row.exteriorColor,
          row.interiorColor,
          row.partNumber,
          row.pnc,
          row.description,
          row.timesCopied,
          row.firstCapturedAt,
          row.lastCapturedAt
        ].map(csvEscape).join(",")
      );
    }
    return lines.join("\n");
  }

  // src/offscreen/offscreen.ts
  var LOG_PREFIX = "[ASA CAPS Catalogue:offscreen]";
  var BACKUP_FILENAME = "asa-caps-catalogue-backup.csv";
  async function performBackup() {
    const state = await Database.getBackupState();
    if (!state.enabled || !state.folderHandle) {
      return { ok: false, error: "Auto-backup is not configured (no folder connected)." };
    }
    try {
      const permission = await state.folderHandle.queryPermission({ mode: "readwrite" });
      if (permission !== "granted") {
        const message = "Backup folder permission was revoked \u2014 reconnect it from the catalogue page.";
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
        lastBackupAt: (/* @__PURE__ */ new Date()).toISOString(),
        lastError: void 0
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
      return true;
    }
    return false;
  });
})();
//# sourceMappingURL=offscreen.js.map
