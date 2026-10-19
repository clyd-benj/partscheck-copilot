import type { ReactNode } from 'react';

interface SectionCardProps {
  title: string;
  children: ReactNode;
}

export function SectionCard({ title, children }: SectionCardProps) {
  return (
    <section className="border-b border-border py-3 dark:border-border-dark">
      <h2 className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-border/60 dark:divide-border-dark/60">{children}</div>
    </section>
  );
}
