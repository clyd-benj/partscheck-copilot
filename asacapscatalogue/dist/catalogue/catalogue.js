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
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (inQuotes) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\r") {
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
  }
  async function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { vehiclesImported: 0, fitmentsImported: 0 };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const colIndex = (name) => header.indexOf(name);
    const col = {
      vin: colIndex("vin"),
      make: colIndex("make"),
      model: colIndex("model"),
      variant: colIndex("variant"),
      year: colIndex("year"),
      modelCode: colIndex("model code"),
      chassisCode: colIndex("chassis code"),
      classification: colIndex("classification"),
      option: colIndex("option"),
      exteriorColor: colIndex("exterior color"),
      interiorColor: colIndex("interior color"),
      partNumber: colIndex("part number"),
      pnc: colIndex("pnc"),
      description: colIndex("description"),
      timesCopied: colIndex("times copied"),
      firstCaptured: colIndex("first captured"),
      lastCaptured: colIndex("last captured")
    };
    if (col.vin === -1 || col.partNumber === -1) {
      throw new Error('CSV must have "VIN" and "Part Number" columns (use a file exported from this extension).');
    }
    const cell = (row, index) => {
      if (index < 0) return void 0;
      const value = row[index]?.trim();
      return value ? value : void 0;
    };
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const touchedVins = /* @__PURE__ */ new Set();
    let fitmentsImported = 0;
    for (const row of rows.slice(1)) {
      const vin = cell(row, col.vin);
      const partNumber = cell(row, col.partNumber);
      if (!vin || !partNumber) continue;
      const firstCapturedAt = cell(row, col.firstCaptured) ?? now;
      const lastCapturedAt = cell(row, col.lastCaptured) ?? firstCapturedAt;
      const timesCopiedRaw = cell(row, col.timesCopied);
      const timesCopied = timesCopiedRaw ? parseInt(timesCopiedRaw, 10) || 1 : 1;
      if (!touchedVins.has(vin)) {
        touchedVins.add(vin);
        const existingVehicle = await Database.getVehicle(vin);
        const vehicle = {
          id: vin,
          vin,
          make: cell(row, col.make) ?? existingVehicle?.make,
          model: cell(row, col.model) ?? existingVehicle?.model,
          variant: cell(row, col.variant) ?? existingVehicle?.variant,
          year: cell(row, col.year) ?? existingVehicle?.year,
          modelCode: cell(row, col.modelCode) ?? existingVehicle?.modelCode,
          chassisCode: cell(row, col.chassisCode) ?? existingVehicle?.chassisCode,
          classification: cell(row, col.classification) ?? existingVehicle?.classification,
          option: cell(row, col.option) ?? existingVehicle?.option,
          exteriorColor: cell(row, col.exteriorColor) ?? existingVehicle?.exteriorColor,
          interiorColor: cell(row, col.interiorColor) ?? existingVehicle?.interiorColor,
          rawText: existingVehicle?.rawText ?? "",
          firstSeen: existingVehicle?.firstSeen ?? firstCapturedAt,
          lastSeen: existingVehicle?.lastSeen && existingVehicle.lastSeen > lastCapturedAt ? existingVehicle.lastSeen : lastCapturedAt
        };
        await Database.putVehicle(vehicle);
      }
      const normalisedPartNumber = partNumber.toUpperCase();
      const fitmentId = `${vin}::${normalisedPartNumber}`;
      const existingFitment = await Database.getFitment(fitmentId);
      const fitment = {
        id: fitmentId,
        vin,
        sessionId: existingFitment?.sessionId ?? "imported",
        partNumber: normalisedPartNumber,
        description: cell(row, col.description) ?? existingFitment?.description,
        pnc: cell(row, col.pnc) ?? existingFitment?.pnc,
        timesCopied: Math.max(existingFitment?.timesCopied ?? 0, timesCopied),
        firstCapturedAt: existingFitment && existingFitment.firstCapturedAt < firstCapturedAt ? existingFitment.firstCapturedAt : firstCapturedAt,
        lastCapturedAt: existingFitment && existingFitment.lastCapturedAt > lastCapturedAt ? existingFitment.lastCapturedAt : lastCapturedAt
      };
      await Database.putFitment(fitment);
      fitmentsImported++;
    }
    return { vehiclesImported: touchedVins.size, fitmentsImported };
  }

  // src/shared/coverage.ts
  var READY_THRESHOLD = 20;
  async function buildCoverageSummary() {
    const [vehicles, fitments] = await Promise.all([Database.listVehicles(), Database.listFitments()]);
    const partCountByVin = /* @__PURE__ */ new Map();
    for (const fitment of fitments) {
      partCountByVin.set(fitment.vin, (partCountByVin.get(fitment.vin) ?? 0) + 1);
    }
    const groupsByKey = /* @__PURE__ */ new Map();
    for (const vehicle of vehicles) {
      const key = vehicle.classification || vehicle.modelCode || "Unclassified";
      const entry = groupsByKey.get(key) ?? { vehicleCount: 0, partCount: 0 };
      entry.vehicleCount += 1;
      entry.partCount += partCountByVin.get(vehicle.vin) ?? 0;
      groupsByKey.set(key, entry);
    }
    const groups = Array.from(groupsByKey.entries()).map(([classification, { vehicleCount, partCount }]) => ({
      classification,
      vehicleCount,
      partCount,
      ready: vehicleCount >= READY_THRESHOLD
    })).sort((a, b) => b.vehicleCount - a.vehicleCount || b.partCount - a.partCount);
    return {
      totalVehicles: vehicles.length,
      totalFitments: fitments.length,
      readyGroups: groups.filter((g) => g.ready).length,
      groups
    };
  }

  // src/catalogue/catalogue.ts
  var $ = (id) => document.getElementById(id);
  var els = {
    searchInput: $("searchInput"),
    resultCount: $("resultCount"),
    tableBody: $("tableBody"),
    emptyState: $("emptyState"),
    groupedResults: $("groupedResults"),
    btnImportCsv: $("btnImportCsv"),
    importCsvInput: $("importCsvInput"),
    importStatus: $("importStatus"),
    btnExportCsv: $("btnExportCsv"),
    btnExportJson: $("btnExportJson"),
    coverageSummaryText: $("coverageSummaryText"),
    coverageGroups: $("coverageGroups"),
    coverageEmpty: $("coverageEmpty"),
    backupStatusText: $("backupStatusText"),
    btnConnectBackupFolder: $("btnConnectBackupFolder"),
    backupEnabledToggle: $("backupEnabledToggle"),
    btnBackupNow: $("btnBackupNow")
  };
  var allRows = [];
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
  function vehicleLabel(row) {
    const parts = [row.make, row.model ?? row.modelCode, row.variant, row.year].filter(Boolean);
    return parts.length ? parts.join(" ") : "\u2014";
  }
  function matchesQuery(row, query) {
    if (!query) return true;
    const haystack = [
      row.vin,
      row.partNumber,
      row.pnc,
      row.description,
      row.make,
      row.model,
      row.variant,
      row.year,
      row.modelCode,
      row.chassisCode,
      row.classification,
      row.option,
      row.exteriorColor,
      row.interiorColor
    ].filter(Boolean).join(" ").toUpperCase();
    return haystack.includes(query.toUpperCase());
  }
  function renderTable(rows) {
    els.tableBody.innerHTML = "";
    els.emptyState.classList.toggle("hidden", rows.length > 0);
    els.resultCount.textContent = `${rows.length} fitment${rows.length === 1 ? "" : "s"}`;
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
      <td class="mono">${escapeHtml(row.vin)}</td>
      <td>${escapeHtml(vehicleLabel(row))}</td>
      <td class="mono">${escapeHtml(row.partNumber)}</td>
      <td class="mono">${escapeHtml(row.pnc ?? "\u2014")}</td>
      <td>${escapeHtml(row.description ?? "\u2014")}</td>
      <td>${row.timesCopied}</td>
      <td>${new Date(row.firstCapturedAt).toLocaleString()}</td>
      <td>${new Date(row.lastCapturedAt).toLocaleString()}</td>
    `;
      els.tableBody.appendChild(tr);
    }
  }
  function renderGrouped(query) {
    const trimmed = query.trim().toUpperCase();
    if (!trimmed) {
      els.groupedResults.classList.add("hidden");
      els.groupedResults.innerHTML = "";
      return;
    }
    const byPartNumber = /* @__PURE__ */ new Map();
    for (const row of allRows) {
      if (row.partNumber.toUpperCase() !== trimmed) continue;
      const list = byPartNumber.get(row.partNumber) ?? [];
      list.push(row);
      byPartNumber.set(row.partNumber, list);
    }
    if (byPartNumber.size === 0) {
      els.groupedResults.classList.add("hidden");
      els.groupedResults.innerHTML = "";
      return;
    }
    els.groupedResults.classList.remove("hidden");
    els.groupedResults.innerHTML = "";
    for (const [partNumber, rows] of byPartNumber) {
      const card = document.createElement("div");
      card.className = "grouped-card";
      const description = rows.find((r) => r.description)?.description ?? "";
      card.innerHTML = `
      <h3>${escapeHtml(partNumber)}</h3>
      ${description ? `<div class="desc">${escapeHtml(description)}</div>` : ""}
      <div class="seen-on">Seen on ${rows.length} vehicle${rows.length === 1 ? "" : "s"}:</div>
      <ul>
        ${rows.map((r) => `<li>${escapeHtml(r.vin)} \u2014 ${escapeHtml(vehicleLabel(r))}</li>`).join("")}
      </ul>
    `;
      els.groupedResults.appendChild(card);
    }
  }
  function render() {
    const query = els.searchInput.value.trim();
    const filtered = allRows.filter((row) => matchesQuery(row, query));
    renderTable(filtered);
    renderGrouped(query);
  }
  async function renderCoverage() {
    const summary = await buildCoverageSummary();
    if (summary.totalVehicles === 0) {
      els.coverageEmpty.classList.remove("hidden");
      els.coverageGroups.innerHTML = "";
      els.coverageSummaryText.textContent = "";
      return;
    }
    els.coverageEmpty.classList.add("hidden");
    els.coverageSummaryText.textContent = `${summary.totalVehicles} vehicle${summary.totalVehicles === 1 ? "" : "s"}, ${summary.totalFitments} part${summary.totalFitments === 1 ? "" : "s"}, ${summary.readyGroups} trim${summary.readyGroups === 1 ? "" : "s"} ready for matching`;
    els.coverageGroups.innerHTML = summary.groups.map(
      (group) => `
        <div class="coverage-chip ${group.ready ? "ready" : ""}">
          <span class="classification">${escapeHtml(group.classification)}</span>
          <span class="count">${group.vehicleCount} vehicle${group.vehicleCount === 1 ? "" : "s"} \xB7 ${group.partCount} part${group.partCount === 1 ? "" : "s"}</span>
          <span class="badge">${group.ready ? "Ready" : "Building"}</span>
        </div>
      `
    ).join("");
  }
  async function renderBackupStatus() {
    const state = await Database.getBackupState();
    els.backupEnabledToggle.checked = state.enabled;
    els.backupEnabledToggle.disabled = !state.folderHandle;
    const parts = [state.folderName ? `Folder: ${state.folderName}` : "No folder connected"];
    if (state.lastBackupAt) parts.push(`Last backup: ${new Date(state.lastBackupAt).toLocaleString()}`);
    if (state.lastError) parts.push(`\u26A0 ${state.lastError}`);
    els.backupStatusText.textContent = parts.join(" \xB7 ");
  }
  els.btnConnectBackupFolder.addEventListener("click", async () => {
    try {
      const handle = await window.showDirectoryPicker({
        id: "asa-caps-backup",
        mode: "readwrite",
        startIn: "documents"
      });
      const state = await Database.getBackupState();
      await Database.putBackupState({
        ...state,
        folderHandle: handle,
        folderName: handle.name,
        enabled: true,
        lastError: void 0
      });
      await renderBackupStatus();
      showImportStatus(`Backup folder connected: "${handle.name}". Auto-backup enabled.`, "success");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      showImportStatus(err instanceof Error ? err.message : "Could not connect a backup folder.", "error");
    }
  });
  els.backupEnabledToggle.addEventListener("change", async () => {
    const state = await Database.getBackupState();
    await Database.putBackupState({ ...state, enabled: els.backupEnabledToggle.checked });
    await renderBackupStatus();
  });
  els.btnBackupNow.addEventListener("click", async () => {
    els.btnBackupNow.disabled = true;
    try {
      await chrome.runtime.sendMessage({ type: "RUN_BACKUP_NOW" });
    } finally {
      await renderBackupStatus();
      els.btnBackupNow.disabled = false;
    }
  });
  els.searchInput.addEventListener("input", render);
  els.btnExportCsv.addEventListener("click", () => {
    triggerDownload(`asa-caps-catalogue-${Date.now()}.csv`, rowsToCsv(allRows), "text/csv");
  });
  els.btnExportJson.addEventListener("click", () => {
    triggerDownload(`asa-caps-catalogue-${Date.now()}.json`, rowsToJson(allRows), "application/json");
  });
  function showImportStatus(message, kind) {
    els.importStatus.textContent = message;
    els.importStatus.className = `import-status ${kind}`;
  }
  els.btnImportCsv.addEventListener("click", () => {
    els.importCsvInput.click();
  });
  els.importCsvInput.addEventListener("change", async () => {
    const file = els.importCsvInput.files?.[0];
    els.importCsvInput.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const result = await importCsv(text);
      showImportStatus(
        `Imported ${result.vehiclesImported} vehicle${result.vehiclesImported === 1 ? "" : "s"} and ${result.fitmentsImported} part${result.fitmentsImported === 1 ? "" : "s"} from "${file.name}".`,
        "success"
      );
      await refresh();
    } catch (err) {
      showImportStatus(err instanceof Error ? err.message : "Import failed.", "error");
    }
  });
  async function refresh() {
    allRows = await buildCatalogueRows();
    render();
    await renderCoverage();
    await renderBackupStatus();
  }
  async function init() {
    await refresh();
  }
  init();
})();
//# sourceMappingURL=catalogue.js.map
