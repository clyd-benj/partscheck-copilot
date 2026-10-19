import { FieldRow } from '@/components/FieldRow';
import { SectionCard } from '@/components/SectionCard';

interface QuoteDetailsSectionProps {
  reference: string | undefined;
  requiredBy: string | undefined;
}

export function QuoteDetailsSection({ reference, requiredBy }: QuoteDetailsSectionProps) {
  return (
    <SectionCard title="Quote Details">
      <FieldRow label="Reference" value={reference} copyable />
      <FieldRow label="Required By" value={requiredBy} />
    </SectionCard>
  );
}
