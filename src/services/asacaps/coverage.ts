// Coverage stats: how close the catalogue is to being useful for
// similarity-based part matching. The signal that matters isn't total
// vehicle count, it's how many vehicles share the same trim
// (classification), since that's what a future matching feature would
// group on. A group with 20+ vehicles is considered "ready" — enough
// overlap that a suggestion drawn from it isn't just a handful of
// coincidental data points.

import { AsaCapsDatabase } from '@/storage/asacapsDb';

const READY_THRESHOLD = 20;

export interface CoverageGroup {
  classification: string;
  vehicleCount: number;
  partCount: number;
  ready: boolean;
}

export interface CoverageSummary {
  totalVehicles: number;
  totalFitments: number;
  readyGroups: number;
  groups: CoverageGroup[];
}

export async function buildCoverageSummary(): Promise<CoverageSummary> {
  const [vehicles, fitments] = await Promise.all([
    AsaCapsDatabase.listVehicles(),
    AsaCapsDatabase.listFitments(),
  ]);

  const partCountByVin = new Map<string, number>();
  for (const fitment of fitments) {
    partCountByVin.set(fitment.vin, (partCountByVin.get(fitment.vin) ?? 0) + 1);
  }

  const groupsByKey = new Map<string, { vehicleCount: number; partCount: number }>();
  for (const vehicle of vehicles) {
    const key = vehicle.classification || vehicle.modelCode || 'Unclassified';
    const entry = groupsByKey.get(key) ?? { vehicleCount: 0, partCount: 0 };
    entry.vehicleCount += 1;
    entry.partCount += partCountByVin.get(vehicle.vin) ?? 0;
    groupsByKey.set(key, entry);
  }

  const groups: CoverageGroup[] = Array.from(groupsByKey.entries())
    .map(([classification, { vehicleCount, partCount }]) => ({
      classification,
      vehicleCount,
      partCount,
      ready: vehicleCount >= READY_THRESHOLD,
    }))
    .sort((a, b) => b.vehicleCount - a.vehicleCount || b.partCount - a.partCount);

  return {
    totalVehicles: vehicles.length,
    totalFitments: fitments.length,
    readyGroups: groups.filter((g) => g.ready).length,
    groups,
  };
}
