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

  // src/vehicle/vin.ts
  var VIN_CHARS = "A-HJ-NPR-Z0-9";
  var VIN_REGEX = new RegExp(`\\b[${VIN_CHARS}]{17}\\b`, "gi");
  function looksLikeVin(candidate) {
    const hasLetter = /[A-Z]/i.test(candidate);
    const hasDigit = /[0-9]/.test(candidate);
    if (!hasLetter || !hasDigit) return false;
    if (/^(.)\1+$/.test(candidate)) return false;
    return true;
  }
  function isValidVin(candidate) {
    if (typeof candidate !== "string") return false;
    const trimmed = candidate.trim().toUpperCase();
    if (trimmed.length !== 17) return false;
    const regex = new RegExp(`^[${VIN_CHARS}]{17}$`, "i");
    if (!regex.test(trimmed)) return false;
    return looksLikeVin(trimmed);
  }

  // src/vehicle/vehicle-extract.ts
  var ASA_TECH_INFO = new RegExp(
    "Model:\\s*(?<modelCode>\\S+)\\s*Classification:\\s*(?<classification>\\S+)\\s*Option:\\s*(?<option>\\S+)\\s*Exterior:\\s*(?<exteriorColor>\\S+)\\s*Interior:\\s*(?<interiorColor>\\S+)\\s*From:\\s*(?<productionFrom>[\\d.]+)\\s*To:\\s*(?<productionTo>[\\d.]+)",
    "i"
  );

  // src/vehicle/vehicle-session.ts
  function newSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  async function createSession(vin, now) {
    const session = {
      sessionId: newSessionId(),
      vin,
      startedAt: now,
      lastActivityAt: now,
      partCount: 0,
      status: "active"
    };
    await Database.putSession(session);
    return session;
  }
  async function closeSession(session, now) {
    const closed = { ...session, status: "closed", closedAt: now, lastActivityAt: now };
    await Database.putSession(closed);
  }
  async function setActiveVehicleManually(vin) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
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
        lastSeen: now
      });
    }
    return session;
  }
  async function closeActiveSession() {
    const activeSession = await Database.getActiveSession();
    if (!activeSession) return;
    await closeSession(activeSession, (/* @__PURE__ */ new Date()).toISOString());
  }

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
  function rowsToJson(rows) {
    return JSON.stringify(rows, null, 2);
  }
  function triggerDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 5e3);
  }
  async function exportCsv() {
    const rows = await buildCatalogueRows();
    triggerDownload(`asa-caps-catalogue-${Date.now()}.csv`, rowsToCsv(rows), "text/csv");
  }
  async function exportJson() {
    const rows = await buildCatalogueRows();
    triggerDownload(`asa-caps-catalogue-${Date.now()}.json`, rowsToJson(rows), "application/json");
  }

  // src/popup/popup.ts
  var $ = (id) => document.getElementById(id);
  var els = {
    pauseToggle: $("pauseToggle"),
    activeVehicleEmpty: $("activeVehicleEmpty"),
    activeVehicleContent: $("activeVehicleContent"),
    vehicleTitle: $("vehicleTitle"),
    vehicleVin: $("vehicleVin"),
    sessionStarted: $("sessionStarted"),
    partCount: $("partCount"),
    recentPartsList: $("recentPartsList"),
    recentPartsEmpty: $("recentPartsEmpty"),
    btnManualVehicle: $("btnManualVehicle"),
    btnCloseSession: $("btnCloseSession"),
    btnClearSession: $("btnClearSession"),
    manualVehicleForm: $("manualVehicleForm"),
    manualVinInput: $("manualVinInput"),
    btnManualVehicleConfirm: $("btnManualVehicleConfirm"),
    btnManualVehicleCancel: $("btnManualVehicleCancel"),
    manualVehicleError: $("manualVehicleError"),
    btnViewCatalogue: $("btnViewCatalogue"),
    btnExport: $("btnExport"),
    debugToggle: $("debugToggle"),
    debugPanel: $("debugPanel"),
    debugContent: $("debugContent"),
    btnCopyDebug: $("btnCopyDebug"),
    logUnknownToggle: $("logUnknownToggle"),
    linkInspector: $("linkInspector"),
    toast: $("toast")
  };
  var lastDebugInfo = null;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.remove("hidden");
    setTimeout(() => els.toast.classList.add("hidden"), 2200);
  }
  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function vehicleTitleText(vehicle, vin) {
    if (!vehicle) return vin;
    const parts = [vehicle.make, vehicle.model ?? vehicle.modelCode, vehicle.variant].filter(Boolean);
    return parts.length ? parts.join(" ") : vin;
  }
  async function renderActiveVehicle() {
    const session = await Database.getActiveSession();
    if (!session) {
      els.activeVehicleEmpty.classList.remove("hidden");
      els.activeVehicleContent.classList.add("hidden");
      els.recentPartsList.innerHTML = "";
      els.recentPartsEmpty.classList.remove("hidden");
      return;
    }
    const vehicle = await Database.getVehicle(session.vin);
    els.activeVehicleEmpty.classList.add("hidden");
    els.activeVehicleContent.classList.remove("hidden");
    els.vehicleTitle.textContent = vehicleTitleText(vehicle, session.vin);
    els.vehicleVin.textContent = `VIN: ${session.vin}`;
    els.sessionStarted.textContent = `Session started: ${formatTime(session.startedAt)}`;
    els.partCount.textContent = `Parts captured: ${session.partCount}`;
    await renderRecentParts(session);
  }
  async function renderRecentParts(session) {
    const fitments = await Database.listFitmentsForVin(session.vin);
    const sorted = fitments.sort(
      (a, b) => b.lastCapturedAt.localeCompare(a.lastCapturedAt)
    );
    els.recentPartsList.innerHTML = "";
    if (sorted.length === 0) {
      els.recentPartsEmpty.classList.remove("hidden");
      return;
    }
    els.recentPartsEmpty.classList.add("hidden");
    for (const fitment of sorted.slice(0, 10)) {
      const li = document.createElement("li");
      li.innerHTML = `
      <div class="part-number">${escapeHtml(fitment.partNumber)}</div>
      ${fitment.description ? `<div class="part-desc">${escapeHtml(fitment.description)}</div>` : ""}
    `;
      els.recentPartsList.appendChild(li);
    }
  }
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  async function renderSettings() {
    const settings = await Database.getSettings();
    els.pauseToggle.checked = !settings.captureEnabled;
    els.logUnknownToggle.checked = settings.logUnknownEvents;
    els.debugToggle.checked = settings.debugMode;
    els.debugPanel.classList.toggle("hidden", !settings.debugMode);
  }
  async function renderDebugPanel() {
    const stored = await chrome.storage.local.get("lastDebugEvent");
    lastDebugInfo = stored.lastDebugEvent ?? null;
    if (!lastDebugInfo) {
      els.debugContent.innerHTML = "<dt>No events captured yet.</dt>";
      return;
    }
    const info = lastDebugInfo;
    const partsSummary = info.detectedParts.length ? info.detectedParts.map((p) => p.partNumber + (p.description ? ` (${p.description})` : "")).join(", ") : "\u2014";
    els.debugContent.innerHTML = `
    <dt>Classification</dt><dd>${escapeHtml(info.classification)}</dd>
    <dt>Detected VIN</dt><dd>${escapeHtml(info.detectedVIN ?? "\u2014")}</dd>
    <dt>Detected Part(s)</dt><dd>${escapeHtml(partsSummary)}</dd>
    <dt>Action</dt><dd>${escapeHtml(info.action)}</dd>
    <dt>Raw text</dt><dd>${escapeHtml(info.rawText.slice(0, 200))}</dd>
  `;
  }
  async function refreshAll() {
    await Promise.all([renderActiveVehicle(), renderSettings(), renderDebugPanel()]);
  }
  els.pauseToggle.addEventListener("change", async () => {
    const settings = await Database.getSettings();
    settings.captureEnabled = !els.pauseToggle.checked;
    await Database.putSettings(settings);
    showToast(settings.captureEnabled ? "Capture resumed" : "Capture paused");
  });
  els.debugToggle.addEventListener("change", async () => {
    const settings = await Database.getSettings();
    settings.debugMode = els.debugToggle.checked;
    await Database.putSettings(settings);
    els.debugPanel.classList.toggle("hidden", !settings.debugMode);
  });
  els.logUnknownToggle.addEventListener("change", async () => {
    const settings = await Database.getSettings();
    settings.logUnknownEvents = els.logUnknownToggle.checked;
    await Database.putSettings(settings);
  });
  els.btnManualVehicle.addEventListener("click", () => {
    els.manualVehicleForm.classList.toggle("hidden");
    els.manualVehicleError.classList.add("hidden");
    els.manualVinInput.focus();
  });
  els.btnManualVehicleCancel.addEventListener("click", () => {
    els.manualVehicleForm.classList.add("hidden");
    els.manualVinInput.value = "";
  });
  els.btnManualVehicleConfirm.addEventListener("click", async () => {
    const vin = els.manualVinInput.value.trim().toUpperCase();
    if (!isValidVin(vin)) {
      els.manualVehicleError.textContent = "Not a valid 17-character VIN.";
      els.manualVehicleError.classList.remove("hidden");
      return;
    }
    await setActiveVehicleManually(vin);
    els.manualVehicleForm.classList.add("hidden");
    els.manualVinInput.value = "";
    showToast(`Active vehicle set to ${vin}`);
    await refreshAll();
  });
  els.btnCloseSession.addEventListener("click", async () => {
    await closeActiveSession();
    showToast("Vehicle session closed");
    await refreshAll();
  });
  els.btnClearSession.addEventListener("click", async () => {
    await closeActiveSession();
    showToast("Session cleared");
    await refreshAll();
  });
  els.btnViewCatalogue.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dist/catalogue/catalogue.html") });
  });
  els.btnExport.addEventListener("click", async () => {
    await exportCsv();
    await exportJson();
    showToast("Catalogue exported");
  });
  els.btnCopyDebug.addEventListener("click", async () => {
    if (!lastDebugInfo) return;
    await navigator.clipboard.writeText(JSON.stringify(lastDebugInfo, null, 2));
    showToast("Debug info copied");
  });
  els.linkInspector.href = chrome.runtime.getURL("dist/inspector/inspector.html");
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "STATE_UPDATED") {
      refreshAll();
    }
  });
  refreshAll();
})();
//# sourceMappingURL=popup.js.map
