import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { getAllCustomers, getCustomerCount, replaceCustomerDatabase } from '@/storage/customerDb';
import { getCustomerDbMeta, setCustomerDbMeta } from '@/storage/customerDbMeta';
import { parseCustomerSpreadsheet, SpreadsheetImportError } from '@/services/spreadsheetImport';
import { buildCustomerWorkbookBlob, downloadBlob } from '@/services/spreadsheetExport';
import type { CustomerDbMeta } from '@/types/customer';

export function Popup() {
  const [meta, setMeta] = useState<CustomerDbMeta | null | undefined>(undefined);
  const [count, setCount] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getCustomerDbMeta().then(setMeta);
    getCustomerCount().then(setCount);
  }, []);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    setImporting(true);

    try {
      const records = await parseCustomerSpreadsheet(file);
      await replaceCustomerDatabase(records);

      const newMeta: CustomerDbMeta = {
        importedAt: new Date().toISOString(),
        sourceFileName: file.name,
      };
      await setCustomerDbMeta(newMeta);
      setMeta(newMeta);
      setCount(records.length);
    } catch (err) {
      setError(
        err instanceof SpreadsheetImportError ? err.message : 'Something went wrong reading that file.',
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const customers = await getAllCustomers();
      const blob = buildCustomerWorkbookBlob(customers);
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadBlob(blob, `customer-database-${timestamp}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  const hasCustomers = (count ?? 0) > 0;

  return (
    <div className="flex w-[380px] flex-col gap-4 bg-surface p-4 font-sans text-sm text-neutral-900 dark:bg-surface-dark dark:text-neutral-100">
      <header>
        <h1 className="text-base font-semibold tracking-tight">Parts Interpreter Toolkit</h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">Customer database</p>
      </header>

      <div className="rounded-xl border border-border p-3 dark:border-border-dark">
        {count === undefined ? (
          <p className="text-neutral-500 dark:text-neutral-400">Loading…</p>
        ) : !hasCustomers ? (
          <p className="text-neutral-500 dark:text-neutral-400">No customer database imported yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            <p>
              <span className="font-medium">{count.toLocaleString()}</span> customers loaded
            </p>
            {meta && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Last imported from {meta.sourceFileName}, {new Date(meta.importedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="w-full rounded-xl bg-accent px-3 py-2 font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          {importing ? 'Importing…' : hasCustomers ? 'Replace Database' : 'Import Spreadsheet'}
        </button>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Expects 3 columns, in order: Customer #, Name, Address. You won't need to re-import unless you choose to
          replace it.
        </p>
      </div>

      {hasCustomers && (
        <div className="border-t border-border pt-4 dark:border-border-dark">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="w-full rounded-xl border border-border px-3 py-2 font-medium text-neutral-900 transition hover:bg-surface-subtle disabled:opacity-50 dark:border-border-dark dark:text-neutral-100 dark:hover:bg-surface-dark-subtle"
          >
            {exporting ? 'Exporting…' : 'Export Updated Spreadsheet'}
          </button>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            Customers added from the sidebar are saved here immediately, but your original spreadsheet file doesn't
            change on its own. Export downloads a fresh .xlsx with everything (including any additions) — save it
            over your original file to keep them in sync.
          </p>
        </div>
      )}
    </div>
  );
}
