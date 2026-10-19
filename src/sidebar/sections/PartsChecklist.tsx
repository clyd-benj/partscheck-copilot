import { useState } from 'react';
import { SectionCard } from '@/components/SectionCard';
import type { RequestedPart } from '@/types/rfq';

interface PartsChecklistProps {
  parts: RequestedPart[];
}

export function PartsChecklist({ parts }: PartsChecklistProps) {
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());

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
        parts.map((part) => (
          <label
            key={part.id}
            className="flex cursor-pointer items-start gap-2 px-4 py-1.5 text-sm text-neutral-900 hover:bg-surface-subtle dark:text-neutral-100 dark:hover:bg-surface-dark-subtle"
          >
            <input
              type="checkbox"
              checked={checkedIds.has(part.id)}
              onChange={() => toggle(part.id)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-400 accent-accent"
            />
            <span className={checkedIds.has(part.id) ? 'text-neutral-400 line-through dark:text-neutral-600' : ''}>
              {part.description}
            </span>
          </label>
        ))
      )}
    </SectionCard>
  );
}
