import { useEffect, useState } from 'react';
import { SectionCard } from '@/components/SectionCard';
import { scoreTotals, type ScoreTotals } from '@/services/quoteCapture/learning';
import { AsaCapsDatabase } from '@/storage/asacapsDb';

const MAX_MISSES = 20;

function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

/**
 * Running self-score of PartsCheck suggestions: every DMS Upload compares
 * the confirmed suggestions shown before upload with what was uploaded.
 */
export function SuggestionScoreSection() {
  const [totals, setTotals] = useState<ScoreTotals | null>(null);

  useEffect(() => {
    AsaCapsDatabase.listPredictions().then((entries) => setTotals(scoreTotals(entries)));
  }, []);

  return (
    <SectionCard title="Suggestion Accuracy">
      {!totals || totals.lines === 0 ? (
        <p className="px-4 py-2 text-sm italic text-neutral-400 dark:text-neutral-600">
          No uploaded quotes scored yet.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 px-4 py-2 text-center">
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Lines quoted</dt>
              <dd className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {totals.lines}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Confirmed</dt>
              <dd className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {percent(totals.confirmed, totals.lines)}
              </dd>
              <dd className="text-xs text-neutral-500 dark:text-neutral-400">
                {totals.confirmed} lines
              </dd>
            </div>
            <div>
              <dt className="text-xs text-neutral-500 dark:text-neutral-400">Correct</dt>
              <dd className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {percent(totals.correct, totals.confirmed)}
              </dd>
              <dd className="text-xs text-neutral-500 dark:text-neutral-400">
                {totals.correct} of {totals.confirmed}
              </dd>
            </div>
          </dl>
          {totals.misses.length > 0 && (
            <div className="border-t border-border px-4 py-2 dark:border-border-dark">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Misses ({totals.misses.length})
              </h3>
              {totals.misses.slice(0, MAX_MISSES).map((miss) => (
                <div key={miss.id} className="py-1 text-xs text-neutral-700 dark:text-neutral-300">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">
                    {miss.quoteRef} · {miss.description}
                  </div>
                  <div className="text-neutral-500 dark:text-neutral-400">{miss.vehicle}</div>
                  <div>
                    suggested <span className="font-mono">{miss.suggested}</span>, uploaded{' '}
                    <span className="font-mono">{miss.uploaded.join(', ')}</span>
                  </div>
                  <div className="text-neutral-500 dark:text-neutral-400">rule: {miss.rule}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
