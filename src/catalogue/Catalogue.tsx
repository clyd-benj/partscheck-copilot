import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { AsaCapsDatabase } from '@/storage/asacapsDb';
import {
  buildCatalogueRows,
  importCsv,
  rowsToCsv,
  rowsToJson,
  triggerDownload,
  type CatalogueRow,
} from '@/services/asacaps/catalogueExport';
import { buildCoverageSummary, type CoverageSummary } from '@/services/asacaps/coverage';
import type { BackupState } from '@/types/asacaps';

function vehicleLabel(row: CatalogueRow): string {
  const parts = [row.make, row.model ?? row.modelCode, row.variant, row.year].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
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
    .join(' ')
    .toUpperCase();
  return haystack.includes(query.toUpperCase());
}

export function Catalogue() {
  const [allRows, setAllRows] = useState<CatalogueRow[]>([]);
  const [query, setQuery] = useState('');
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);
  const [backupState, setBackupState] = useState<BackupState>({ enabled: false });
  const [importStatus, setImportStatus] = useState<{ message: string; kind: 'success' | 'error' } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  async function refresh() {
    const [rows, summary, backup] = await Promise.all([
      buildCatalogueRows(),
      buildCoverageSummary(),
      AsaCapsDatabase.getBackupState(),
    ]);
    setAllRows(rows);
    setCoverage(summary);
    setBackupState(backup);
  }

  useEffect(() => {
    refresh();
  }, []);

  const filteredRows = useMemo(() => allRows.filter((row) => matchesQuery(row, query)), [allRows, query]);

  const groupedByPartNumber = useMemo(() => {
    const trimmed = query.trim().toUpperCase();
    if (!trimmed) return null;

    const map = new Map<string, CatalogueRow[]>();
    for (const row of allRows) {
      if (row.partNumber.toUpperCase() !== trimmed) continue;
      const list = map.get(row.partNumber) ?? [];
      list.push(row);
      map.set(row.partNumber, list);
    }
    return map.size > 0 ? map : null;
  }, [allRows, query]);

  async function handleImportCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const result = await importCsv(text);
      setImportStatus({
        message: `Imported ${result.vehiclesImported} vehicle${result.vehiclesImported === 1 ? '' : 's'} and ${result.fitmentsImported} part${result.fitmentsImported === 1 ? '' : 's'} from "${file.name}".`,
        kind: 'success',
      });
      await refresh();
    } catch (err) {
      setImportStatus({ message: err instanceof Error ? err.message : 'Import failed.', kind: 'error' });
    }
  }

  async function handleConnectBackupFolder() {
    try {
      const handle = await window.showDirectoryPicker({ id: 'asa-caps-backup', mode: 'readwrite', startIn: 'documents' });
      const state = await AsaCapsDatabase.getBackupState();
      const updated: BackupState = {
        ...state,
        folderHandle: handle,
        folderName: handle.name,
        enabled: true,
        lastError: undefined,
      };
      await AsaCapsDatabase.putBackupState(updated);
      setBackupState(updated);
      setImportStatus({ message: `Backup folder connected: "${handle.name}". Auto-backup enabled.`, kind: 'success' });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return; // user closed the picker
      setImportStatus({ message: err instanceof Error ? err.message : 'Could not connect a backup folder.', kind: 'error' });
    }
  }

  async function handleToggleBackupEnabled() {
    const updated: BackupState = { ...backupState, enabled: !backupState.enabled };
    await AsaCapsDatabase.putBackupState(updated);
    setBackupState(updated);
  }

  async function handleBackupNow() {
    setBackupBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: 'RUN_BACKUP_NOW' });
    } finally {
      const state = await AsaCapsDatabase.getBackupState();
      setBackupState(state);
      setBackupBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 bg-surface p-6 font-sans text-sm text-neutral-900 dark:bg-surface-dark dark:text-neutral-100">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Parts Interpreter Toolkit — ASA CAPS Catalogue</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Every VIN → part number pairing captured while working in ASA CAPS.
        </p>
      </header>

      <CoverageCard coverage={coverage} />

      <section className="flex flex-col gap-3 rounded-xl border border-border p-4 dark:border-border-dark">
        <div className="flex items-center justify-between gap-4">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search VIN, part number, description, vehicle…"
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm dark:border-border-dark"
          />
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
            {filteredRows.length} fitment{filteredRows.length === 1 ? '' : 's'}
          </span>
        </div>

        {groupedByPartNumber && (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-subtle p-3 dark:bg-surface-dark-subtle">
            {Array.from(groupedByPartNumber.entries()).map(([partNumber, rows]) => (
              <div key={partNumber}>
                <h3 className="text-sm font-semibold">{partNumber}</h3>
                {rows.find((r) => r.description)?.description && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                    {rows.find((r) => r.description)?.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Seen on {rows.length} vehicle{rows.length === 1 ? '' : 's'}:
                </p>
                <ul className="list-inside list-disc text-xs text-neutral-700 dark:text-neutral-300">
                  {rows.map((row) => (
                    <li key={row.vin}>
                      {row.vin} — {vehicleLabel(row)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {filteredRows.length === 0 ? (
          <p className="py-6 text-center text-sm italic text-neutral-400 dark:text-neutral-600">
            No fitments found.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="px-2 py-1 font-medium">VIN</th>
                  <th className="px-2 py-1 font-medium">Vehicle</th>
                  <th className="px-2 py-1 font-medium">Part #</th>
                  <th className="px-2 py-1 font-medium">PNC</th>
                  <th className="px-2 py-1 font-medium">Description</th>
                  <th className="px-2 py-1 font-medium">×</th>
                  <th className="px-2 py-1 font-medium">First seen</th>
                  <th className="px-2 py-1 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-border-dark">
                {filteredRows.map((row) => (
                  <tr key={`${row.vin}::${row.partNumber}`}>
                    <td className="px-2 py-1 font-mono">{row.vin}</td>
                    <td className="px-2 py-1">{vehicleLabel(row)}</td>
                    <td className="px-2 py-1 font-mono">{row.partNumber}</td>
                    <td className="px-2 py-1 font-mono">{row.pnc ?? '—'}</td>
                    <td className="px-2 py-1">{row.description ?? '—'}</td>
                    <td className="px-2 py-1">{row.timesCopied}</td>
                    <td className="px-2 py-1">{new Date(row.firstCapturedAt).toLocaleString()}</td>
                    <td className="px-2 py-1">{new Date(row.lastCapturedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border p-4 dark:border-border-dark">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Import / Export
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => triggerDownload(`asa-caps-catalogue-${Date.now()}.csv`, rowsToCsv(allRows), 'text/csv')}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-surface-subtle dark:border-border-dark dark:hover:bg-surface-dark-subtle"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() =>
              triggerDownload(`asa-caps-catalogue-${Date.now()}.json`, rowsToJson(allRows), 'application/json')
            }
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-surface-subtle dark:border-border-dark dark:hover:bg-surface-dark-subtle"
          >
            Export JSON
          </button>
          <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-surface-subtle dark:border-border-dark dark:hover:bg-surface-dark-subtle">
            Import CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleImportCsv} />
          </label>
        </div>
        {importStatus && (
          <p className={importStatus.kind === 'success' ? 'text-sm text-green-700 dark:text-green-400' : 'text-sm text-red-600 dark:text-red-400'}>
            {importStatus.message}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border p-4 dark:border-border-dark">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Auto-Backup
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {backupState.folderName ? `Folder: ${backupState.folderName}` : 'No folder connected'}
          {backupState.lastBackupAt && ` · Last backup: ${new Date(backupState.lastBackupAt).toLocaleString()}`}
          {backupState.lastError && ` · ⚠ ${backupState.lastError}`}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleConnectBackupFolder}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-surface-subtle dark:border-border-dark dark:hover:bg-surface-dark-subtle"
          >
            Connect Backup Folder
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={backupState.enabled}
              disabled={!backupState.folderHandle}
              onChange={handleToggleBackupEnabled}
              className="h-4 w-4 rounded border-neutral-400 accent-accent disabled:opacity-50"
            />
            Auto-backup enabled
          </label>
          <button
            type="button"
            onClick={handleBackupNow}
            disabled={backupBusy || !backupState.folderHandle}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition hover:bg-surface-subtle disabled:opacity-50 dark:border-border-dark dark:hover:bg-surface-dark-subtle"
          >
            {backupBusy ? 'Backing up…' : 'Backup Now'}
          </button>
        </div>
      </section>
    </div>
  );
}

function CoverageCard({ coverage }: { coverage: CoverageSummary | null }) {
  if (!coverage || coverage.totalVehicles === 0) {
    return (
      <section className="rounded-xl border border-border p-4 dark:border-border-dark">
        <p className="text-sm italic text-neutral-400 dark:text-neutral-600">
          Nothing captured yet — copy vehicle and part details from ASA CAPS to start building the catalogue.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4 dark:border-border-dark">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        <span className="font-medium">{coverage.totalVehicles}</span> vehicle{coverage.totalVehicles === 1 ? '' : 's'},{' '}
        <span className="font-medium">{coverage.totalFitments}</span> part{coverage.totalFitments === 1 ? '' : 's'},{' '}
        <span className="font-medium">{coverage.readyGroups}</span> trim{coverage.readyGroups === 1 ? '' : 's'} ready for
        matching
      </p>
      <div className="flex flex-wrap gap-2">
        {coverage.groups.map((group) => (
          <div
            key={group.classification}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
              group.ready
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-border text-neutral-500 dark:border-border-dark dark:text-neutral-400'
            }`}
          >
            <span className="font-medium">{group.classification}</span>
            <span>
              {group.vehicleCount} vehicle{group.vehicleCount === 1 ? '' : 's'} · {group.partCount} part
              {group.partCount === 1 ? '' : 's'}
            </span>
            <span className="font-medium">{group.ready ? 'Ready' : 'Building'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
