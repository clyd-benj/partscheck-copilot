import { useState, useSyncExternalStore } from 'react';
import { SectionCard } from '@/components/SectionCard';
import type { QuoteSuggestionsStore } from '@/content/quoteSuggestions';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import {
  copyAllText,
  type LineSuggestions,
  type PartSuggestion,
  type SuggestionSource,
} from '@/services/quoteCapture/suggestions';
import type { RequestedPart } from '@/types/rfq';

interface PartsChecklistProps {
  parts: RequestedPart[];
  suggestionsStore: QuoteSuggestionsStore;
}

const NO_SUGGESTIONS: LineSuggestions['suggestions'] = [];

const SOURCE_LABEL: Record<SuggestionSource, string> = {
  quotes: 'from your quotes',
  catalogue: 'from ASA catalogue',
};

function SuggestionRow({ suggestion }: { suggestion: PartSuggestion }) {
  const { copied, copy } = useCopyToClipboard();
  const confirmed = suggestion.level === 'confirmed';

  return (
    <div
      className={`flex items-start gap-2 py-0.5 pl-10 pr-4 text-xs ${confirmed ? '' : 'opacity-60'}`}
    >
      <button
        type="button"
        onClick={() => copy(suggestion.partNumber)}
        title="Copy part number"
        className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-neutral-900 transition hover:border-accent hover:text-accent dark:border-border-dark dark:text-neutral-100"
      >
        {copied ? 'Copied' : suggestion.partNumber}
      </button>
      <div className="min-w-0">
        {suggestion.description && (
          <div className="truncate text-neutral-700 dark:text-neutral-300">
            {suggestion.description}
            {suggestion.isAccessory && <span className="text-neutral-500"> · accessory</span>}
          </div>
        )}
        <div className="text-neutral-500 dark:text-neutral-400">
          {confirmed && (
            <span className="font-medium text-green-700 dark:text-green-400">confirmed · </span>
          )}
          <span
            className={
              suggestion.source === 'quotes'
                ? 'font-medium text-accent'
                : 'font-medium text-neutral-700 dark:text-neutral-300'
            }
          >
            {SOURCE_LABEL[suggestion.source]}
          </span>
          {' · '}
          {/* Non-breaking hyphens so dates don't wrap mid-way. */}
          {suggestion.evidence.replace(/-/g, '\u2011')}
        </div>
        {suggestion.similarWording && (
          <div className="italic text-neutral-400 dark:text-neutral-500">
            similar to “{suggestion.similarWording}”
          </div>
        )}
        {suggestion.cautions.length > 0 && (
          <div className="text-amber-700 dark:text-amber-400">
            {suggestion.cautions.join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

function CopyAllButton({ text, count, total }: { text: string; count: number; total: number }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
      <span>
        Confirmed for {count} of {total} lines
      </span>
      <button
        type="button"
        onClick={() => copy(text)}
        title="Top confirmed suggestion per line, one per line (blank where none), in PartsCheck order"
        className="rounded border border-border px-2 py-0.5 text-neutral-900 transition hover:border-accent hover:text-accent dark:border-border-dark dark:text-neutral-100"
      >
        {copied ? 'Copied' : 'Copy all in order'}
      </button>
    </div>
  );
}

export function PartsChecklist({ parts, suggestionsStore }: PartsChecklistProps) {
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const suggestionsStatus = useSyncExternalStore(suggestionsStore.subscribe, suggestionsStore.get);

  const linesById = new Map(
    suggestionsStatus.state === 'ready'
      ? suggestionsStatus.lines.map((line) => [line.id, line])
      : [],
  );
  const perPart = parts.map((part) => ({
    suggestions: linesById.get(part.id)?.suggestions ?? NO_SUGGESTIONS,
    wordingUnclear: linesById.get(part.id)?.wordingUnclear ?? false,
  }));
  const confirmedLines = perPart.filter((line) =>
    line.suggestions.some((s) => s.level === 'confirmed'),
  ).length;

  function toggle(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <SectionCard title="Requested Parts">
      {parts.length === 0 ? (
        <p className="px-4 py-2 text-sm italic text-neutral-400 dark:text-neutral-600">
          No requested parts found on this RFQ.
        </p>
      ) : (
        <>
          {confirmedLines > 0 && (
            <CopyAllButton
              text={copyAllText(perPart)}
              count={confirmedLines}
              total={parts.length}
            />
          )}
          {parts.map((part, i) => (
            <div key={part.id} className="py-0.5">
              <label className="flex cursor-pointer items-start gap-2 px-4 py-1.5 text-sm text-neutral-900 hover:bg-surface-subtle dark:text-neutral-100 dark:hover:bg-surface-dark-subtle">
                <input
                  type="checkbox"
                  checked={checkedIds.has(part.id)}
                  onChange={() => toggle(part.id)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-400 accent-accent"
                />
                <span
                  className={
                    checkedIds.has(part.id)
                      ? 'text-neutral-400 line-through dark:text-neutral-600'
                      : ''
                  }
                >
                  {part.description}
                </span>
              </label>
              {perPart[i].wordingUnclear && (
                <p className="py-0.5 pl-10 pr-4 text-xs text-amber-700 dark:text-amber-400">
                  wording unclear — side or position can't be read, no suggestions
                </p>
              )}
              {perPart[i].suggestions
                .filter((suggestion) => suggestion.level === 'confirmed')
                .map((suggestion) => (
                  <SuggestionRow key={suggestion.partNumber} suggestion={suggestion} />
                ))}
              {perPart[i].suggestions.some((suggestion) => suggestion.level === 'possible') && (
                <>
                  <p className="pl-10 pr-4 pt-0.5 text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                    possible, check
                  </p>
                  {perPart[i].suggestions
                    .filter((suggestion) => suggestion.level === 'possible')
                    .map((suggestion) => (
                      <SuggestionRow key={suggestion.partNumber} suggestion={suggestion} />
                    ))}
                </>
              )}
            </div>
          ))}
        </>
      )}
    </SectionCard>
  );
}
