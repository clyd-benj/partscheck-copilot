import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

interface FieldRowProps {
  label: string;
  value: string | undefined;
  /** Clicking the value copies it to the clipboard, with brief "Copied" feedback. */
  copyable?: boolean;
}

export function FieldRow({ label, value, copyable = false }: FieldRowProps) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-1.5">
      <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
      {!value ? (
        <span className="text-right text-sm italic text-neutral-400 dark:text-neutral-600">Not available</span>
      ) : copyable ? (
        <button
          type="button"
          onClick={() => copy(value)}
          title="Click to copy"
          className="-mx-1 truncate rounded px-1 text-right text-sm text-neutral-900 transition hover:bg-surface-subtle hover:text-accent dark:text-neutral-100 dark:hover:bg-surface-dark-subtle"
        >
          {copied ? 'Copied' : value}
        </button>
      ) : (
        <span className="truncate text-right text-sm text-neutral-900 dark:text-neutral-100">{value}</span>
      )}
    </div>
  );
}
