import { useEffect, useState } from 'react';
import { SectionCard } from '@/components/SectionCard';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { findCustomerMatches, isConfidentMatch } from '@/services/customerMatching';
import { requestCustomers } from '@/services/messaging';
import { AddCustomerForm } from './AddCustomerForm';
import type { CustomerMatch, CustomerRecord } from '@/types/customer';

interface CustomerMatchSectionProps {
  company: string | undefined;
  address: string | undefined;
}

type LoadState = 'loading' | 'no-database' | 'ready';

export function CustomerMatchSection({ company, address }: CustomerMatchSectionProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [matches, setMatches] = useState<CustomerMatch[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState('loading');

    requestCustomers().then((customers) => {
      if (cancelled) return;
      if (customers.length === 0) {
        setState('no-database');
        return;
      }
      setMatches(findCustomerMatches({ company, address }, customers));
      setState('ready');
    });

    return () => {
      cancelled = true;
    };
  }, [company, address]);

  const bestMatch = matches[0];
  const hasConfidentMatch = state === 'ready' && bestMatch !== undefined && isConfidentMatch(bestMatch);

  return (
    <SectionCard title="Customer Match">
      {state === 'loading' && <p className="px-4 py-2 text-sm text-neutral-400 dark:text-neutral-600">Matching…</p>}

      {state === 'no-database' && (
        <p className="px-4 py-2 text-sm italic text-neutral-400 dark:text-neutral-600">
          No customer database imported. Click the Parts Interpreter Toolkit icon in your toolbar to import your
          spreadsheet.
        </p>
      )}

      {state === 'ready' && !hasConfidentMatch && (
        <>
          <p className="px-4 py-2 text-sm italic text-neutral-400 dark:text-neutral-600">
            No confident customer match found.
          </p>
          {company && (
            <AddCustomerForm
              name={company}
              address={address}
              onAdded={(record: CustomerRecord) => setMatches([{ ...record, confidence: 100 }])}
            />
          )}
        </>
      )}

      {state === 'ready' && hasConfidentMatch && <CustomerMatchRow match={bestMatch} />}
    </SectionCard>
  );
}

function CustomerMatchRow({ match }: { match: CustomerMatch }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="flex flex-col gap-0.5 bg-surface-subtle px-4 py-2 dark:bg-surface-dark-subtle">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{match.name}</span>
        <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{match.confidence}%</span>
      </div>
      {match.address && (
        <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">{match.address}</span>
      )}
      <div className="mt-1 flex items-center gap-2">
        <span className="text-xs text-neutral-500 dark:text-neutral-400">Customer #</span>
        <button
          type="button"
          onClick={() => copy(match.customerNumber)}
          title="Click to copy"
          className="-mx-1 rounded px-1 text-sm font-medium text-neutral-900 transition hover:bg-surface hover:text-accent dark:text-neutral-100 dark:hover:bg-surface-dark"
        >
          {copied ? 'Copied' : match.customerNumber}
        </button>
      </div>
    </div>
  );
}
