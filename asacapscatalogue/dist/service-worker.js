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
var LABEL_PATTERNS = [
  { pattern: /vehicle identification number/i, score: 5 },
  { pattern: /\bv\.?i\.?n\.?\b/i, score: 4 },
  { pattern: /\bchassis\s*(no\.?|number)?\b/i, score: 3 }
];
var RECENCY_BOOST = /\bnew\b|\bcurrent\b/i;
var RECENCY_PENALTY = /\bprevious\b|\bold\b|\bprior\b|\bformer\b/i;
function looksLikeVin(candidate) {
  const hasLetter = /[A-Z]/i.test(candidate);
  const hasDigit = /[0-9]/.test(candidate);
  if (!hasLetter || !hasDigit) return false;
  if (/^(.)\1+$/.test(candidate)) return false;
  return true;
}
function findVinCandidates(text) {
  const candidates = [];
  let match;
  VIN_REGEX.lastIndex = 0;
  while ((match = VIN_REGEX.exec(text)) !== null) {
    const raw = match[0].toUpperCase();
    if (!looksLikeVin(raw)) continue;
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const lineEnd = text.indexOf("\n", match.index);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const windowStart = Math.max(0, match.index - 60);
    const before = text.slice(windowStart, match.index);
    const contextForLabel = line + " " + before;
    let score = 0;
    for (const { pattern, score: labelScore } of LABEL_PATTERNS) {
      if (pattern.test(contextForLabel)) {
        score = Math.max(score, labelScore);
      }
    }
    const wideWindow = text.slice(Math.max(0, match.index - 80), match.index);
    if (RECENCY_BOOST.test(wideWindow)) score += 1;
    if (RECENCY_PENALTY.test(wideWindow)) score -= 1;
    candidates.push({ vin: raw, index: match.index, score });
  }
  return candidates;
}
function extractVIN(text) {
  if (!text || typeof text !== "string") return null;
  const candidates = findVinCandidates(text);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.index - a.index;
  });
  return candidates[0].vin;
}

// src/parts/part-parser.ts
var PART_NUMBER_PATTERNS = [
  // e.g. 5253AN28, 5301J910, 6400A123, 6400BW040P, 7410A708XA, 6512A954XA,
  // 82821W070P — 4-5 digits, 1-2 letters, 2-4 digits, and an optional 0-2
  // letter colour/option suffix code.
  /^\d{4,5}[A-Z]{1,2}\d{2,4}[A-Z]{0,2}$/,
  /^M[RN]\d{5,7}$/,
  // e.g. MR123456, MN123456
  /^\d{6,8}$/,
  // plain numeric part numbers (6-8 digits)
  /^[A-Z]{2}\d{5,8}$/
  // two-letter prefix + digits
];
var PART_LABEL = /part\s*(no\.?|number)?\s*[:\-]\s*(.+)/i;
var DESCRIPTION_LABEL = /description\s*[:\-]\s*(.+)/i;
var PNC_LABEL = /^pnc\s*[:\-]\s*(.+)$/i;
function normalisePartNumber(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}
function matchesPartPattern(token) {
  const normalised = normalisePartNumber(token);
  return PART_NUMBER_PATTERNS.some((pattern) => pattern.test(normalised));
}
function findPartToken(line) {
  const tokens = line.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const cleaned = tokens[i].replace(/[.,;]+$/, "");
    if (matchesPartPattern(cleaned)) {
      const rest = tokens.filter((_, idx) => idx !== i).join(" ").trim();
      return { partNumber: normalisePartNumber(cleaned), rest };
    }
  }
  return null;
}
function extractPnc(text) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(PNC_LABEL);
    if (match) return match[1].trim().toUpperCase();
  }
  return void 0;
}
function stripPncLines(text) {
  return text.split(/\r?\n/).filter((line) => !PNC_LABEL.test(line.trim())).join("\n");
}
function extractPart(text) {
  if (!text || typeof text !== "string") return null;
  const pnc = extractPnc(text);
  const withoutPnc = pnc ? stripPncLines(text) : text;
  const labeledPartMatch = withoutPnc.match(PART_LABEL);
  if (labeledPartMatch) {
    const candidate = labeledPartMatch[2].trim().split(/\r?\n/)[0].trim();
    if (matchesPartPattern(candidate)) {
      const result = { partNumber: normalisePartNumber(candidate) };
      const descMatch = withoutPnc.match(DESCRIPTION_LABEL);
      if (descMatch) {
        const desc = descMatch[1].trim().split(/\r?\n/)[0].trim();
        if (desc) result.description = desc;
      }
      if (pnc) result.pnc = pnc;
      return result;
    }
  }
  const lines = withoutPnc.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  if (lines.length === 1) {
    const found = findPartToken(lines[0]);
    if (!found) return null;
    const result = { partNumber: found.partNumber };
    if (found.rest) result.description = found.rest;
    if (pnc) result.pnc = pnc;
    return result;
  }
  for (let i = 0; i < lines.length; i++) {
    const cleaned = lines[i].replace(/[.,;]+$/, "");
    if (matchesPartPattern(cleaned)) {
      const partNumber = normalisePartNumber(cleaned);
      const descriptionLine = lines.find((l, idx) => idx !== i);
      const result = { partNumber };
      if (descriptionLine) result.description = descriptionLine;
      if (pnc) result.pnc = pnc;
      return result;
    }
  }
  for (const line of lines.slice(0, 2)) {
    const found = findPartToken(line);
    if (found) {
      const result = { partNumber: found.partNumber };
      const otherLine = lines.find((l) => l !== line);
      const description = [found.rest, otherLine].filter(Boolean).join(" ").trim();
      if (description) result.description = description;
      if (pnc) result.pnc = pnc;
      return result;
    }
  }
  return null;
}
function parseTabularRow(line) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const startIdx = /^\d{1,3}$/.test(tokens[0]) && tokens.length > 1 ? 1 : 0;
  const candidate = tokens[startIdx]?.replace(/[.,;]+$/, "");
  if (!candidate || !matchesPartPattern(candidate)) return null;
  const descriptionTokens = [];
  for (const token of tokens.slice(startIdx + 1)) {
    if (/^[\d.,]+$/.test(token)) break;
    descriptionTokens.push(token);
  }
  const result = { partNumber: normalisePartNumber(candidate) };
  const description = descriptionTokens.join(" ").trim();
  if (description) result.description = description;
  return result;
}
function extractParts(text) {
  if (!text || typeof text !== "string") return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const tabularMatches = lines.map(parseTabularRow).filter((p) => p !== null);
  if (tabularMatches.length > 1) {
    const seen = /* @__PURE__ */ new Map();
    for (const part of tabularMatches) {
      if (!seen.has(part.partNumber)) seen.set(part.partNumber, part);
    }
    return Array.from(seen.values());
  }
  const single = extractPart(text);
  return single ? [single] : [];
}

// src/clipboard/clipboard-parser.ts
function classifyClipboardText(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return { classification: "UNKNOWN", vin: null, parts: [] };
  }
  const vin = extractVIN(trimmed);
  if (vin) {
    return { classification: "VEHICLE", vin, parts: [] };
  }
  const parts = extractParts(trimmed);
  if (parts.length > 0) {
    return { classification: "PART", vin: null, parts };
  }
  return { classification: "UNKNOWN", vin: null, parts: [] };
}

// src/vehicle/vehicle-extract.ts
var KNOWN_MAKES = [
  "MITSUBISHI",
  "TOYOTA",
  "NISSAN",
  "MAZDA",
  "HONDA",
  "SUBARU",
  "SUZUKI",
  "ISUZU",
  "FORD",
  "HOLDEN",
  "HYUNDAI",
  "KIA",
  "VOLKSWAGEN",
  "MERCEDES-BENZ",
  "MERCEDES",
  "BMW",
  "AUDI",
  "LEXUS",
  "JEEP",
  "RAM",
  "CHEVROLET",
  "GREAT WALL",
  "GWM",
  "LDV",
  "SSANGYONG",
  "RENAULT",
  "PEUGEOT",
  "VOLVO",
  "LAND ROVER",
  "JAGUAR",
  "MG",
  "HAVAL",
  "CHERY",
  "FIAT",
  "SKODA"
];
var TRANSMISSION_WORDS = /\b(automatic|auto|manual|cvt|tiptronic|s-cvt)\b/i;
var ENGINE_PATTERN = /\b\d(?:\.\d)?\s*L\b[^,\n]*?(?:diesel|petrol|turbo|hybrid|electric)?/i;
var ENGINE_KEYWORD_LINE = /\b(diesel|petrol|turbo diesel|hybrid|electric)\b/i;
var YEAR_PATTERN = /\b(19[5-9]\d|20[0-4]\d)\b/;
var ASA_TECH_INFO = new RegExp(
  "Model:\\s*(?<modelCode>\\S+)\\s*Classification:\\s*(?<classification>\\S+)\\s*Option:\\s*(?<option>\\S+)\\s*Exterior:\\s*(?<exteriorColor>\\S+)\\s*Interior:\\s*(?<interiorColor>\\S+)\\s*From:\\s*(?<productionFrom>[\\d.]+)\\s*To:\\s*(?<productionTo>[\\d.]+)",
  "i"
);
var ASA_MODEL_LINE = /\b([A-Z][A-Z0-9 \-]{1,30}?)\(([A-Z0-9/]{2,20})\)\s*([^\n]+?)(?=\s+VIN:|$)/i;
function extractAsaCapsFields(text) {
  const fields = {};
  const techMatch = text.match(ASA_TECH_INFO);
  if (techMatch?.groups) {
    fields.make = "Mitsubishi";
    fields.modelCode = techMatch.groups.modelCode;
    fields.classification = techMatch.groups.classification;
    fields.option = techMatch.groups.option;
    fields.exteriorColor = techMatch.groups.exteriorColor;
    fields.interiorColor = techMatch.groups.interiorColor;
    fields.productionFrom = techMatch.groups.productionFrom;
    fields.productionTo = techMatch.groups.productionTo;
    const yearFromProd = techMatch.groups.productionFrom?.match(/^(\d{4})/);
    if (yearFromProd) fields.year = yearFromProd[1];
  }
  const modelLineMatch = text.match(ASA_MODEL_LINE);
  if (modelLineMatch) {
    fields.make = fields.make ?? "Mitsubishi";
    fields.model = modelLineMatch[1].trim();
    fields.chassisCode = modelLineMatch[2];
    const variant = modelLineMatch[3].trim();
    if (variant) fields.variant = variant;
    const transMatch = variant.match(TRANSMISSION_WORDS);
    if (transMatch) fields.transmission = capitalise(transMatch[1]);
  }
  return fields;
}
function extractVehicleFields(text, vin) {
  const asaFields = extractAsaCapsFields(text);
  const generic = extractGenericVehicleFields(text, vin);
  return { ...generic, ...asaFields };
}
function extractGenericVehicleFields(text, vin) {
  const fields = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const vinUpper = vin.toUpperCase();
  for (const line of lines) {
    if (line.toUpperCase().includes(vinUpper)) continue;
    if (!fields.year) {
      const yearMatch = line.match(YEAR_PATTERN);
      if (yearMatch) fields.year = yearMatch[1];
    }
    if (!fields.transmission) {
      const transMatch = line.match(TRANSMISSION_WORDS);
      if (transMatch) fields.transmission = capitalise(transMatch[1]);
    }
    if (!fields.engine) {
      const engineMatch = line.match(ENGINE_PATTERN);
      if (engineMatch) {
        fields.engine = engineMatch[0].trim();
      } else if (ENGINE_KEYWORD_LINE.test(line) && line.length < 40) {
        fields.engine = line;
      }
    }
    if (!fields.make) {
      const upperLine = line.toUpperCase();
      const foundMake = KNOWN_MAKES.find((make) => upperLine.includes(make));
      if (foundMake) {
        fields.make = capitaliseMake(foundMake);
        const rest = line.replace(new RegExp(foundMake, "i"), "").trim().replace(/^[-,:]\s*/, "");
        if (rest) {
          const parts = rest.split(/\s+/);
          fields.model = parts[0];
          if (parts.length > 1) {
            fields.variant = parts.slice(1).join(" ");
          }
        }
      }
    }
  }
  return fields;
}
function capitalise(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
function capitaliseMake(make) {
  if (make === "BMW" || make === "MG" || make === "GWM") return make;
  return make.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// src/vehicle/vehicle-session.ts
function newSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
async function upsertVehicle(vin, text, now) {
  const existing = await Database.getVehicle(vin);
  const fields = extractVehicleFields(text, vin);
  const vehicle = {
    id: vin,
    vin,
    ...existing ?? {},
    ...fields,
    rawText: text,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now
  };
  await Database.putVehicle(vehicle);
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
async function savePartToActiveVehicle(session, part, now) {
  const fitmentId = `${session.vin}::${part.partNumber}`;
  const existing = await Database.getFitment(fitmentId);
  const fitment = existing ? {
    ...existing,
    description: existing.description ?? part.description,
    pnc: existing.pnc ?? part.pnc,
    timesCopied: existing.timesCopied + 1,
    lastCapturedAt: now
  } : {
    id: fitmentId,
    vin: session.vin,
    sessionId: session.sessionId,
    partNumber: part.partNumber,
    description: part.description,
    pnc: part.pnc,
    timesCopied: 1,
    firstCapturedAt: now,
    lastCapturedAt: now
  };
  await Database.putFitment(fitment);
  const updatedSession = {
    ...session,
    partCount: existing ? session.partCount : session.partCount + 1,
    lastActivityAt: now
  };
  await Database.putSession(updatedSession);
  return updatedSession;
}
async function processClipboardText(text) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { classification, vin, parts } = classifyClipboardText(text);
  if (classification === "VEHICLE" && vin) {
    const activeSession2 = await Database.getActiveSession();
    let vinChanged = false;
    let notification = null;
    let action;
    let resultSession;
    if (!activeSession2) {
      resultSession = await createSession(vin, now);
      action = "New vehicle session created";
    } else if (activeSession2.vin !== vin) {
      await closeSession(activeSession2, now);
      resultSession = await createSession(vin, now);
      vinChanged = true;
      notification = {
        previousVin: activeSession2.vin,
        newVin: vin,
        partsSavedToPrevious: activeSession2.partCount
      };
      action = "Vehicle changed: previous session closed, new session created";
    } else {
      resultSession = { ...activeSession2, lastActivityAt: now };
      await Database.putSession(resultSession);
      action = "Active vehicle session updated (same VIN)";
    }
    await upsertVehicle(vin, text, now);
    return { classification, vin, parts: [], action, vinChanged, activeSession: resultSession, notification };
  }
  if (classification === "PART" && parts.length > 0) {
    let activeSession2 = await Database.getActiveSession();
    if (!activeSession2) {
      return {
        classification,
        vin: null,
        parts,
        action: "Ignored: part(s) detected but no active vehicle session",
        vinChanged: false,
        activeSession: null,
        notification: null
      };
    }
    for (const part of parts) {
      activeSession2 = await savePartToActiveVehicle(activeSession2, part, now);
    }
    return {
      classification,
      vin: null,
      parts,
      action: parts.length === 1 ? `Saved to active vehicle (${activeSession2.vin})` : `Saved ${parts.length} parts to active vehicle (${activeSession2.vin})`,
      vinChanged: false,
      activeSession: activeSession2,
      notification: null
    };
  }
  const settings = await Database.getSettings();
  if (settings.logUnknownEvents) {
    await Database.addEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      capturedAt: now,
      classification: "UNKNOWN",
      textPreview: text.slice(0, 80),
      fullTextStored: false
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
    notification: null
  };
}

// src/background/service-worker.ts
var LOG_PREFIX = "[ASA CAPS Catalogue:bg]";
var AUTO_BACKUP_ALARM = "autoBackup";
console.log(LOG_PREFIX, "service worker started");
function scheduleAutoBackupAlarm() {
  chrome.alarms.create(AUTO_BACKUP_ALARM, { periodInMinutes: 60 });
}
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await Database.getSettings();
  await Database.putSettings(settings);
  scheduleAutoBackupAlarm();
});
chrome.runtime.onStartup.addListener(scheduleAutoBackupAlarm);
async function broadcastStateUpdated() {
  try {
    await chrome.runtime.sendMessage({ type: "STATE_UPDATED" });
  } catch {
  }
}
function notifyVinChange(previousVin, newVin, partsSaved) {
  chrome.notifications?.create(`vin-change-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "New vehicle detected",
    message: `Previous: ${previousVin}
New: ${newVin}
${partsSaved} part${partsSaved === 1 ? "" : "s"} saved to previous vehicle.
Active vehicle switched.`
  });
}
async function handleClipboardCapture(text) {
  console.log(LOG_PREFIX, "received CLIPBOARD_CAPTURE:", text.slice(0, 120));
  const settings = await Database.getSettings();
  if (!settings.captureEnabled) {
    console.log(LOG_PREFIX, "capture is paused (settings.captureEnabled=false), ignoring");
    return;
  }
  const result = await processClipboardText(text);
  console.log(LOG_PREFIX, "processed:", result.classification, "action:", result.action);
  const debugInfo = {
    rawText: text,
    classification: result.classification,
    detectedVIN: result.vin,
    detectedParts: result.parts,
    action: result.action,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
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
var OFFSCREEN_URL = "dist/offscreen/offscreen.html";
async function ensureOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: "Write the auto-backup CSV snapshot to the user's chosen local folder."
  });
}
async function runAutoBackup() {
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
    }
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_BACKUP_ALARM) {
    runAutoBackup();
  }
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CLIPBOARD_CAPTURE") {
    handleClipboardCapture(message.text).finally(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "RUN_BACKUP_NOW") {
    runAutoBackup().finally(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
//# sourceMappingURL=service-worker.js.map
