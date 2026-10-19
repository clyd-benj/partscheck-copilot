import { FieldRow } from '@/components/FieldRow';
import { SectionCard } from '@/components/SectionCard';
import type { Vehicle, VehicleSession } from '@/types/asacaps';

interface ActiveVehicleSectionProps {
  session: VehicleSession | null;
  vehicle: Vehicle | null;
}

function vehicleTitle(vehicle: Vehicle | null, vin: string): string {
  if (!vehicle) return vin;
  const parts = [vehicle.make, vehicle.model ?? vehicle.modelCode, vehicle.variant].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : vin;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ActiveVehicleSection({ session, vehicle }: ActiveVehicleSectionProps) {
  if (!session) {
    return (
      <SectionCard title="Active Vehicle">
        <p className="px-4 py-2 text-sm italic text-neutral-400 dark:text-neutral-600">
          No active vehicle yet. Copy vehicle details from ASA CAPS to begin.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Active Vehicle">
      <div className="px-4 py-1.5">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {vehicleTitle(vehicle, session.vin)}
        </p>
      </div>
      <FieldRow label="VIN" value={session.vin} copyable />
      <FieldRow label="Session started" value={formatTime(session.startedAt)} />
      <FieldRow label="Parts captured" value={String(session.partCount)} />
    </SectionCard>
  );
}
