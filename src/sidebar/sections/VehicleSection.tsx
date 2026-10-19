import { FieldRow } from '@/components/FieldRow';
import { SectionCard } from '@/components/SectionCard';
import type { VehicleInfo } from '@/types/rfq';

interface VehicleSectionProps {
  vehicle: VehicleInfo;
}

export function VehicleSection({ vehicle }: VehicleSectionProps) {
  return (
    <SectionCard title="Vehicle">
      <FieldRow label="Make" value={vehicle.make} />
      <FieldRow label="Model" value={vehicle.model} />
      <FieldRow label="Variant" value={vehicle.variant} />
      <FieldRow label="VIN" value={vehicle.vin} copyable />
      <FieldRow label="Registration" value={vehicle.registration} />
    </SectionCard>
  );
}
