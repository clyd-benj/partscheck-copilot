import type { Vehicle } from '@/types/asacaps';

/**
 * Build dates as a comparable "build month": year * 12 + month (1–12), so
 * the gap between two vehicles is a plain subtraction in months.
 *
 * Two sources, best first:
 *  - ASA CAPS production date on the catalogue's vehicle record
 *    (`productionFrom`, "year.month.day", e.g. "2010.12.3");
 *  - PartsCheck "Mth/Yr" ("6/2022" or "06/2022"), typed by the repairer and
 *    only approximate.
 * Missing or garbled values give undefined rather than a guess.
 */

export type BuildMonthSource = 'asacaps' | 'partscheck';

export interface BuildMonth {
  month: number;
  source: BuildMonthSource;
}

const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

function toBuildMonth(year: number, month: number): number | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month)) return undefined;
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return undefined;
  return year * 12 + month;
}

/** ASA CAPS production date "2010.12.3" → build month. */
export function parseAsaProductionDate(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d{4})\.(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (!match) return undefined;
  return toBuildMonth(Number(match[1]), Number(match[2]));
}

/**
 * ASA CAPS production date "2021.11.3" → a comparable day number
 * (build month * 31 + day). Needs the day; undefined otherwise.
 */
export function parseAsaProductionDay(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (!match) return undefined;
  const month = toBuildMonth(Number(match[1]), Number(match[2]));
  const day = Number(match[3]);
  return month === undefined || day < 1 || day > 31 ? undefined : month * 31 + day;
}

/** PartsCheck Mth/Yr "6/2022" or "06/2022" → build month. */
export function parsePartsCheckMthYr(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d{1,2})\s*\/\s*(\d{4})$/);
  if (!match) return undefined;
  return toBuildMonth(Number(match[2]), Number(match[1]));
}

/** Build month for a vehicle: ASA CAPS productionFrom first, else PartsCheck Mth/Yr. */
export function vehicleBuildMonth(
  vehicle: Pick<Vehicle, 'productionFrom'> | undefined,
  mthYr: string | undefined,
): BuildMonth | undefined {
  const fromAsa = parseAsaProductionDate(vehicle?.productionFrom);
  if (fromAsa !== undefined) return { month: fromAsa, source: 'asacaps' };
  const fromPartsCheck = parsePartsCheckMthYr(mthYr);
  if (fromPartsCheck !== undefined) return { month: fromPartsCheck, source: 'partscheck' };
  return undefined;
}

/** Calendar year of a build month (December stays in its own year). */
export function buildYear(buildMonth: number): number {
  return Math.floor((buildMonth - 1) / 12);
}

/** "2022-06" — how build months are written to CSV. */
export function formatBuildMonth(buildMonth: number): string {
  const year = buildYear(buildMonth);
  const month = buildMonth - year * 12;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Reads a build month written by formatBuildMonth. */
export function parseBuildMonthText(value: string | undefined): number | undefined {
  const match = value?.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return undefined;
  return toBuildMonth(Number(match[1]), Number(match[2]));
}
