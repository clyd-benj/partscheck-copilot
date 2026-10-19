import { FieldRow } from '@/components/FieldRow';
import { SectionCard } from '@/components/SectionCard';
import type { CustomerInfo } from '@/types/rfq';

interface CustomerSectionProps {
  customer: CustomerInfo;
}

export function CustomerSection({ customer }: CustomerSectionProps) {
  return (
    <SectionCard title="Customer">
      <FieldRow label="Company" value={customer.company} />
      <FieldRow label="Address" value={customer.address} />
      <FieldRow label="Phone" value={customer.phone} />
    </SectionCard>
  );
}
