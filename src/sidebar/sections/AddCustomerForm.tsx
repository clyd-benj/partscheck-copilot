import { useState, type FormEvent } from 'react';
import { requestAddCustomer } from '@/services/messaging';
import type { CustomerRecord } from '@/types/customer';

interface AddCustomerFormProps {
  name: string;
  address: string | undefined;
  onAdded: (record: CustomerRecord) => void;
}

export function AddCustomerForm({ name, address, onAdded }: AddCustomerFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [customerNumber, setCustomerNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="px-4 py-2 text-left text-sm text-accent hover:underline"
      >
        + Add New Customer
      </button>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = customerNumber.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);

    const record: CustomerRecord = { customerNumber: trimmed, name, address: address ?? '' };
    const result = await requestAddCustomer(record);

    setSubmitting(false);

    if (!result.ok) {
      setError(
        result.error === 'duplicate-customer-number'
          ? `Customer #${trimmed} already exists — pick a different number.`
          : "Couldn't save this customer. Try again.",
      );
      return;
    }

    onAdded(record);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 px-4 py-2">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">
        <div>
          Name: <span className="text-neutral-900 dark:text-neutral-100">{name}</span>
        </div>
        <div>
          Address: <span className="text-neutral-900 dark:text-neutral-100">{address || 'Not available'}</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={customerNumber}
          onChange={(event) => setCustomerNumber(event.target.value)}
          placeholder="Customer #"
          autoFocus
          className="w-28 rounded border border-border bg-transparent px-2 py-1 text-sm dark:border-border-dark"
        />
        <button
          type="submit"
          disabled={submitting || customerNumber.trim().length === 0}
          className="rounded bg-accent px-2 py-1 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-sm text-neutral-500 hover:underline dark:text-neutral-400"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}
