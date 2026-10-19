import {
  buildCatalogueRows,
  rowsToCsv,
  rowsToJson,
  triggerDownload,
  importCsv,
  type CatalogueRow,
} from "../shared/export";
import { buildCoverageSummary } from "../shared/coverage";
import { Database } from "../database/database";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  searchInput: $<HTMLInputElement>("searchInput"),
  resultCount: $<HTMLSpanElement>("resultCount"),
  tableBody: $<HTMLTableSectionElement>("tableBody"),
  emptyState: $<HTMLDivElement>("emptyState"),
  groupedResults: $<HTMLDivElement>("groupedResults"),
  btnImportCsv: $<HTMLButtonElement>("btnImportCsv"),
  importCsvInput: $<HTMLInputElement>("importCsvInput"),
  importStatus: $<HTMLDivElement>("importStatus"),
  btnExportCsv: $<HTMLButtonElement>("btnExportCsv"),
  btnExportJson: $<HTMLButtonElement>("btnExportJson"),
  coverageSummaryText: $<HTMLSpanElement>("coverageSummaryText"),
  coverageGroups: $<HTMLDivElement>("coverageGroups"),
  coverageEmpty: $<HTMLDivElement>("coverageEmpty"),
  backupStatusText: $<HTMLSpanElement>("backupStatusText"),
  btnConnectBackupFolder: $<HTMLButtonElement>("btnConnectBackupFolder"),
  backupEnabledToggle: $<HTMLInputElement>("backupEnabledToggle"),
  btnBackupNow: $<HTMLButtonElement>("btnBackupNow"),
};

let allRows: CatalogueRow[] = [];

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function vehicleLabel(row: CatalogueRow): string {
  // Prefer the breadcrumb model name; fall back to the internal model code
  // when that wasn't captured, so the row isn't just blank.
  const parts = [row.make, row.model ?? row.modelCode, row.variant, row.year].filter(Boolean);
  return parts.length ? parts.join(" ") : "—";
}

function matchesQuery(row: CatalogueRow, query: string): boolean {
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
    row.interiorColor,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  return haystack.includes(query.toUpperCase());
}

function renderTable(rows: CatalogueRow[]): void {
  els.tableBody.innerHTML = "";
  els.emptyState.classList.toggle("hidden", rows.length > 0);
  els.resultCount.textContent = `${rows.length} fitment${rows.length === 1 ? "" : "s"}`;

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(row.vin)}</td>
      <td>${escapeHtml(vehicleLabel(row))}</td>
      <td class="mono">${escapeHtml(row.partNumber)}</td>
      <td class="mono">${escapeHtml(row.pnc ?? "—")}</td>
      <td>${escapeHtml(row.description ?? "—")}</td>
      <td>${row.timesCopied}</td>
      <td>${new Date(row.firstCapturedAt).toLocaleString()}</td>
      <td>${new Date(row.lastCapturedAt).toLocaleString()}</td>
    `;
    els.tableBody.appendChild(tr);
  }
}

function renderGrouped(query: string): void {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed) {
    els.groupedResults.classList.add("hidden");
    els.groupedResults.innerHTML = "";
    return;
  }

  const byPartNumber = new Map<string, CatalogueRow[]>();
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
        ${rows
          .map((r) => `<li>${escapeHtml(r.vin)} — ${escapeHtml(vehicleLabel(r))}</li>`)
          .join("")}
      </ul>
    `;
    els.groupedResults.appendChild(card);
  }
}

function render(): void {
  const query = els.searchInput.value.trim();
  const filtered = allRows.filter((row) => matchesQuery(row, query));
  renderTable(filtered);
  renderGrouped(query);
}

async function renderCoverage(): Promise<void> {
  const summary = await buildCoverageSummary();

  if (summary.totalVehicles === 0) {
    els.coverageEmpty.classList.remove("hidden");
    els.coverageGroups.innerHTML = "";
    els.coverageSummaryText.textContent = "";
    return;
  }
  els.coverageEmpty.classList.add("hidden");

  els.coverageSummaryText.textContent =
    `${summary.totalVehicles} vehicle${summary.totalVehicles === 1 ? "" : "s"}, ` +
    `${summary.totalFitments} part${summary.totalFitments === 1 ? "" : "s"}, ` +
    `${summary.readyGroups} trim${summary.readyGroups === 1 ? "" : "s"} ready for matching`;

  els.coverageGroups.innerHTML = summary.groups
    .map(
      (group) => `
        <div class="coverage-chip ${group.ready ? "ready" : ""}">
          <span class="classification">${escapeHtml(group.classification)}</span>
          <span class="count">${group.vehicleCount} vehicle${group.vehicleCount === 1 ? "" : "s"} · ${group.partCount} part${group.partCount === 1 ? "" : "s"}</span>
          <span class="badge">${group.ready ? "Ready" : "Building"}</span>
        </div>
      `
    )
    .join("");
}

async function renderBackupStatus(): Promise<void> {
  const state = await Database.getBackupState();
  els.backupEnabledToggle.checked = state.enabled;
  els.backupEnabledToggle.disabled = !state.folderHandle;

  const parts: string[] = [state.folderName ? `Folder: ${state.folderName}` : "No folder connected"];
  if (state.lastBackupAt) parts.push(`Last backup: ${new Date(state.lastBackupAt).toLocaleString()}`);
  if (state.lastError) parts.push(`⚠ ${state.lastError}`);
  els.backupStatusText.textContent = parts.join(" · ");
}

els.btnConnectBackupFolder.addEventListener("click", async () => {
  try {
    const handle = await window.showDirectoryPicker({
      id: "asa-caps-backup",
      mode: "readwrite",
      startIn: "documents",
    });
    const state = await Database.getBackupState();
    await Database.putBackupState({
      ...state,
      folderHandle: handle,
      folderName: handle.name,
      enabled: true,
      lastError: undefined,
    });
    await renderBackupStatus();
    showImportStatus(`Backup folder connected: "${handle.name}". Auto-backup enabled.`, "success");
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return; // user closed the picker
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

function showImportStatus(message: string, kind: "success" | "error"): void {
  els.importStatus.textContent = message;
  els.importStatus.className = `import-status ${kind}`;
}

els.btnImportCsv.addEventListener("click", () => {
  els.importCsvInput.click();
});

els.importCsvInput.addEventListener("change", async () => {
  const file = els.importCsvInput.files?.[0];
  els.importCsvInput.value = ""; // allow re-selecting the same file later
  if (!file) return;

  try {
    const text = await file.text();
    const result = await importCsv(text);
    showImportStatus(
      `Imported ${result.vehiclesImported} vehicle${result.vehiclesImported === 1 ? "" : "s"} and ` +
        `${result.fitmentsImported} part${result.fitmentsImported === 1 ? "" : "s"} from "${file.name}".`,
      "success"
    );
    await refresh();
  } catch (err) {
    showImportStatus(err instanceof Error ? err.message : "Import failed.", "error");
  }
});

async function refresh(): Promise<void> {
  allRows = await buildCatalogueRows();
  render();
  await renderCoverage();
  await renderBackupStatus();
}

async function init(): Promise<void> {
  await refresh();
}

init();
