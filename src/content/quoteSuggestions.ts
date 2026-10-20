import { createValueStore, type ValueStore } from './valueStore';
import { extractQuoteContext, extractQuoteRows } from '@/services/extractors/quoteRows';
import type { LineSuggestions, SuggestionLine } from '@/services/quoteCapture/suggestions';

/**
 * Asks the background worker for part-number suggestions for the open
 * quote's lines that don't have a part number yet. Display only — the
 * sidebar offers copy buttons; nothing is written into PartsCheck.
 */

export type QuoteSuggestionsStatus =
  { state: 'loading' } | { state: 'ready'; lines: LineSuggestions[] };

export type QuoteSuggestionsStore = ValueStore<QuoteSuggestionsStatus>;

export function createQuoteSuggestionsStore(): QuoteSuggestionsStore {
  return createValueStore<QuoteSuggestionsStatus>({ state: 'loading' });
}

export type RequestQuoteSuggestions = (
  vehicle: { vin?: string; model?: string },
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
    .filter((row) => row.iteration === 0 && row.partNumber === '')
    .map((row) => ({ id: row.draftItemId, description: row.repairerDescription }));

  if (lines.length === 0) {
    store.set({ state: 'ready', lines: [] });
    return;
  }

  try {
    const suggested = await request(
      { vin: context?.vin, model: context?.model },
      lines,
      context?.quoteKey,
    );
    store.set({ state: 'ready', lines: suggested });
  } catch (error) {
    console.error('[Parts Interpreter Toolkit]', 'quote suggestions failed', error);
    store.set({ state: 'ready', lines: [] });
  }
}
