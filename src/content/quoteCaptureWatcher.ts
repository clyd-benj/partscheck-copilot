import { extractQuoteContext, extractQuoteRows } from '@/services/extractors/quoteRows';
import { createValueStore, type ValueStore } from './valueStore';
import type { QuoteCaptureResult, QuoteContext, QuoteRow } from '@/types/quoteMapping';

/**
 * Reads the PartsCheck quote table on page load (DMS Upload reloads the page,
 * and reopened uploaded quotes are read the same way) and sends its filled
 * rows to the background worker. Only DMS-uploaded rows become mappings;
 * rows the repairer typed a part number into are stored separately. Hand
 * edits never trigger a capture. Read-only — it never writes into
 * PartsCheck's inputs or submits anything.
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
    // Verified (DMS-uploaded) and repairer-typed part numbers both go to the
    // background, which keeps them apart; nothing filled means nothing to do.
    const filledRows = rows.filter((row) => row.partNumber !== '').length;
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
        `quote ${context.quoteKey}: ${result.verifiedRows} verified rows captured, ` +
          `${result.repairerSuppliedRows} repairer-supplied rows ignored`,
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
    // Structural changes only. There are deliberately no change/input
    // listeners: hand edits must never trigger a capture (and rows are read
    // from their server-rendered values anyway). DMS Upload reloads the page,
    // so the capture on load below is what picks it up.
    observer.observe(table, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
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
  };
}
