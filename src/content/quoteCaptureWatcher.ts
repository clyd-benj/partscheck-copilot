import { extractQuoteContext, extractQuoteRows } from '@/services/extractors/quoteRows';
import { createValueStore, type ValueStore } from './valueStore';
import type { QuoteCaptureResult, QuoteContext, QuoteRow } from '@/types/quoteMapping';

/**
 * Watches the PartsCheck quote table and saves its filled rows (via the
 * background worker) whenever they change: on load when reopening an
 * already-priced quote, and when DMS Upload fills the table. Read-only —
 * it never writes into PartsCheck's inputs or submits anything.
 */

const LOG_PREFIX = '[Parts Interpreter Toolkit]';
const DEBOUNCE_MS = 750;

export type QuoteCaptureStatus =
  | { state: 'no-quote' }
  | { state: 'empty'; requestedLines: number }
  | { state: 'saving'; requestedLines: number; filledRows: number }
  | { state: 'saved'; result: QuoteCaptureResult }
  | { state: 'error'; message: string };

export type QuoteCaptureStore = ValueStore<QuoteCaptureStatus>;

export function createQuoteCaptureStore(): QuoteCaptureStore {
  return createValueStore<QuoteCaptureStatus>({ state: 'no-quote' });
}

export type SaveQuoteCapture = (
  context: QuoteContext,
  rows: QuoteRow[],
) => Promise<QuoteCaptureResult | null>;

export function startQuoteCaptureWatcher(
  store: QuoteCaptureStore,
  save: SaveQuoteCapture,
  root: Document = document,
): () => void {
  let lastSavedFingerprint: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function capture(): Promise<void> {
    const context = extractQuoteContext(root);
    if (!context) {
      store.set({ state: 'no-quote' });
      return;
    }

    const rows = extractQuoteRows(root);
    const requestedLines = rows.filter((row) => row.iteration === 0).length;
    const filledRows = rows.filter((row) => row.iteration === 0 && row.partNumber !== '').length;
    if (filledRows === 0) {
      store.set({ state: 'empty', requestedLines });
      return;
    }

    const fingerprint = JSON.stringify({ context, rows });
    if (fingerprint === lastSavedFingerprint) return;

    store.set({ state: 'saving', requestedLines, filledRows });
    try {
      const result = await save(context, rows);
      if (!result) {
        store.set({
          state: 'error',
          message: 'Background script unreachable — reload the extension and this page.',
        });
        return;
      }
      lastSavedFingerprint = fingerprint;
      console.log(
        LOG_PREFIX,
        `captured ${result.mappings} mappings from quote ${context.quoteKey}`,
        result,
      );
      store.set({ state: 'saved', result });
    } catch (error) {
      console.error(LOG_PREFIX, 'quote capture failed', error);
      store.set({ state: 'error', message: String(error) });
    }
  }

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void capture(), DEBOUNCE_MS);
  }

  const table = root.querySelector('#lineTable');
  let observer: MutationObserver | undefined;
  if (table) {
    observer = new MutationObserver(schedule);
    observer.observe(table, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    // Script-set input values don't mutate the DOM; PartsCheck's own inputs
    // fire change/input when edited, so listen for those too (passively).
    table.addEventListener('change', schedule, { capture: true, passive: true });
    table.addEventListener('input', schedule, { capture: true, passive: true });
  } else {
    console.warn(
      LOG_PREFIX,
      'selector not found: quote line table (#lineTable) — quote capture is off for this page',
    );
  }

  void capture();

  return () => {
    clearTimeout(timer);
    observer?.disconnect();
    table?.removeEventListener('change', schedule, { capture: true });
    table?.removeEventListener('input', schedule, { capture: true });
  };
}
