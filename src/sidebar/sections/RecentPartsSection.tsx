import { SectionCard } from '@/components/SectionCard';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import type { PartFitment } from '@/types/asacaps';

interface RecentPartsSectionProps {
  fitments: PartFitment[];
}

const MAX_SHOWN = 10;

export function RecentPartsSection({ fitments }: RecentPartsSectionProps) {
  return (
    <SectionCard title="Recent Parts">
      {fitments.length === 0 ? (
        <p className="px-4 py-2 text-sm italic text-neutral-400 dark:text-neutral-600">No parts captured yet.</p>
      ) : (
        fitments.slice(0, MAX_SHOWN).map((fitment) => <FitmentRow key={fitment.id} fitment={fitment} />)
      )}
    </SectionCard>
  );
}

function FitmentRow({ fitment }: { fitment: PartFitment }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="flex flex-col gap-0.5 px-4 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => copy(fitment.partNumber)}
          title="Click to copy"
          className="-mx-1 truncate rounded px-1 text-sm font-medium text-neutral-900 transition hover:bg-surface-subtle hover:text-accent dark:text-neutral-100 dark:hover:bg-surface-dark-subtle"
        >
          {copied ? 'Copied' : fitment.partNumber}
        </button>
        {fitment.timesCopied > 1 && (
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">×{fitment.timesCopied}</span>
        )}
      </div>
      {fitment.description && (
        <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">{fitment.description}</span>
      )}
    </div>
  );
}
