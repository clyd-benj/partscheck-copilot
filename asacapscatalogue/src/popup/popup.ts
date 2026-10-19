import { Database } from "../database/database";
import { setActiveVehicleManually, closeActiveSession } from "../vehicle/vehicle-session";
import { isValidVin } from "../vehicle/vin";
import { exportCsv, exportJson } from "../shared/export";
import type { DebugInfo, PartFitment, Vehicle, VehicleSession } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  pauseToggle: $<HTMLInputElement>("pauseToggle"),
  activeVehicleEmpty: $<HTMLDivElement>("activeVehicleEmpty"),
  activeVehicleContent: $<HTMLDivElement>("activeVehicleContent"),
  vehicleTitle: $<HTMLDivElement>("vehicleTitle"),
  vehicleVin: $<HTMLDivElement>("vehicleVin"),
  sessionStarted: $<HTMLSpanElement>("sessionStarted"),
  partCount: $<HTMLSpanElement>("partCount"),
  recentPartsList: $<HTMLUListElement>("recentPartsList"),
  recentPartsEmpty: $<HTMLDivElement>("recentPartsEmpty"),
  btnManualVehicle: $<HTMLButtonElement>("btnManualVehicle"),
  btnCloseSession: $<HTMLButtonElement>("btnCloseSession"),
  btnClearSession: $<HTMLButtonElement>("btnClearSession"),
  manualVehicleForm: $<HTMLDivElement>("manualVehicleForm"),
  manualVinInput: $<HTMLInputElement>("manualVinInput"),
  btnManualVehicleConfirm: $<HTMLButtonElement>("btnManualVehicleConfirm"),
  btnManualVehicleCancel: $<HTMLButtonElement>("btnManualVehicleCancel"),
  manualVehicleError: $<HTMLDivElement>("manualVehicleError"),
  btnViewCatalogue: $<HTMLButtonElement>("btnViewCatalogue"),
  btnExport: $<HTMLButtonElement>("btnExport"),
  debugToggle: $<HTMLInputElement>("debugToggle"),
  debugPanel: $<HTMLDivElement>("debugPanel"),
  debugContent: $<HTMLDListElement>("debugContent"),
  btnCopyDebug: $<HTMLButtonElement>("btnCopyDebug"),
  logUnknownToggle: $<HTMLInputElement>("logUnknownToggle"),
  linkInspector: $<HTMLAnchorElement>("linkInspector"),
  toast: $<HTMLDivElement>("toast"),
};

let lastDebugInfo: DebugInfo | null = null;

function showToast(message: string): void {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 2200);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function vehicleTitleText(vehicle: Vehicle | undefined, vin: string): string {
  if (!vehicle) return vin;
  const parts = [vehicle.make, vehicle.model ?? vehicle.modelCode, vehicle.variant].filter(Boolean);
  return parts.length ? parts.join(" ") : vin;
}

async function renderActiveVehicle(): Promise<void> {
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

async function renderRecentParts(session: VehicleSession): Promise<void> {
  const fitments = await Database.listFitmentsForVin(session.vin);
  const sorted = fitments.sort((a: PartFitment, b: PartFitment) =>
    b.lastCapturedAt.localeCompare(a.lastCapturedAt)
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

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function renderSettings(): Promise<void> {
  const settings = await Database.getSettings();
  els.pauseToggle.checked = !settings.captureEnabled;
  els.logUnknownToggle.checked = settings.logUnknownEvents;
  els.debugToggle.checked = settings.debugMode;
  els.debugPanel.classList.toggle("hidden", !settings.debugMode);
}

async function renderDebugPanel(): Promise<void> {
  const stored = await chrome.storage.local.get("lastDebugEvent");
  lastDebugInfo = (stored.lastDebugEvent as DebugInfo | undefined) ?? null;
  if (!lastDebugInfo) {
    els.debugContent.innerHTML = "<dt>No events captured yet.</dt>";
    return;
  }
  const info = lastDebugInfo;
  const partsSummary = info.detectedParts.length
    ? info.detectedParts
        .map((p) => p.partNumber + (p.description ? ` (${p.description})` : ""))
        .join(", ")
    : "—";
  els.debugContent.innerHTML = `
    <dt>Classification</dt><dd>${escapeHtml(info.classification)}</dd>
    <dt>Detected VIN</dt><dd>${escapeHtml(info.detectedVIN ?? "—")}</dd>
    <dt>Detected Part(s)</dt><dd>${escapeHtml(partsSummary)}</dd>
    <dt>Action</dt><dd>${escapeHtml(info.action)}</dd>
    <dt>Raw text</dt><dd>${escapeHtml(info.rawText.slice(0, 200))}</dd>
  `;
}

async function refreshAll(): Promise<void> {
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
