import { useSyncExternalStore } from 'react';
import { SectionCard } from '@/components/SectionCard';
import type { QuoteCaptureStore } from '@/content/quoteCaptureWatcher';

interface QuoteCaptureSectionProps {
  store: QuoteCaptureStore;
}

const MUTED = 'px-4 py-1.5 text-sm italic text-neutral-400 dark:text-neutral-600';
const WARNING = 'px-4 py-1.5 text-sm text-amber-700 dark:text-amber-400';

/** Status of the read-only capture of this quote's filled rows into quoteMappings. */
export function QuoteCaptureSection({ store }: QuoteCaptureSectionProps) {
  const status = useSyncExternalStore(store.subscribe, store.get);

  return (
    <SectionCard title="Part Number Capture">
      {status.state === 'no-quote' && (
        <p className={MUTED}>Quote not recognised — nothing captured.</p>
      )}
      {status.state === 'empty' && (
        <p className={MUTED}>
          No part numbers on this quote yet. They'll be captured after DMS Upload.
        </p>
      )}
      {status.state === 'saving' && <p className={MUTED}>Capturing {status.filledRows} rows…</p>}
      {status.state === 'error' && <p className={WARNING}>Capture failed: {status.message}</p>}
      {status.state === 'saved' && (
        <>
          <p className="px-4 py-1.5 text-sm text-neutral-900 dark:text-neutral-100">
            {status.result.verifiedRows} verified row{status.result.verifiedRows === 1 ? '' : 's'}{' '}
            captured, {status.result.repairerSuppliedRows} repairer-supplied row
            {status.result.repairerSuppliedRows === 1 ? '' : 's'} ignored
            {status.result.noGenuinePart > 0 && (
              <span className="text-neutral-500 dark:text-neutral-400">
                {' '}
                ({status.result.noGenuinePart} not applicable)
              </span>
            )}
          </p>
          {status.result.verifiedRows > 0 &&
            status.result.verifiedRows !== status.result.requestedLines && (
              <p className={WARNING}>
                {status.result.verifiedRows} of {status.result.requestedLines} requested lines were
                filled by DMS Upload — check the ERA lines match the PartsCheck order.
              </p>
            )}
          {status.result.sideConflicts.map((mapping) => (
            <p key={mapping.id} className={WARNING}>
              Line {mapping.rowNo}: "{mapping.repairerDescription}" is {mapping.side} but ERA has "
              {mapping.eraDescription}" ({mapping.partNumber}).
            </p>
          ))}
        </>
      )}
    </SectionCard>
  );
}
