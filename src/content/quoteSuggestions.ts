import { createValueStore, type ValueStore } from './valueStore';
import { extractQuoteContext, extractQuoteRows } from '@/services/extractors/quoteRows';
import { isAsaVehicleUpdatedMessage } from '@/services/messaging';
import type {
  LineSuggestions,
  QuoteVehicle,
  SuggestionLine,
} from '@/services/quoteCapture/suggestions';

/**
 * Asks the background worker for part-number suggestions for the open
 * quote's lines that haven't been DMS-uploaded yet. Display only — the
 * sidebar offers copy buttons; nothing is written into PartsCheck.
 */

const LOG_PREFIX = '[Parts Interpreter Toolkit]';

export type QuoteSuggestionsStatus =
  { state: 'loading' } | { state: 'ready'; lines: LineSuggestions[] };

export type QuoteSuggestionsStore = ValueStore<QuoteSuggestionsStatus>;

export function createQuoteSuggestionsStore(): QuoteSuggestionsStore {
  return createValueStore<QuoteSuggestionsStatus>({ state: 'loading' });
}

export type RequestQuoteSuggestions = (
  vehicle: QuoteVehicle,
  lines: SuggestionLine[],
  excludeQuoteKey?: string,
) => Promise<LineSuggestions[]>;

export async function loadQuoteSuggestions(
  store: QuoteSuggestionsStore,
  request: RequestQuoteSuggestions,
  root: Document = document,
): Promise<void> {
  const context = extractQuoteContext(root);
  const lines = extractQuoteRows(root)
    // Lines without a DMS-uploaded answer — including ones the repairer
    // pre-filled with their own (unverified) number.
    .filter((row) => row.iteration === 0 && !row.fromDmsUpload)
    .map((row) => ({ id: row.draftItemId, description: row.repairerDescription }));

  if (lines.length === 0) {
    store.set({ state: 'ready', lines: [] });
    return;
  }

  try {
    const suggested = await request(
      { vin: context?.vin, model: context?.model, mthYr: context?.mthYr },
      lines,
      context?.quoteKey,
    );
    store.set({ state: 'ready', lines: suggested });
  } catch (error) {
    console.error(LOG_PREFIX, 'quote suggestions failed', error);
    store.set({ state: 'ready', lines: [] });
  }
}

type MessageListener = (message: unknown) => void;

/**
 * Re-runs the suggestions when ASA CAPS captures the open quote's VIN, so
 * same-trim ranking applies without reloading the page. Other VINs are
 * ignored. `addListener` is injectable for tests; returns an unsubscribe.
 */
export function refreshSuggestionsOnAsaVehicle(
  store: QuoteSuggestionsStore,
  request: RequestQuoteSuggestions,
  root: Document = document,
  addListener: (listener: MessageListener) => () => void = (listener) => {
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  },
): () => void {
  return addListener((message) => {
    if (!isAsaVehicleUpdatedMessage(message)) return;
    const vin = extractQuoteContext(root)?.vin;
    if (!vin || vin.toUpperCase() !== message.vin.toUpperCase()) return;
    console.log(LOG_PREFIX, `ASA CAPS captured ${vin} — refreshing suggestions`);
    void loadQuoteSuggestions(store, request, root);
  });
}
