/**
 * Parts that vary by trim, colour or build date.
 *
 * When the same wording + side on one model code has been answered with two
 * or more different part numbers (past quotes or the ASA catalogue), the
 * wording "varies" for that model code. A confirmed suggestion then stands
 * only if every clean split of the answers puts this vehicle on that part's
 * side:
 *  - trim: each ASA classification seen maps to one part number;
 *  - colour (only for colour variants: same base number with different
 *    colour suffixes, or descriptions naming a colour): each exterior colour
 *    code maps to one part number;
 *  - build date: ordered by ASA production date, each part number covers one
 *    unbroken run. The vehicle must fall within its part's run, or beyond
 *    the first/last run; a date between two runs (around a changeover) is
 *    unknown, so the usual 12-month window never reaches across one.
 * A split needs every answer's value (and the vehicle's) to be known. No
 * clean split → that wording + model code is never confirmed; it stays
 * manual.
 */

export interface VariantAnswer {
  partNumber: string;
  vin: string;
  classification?: string;
  exteriorColour?: string;
  /** From parseAsaProductionDay. */
  productionDay?: number;
  /** ASA or ERA description, for colour words. */
  description?: string;
}

export interface VariantVehicle {
  classification?: string;
  exteriorColour?: string;
  productionDay?: number;
}

export type SplitKind = 'trim' | 'colour' | 'build date';

export interface VariantCheck {
  /** Different part numbers answer this wording on this model code. */
  varies: boolean;
  /** Clean splits found (empty when varies and none split). */
  splits: SplitKind[];
  /** Why this part number can't be confirmed for the vehicle; undefined when it can. */
  veto(partNumber: string): string | undefined;
}

/** Colour suffix numbers: ####A### / ####AA## plus a 1–2 letter colour code. */
const COLOUR_SUFFIXED = /^(\d{4}(?:[A-Z]\d{3}|[A-Z]{2}\d{2}))([A-Z]{1,2})?$/;
const COLOUR_WORDS =
  /\b(BLACK|WHITE|SILVER|GREY|GRAY|RED|BLUE|GREEN|BROWN|ORANGE|YELLOW|BRONZE|CHROME|TITANIUM|PEARL|METALLIC)\b/;

const norm = (value: string | undefined) => value?.trim().toUpperCase() || undefined;

function areColourVariants(answers: VariantAnswer[], parts: string[]): boolean {
  const bases = parts.map((p) => p.toUpperCase().match(COLOUR_SUFFIXED));
  if (bases.every((m) => m) && new Set(bases.map((m) => m![1])).size === 1) return true;
  return answers.some((a) => COLOUR_WORDS.test((a.description ?? '').toUpperCase()));
}

/** value → part number when every answer has a value and each value maps to one part. */
function cleanMap(
  answers: VariantAnswer[],
  value: (a: VariantAnswer) => string | undefined,
): Map<string, string> | undefined {
  const map = new Map<string, string>();
  for (const answer of answers) {
    const key = value(answer);
    if (!key) return undefined;
    const previous = map.get(key);
    if (previous && previous !== answer.partNumber) return undefined;
    map.set(key, answer.partNumber);
  }
  return map;
}

interface DateRun {
  partNumber: string;
  first: number;
  last: number;
}

/** Each part number's unbroken run in production-date order, or undefined if they interleave. */
function dateRuns(answers: VariantAnswer[]): DateRun[] | undefined {
  if (answers.some((a) => a.productionDay === undefined)) return undefined;
  const sorted = [...answers].sort((a, b) => a.productionDay! - b.productionDay!);
  const runs: DateRun[] = [];
  for (const answer of sorted) {
    const day = answer.productionDay!;
    const current = runs[runs.length - 1];
    if (current && current.partNumber === answer.partNumber) {
      current.last = day;
      continue;
    }
    // Two parts on the same day, or a part coming back after another: no clean split.
    if (current && current.last === day) return undefined;
    if (runs.some((r) => r.partNumber === answer.partNumber)) return undefined;
    runs.push({ partNumber: answer.partNumber, first: day, last: day });
  }
  return runs;
}

function partForDay(runs: DateRun[], day: number): string | undefined {
  for (let i = 0; i < runs.length; i += 1) {
    const before = i === 0 ? Number.NEGATIVE_INFINITY : runs[i].first;
    const after = i === runs.length - 1 ? Number.POSITIVE_INFINITY : runs[i].last;
    if (day >= before && day <= after) return runs[i].partNumber;
  }
  return undefined;
}

export function checkVariants(answers: VariantAnswer[], vehicle: VariantVehicle): VariantCheck {
  const normalised = answers.map((a) => ({ ...a, partNumber: a.partNumber.toUpperCase() }));
  const parts = Array.from(new Set(normalised.map((a) => a.partNumber)));
  if (parts.length < 2) return { varies: false, splits: [], veto: () => undefined };

  // Expected part number per split, for this vehicle (undefined: can't tell).
  const expected = new Map<SplitKind, string | undefined>();
  const trim = cleanMap(normalised, (a) => norm(a.classification));
  if (trim) expected.set('trim', trim.get(norm(vehicle.classification) ?? ''));
  if (areColourVariants(normalised, parts)) {
    const colour = cleanMap(normalised, (a) => norm(a.exteriorColour));
    if (colour) expected.set('colour', colour.get(norm(vehicle.exteriorColour) ?? ''));
  }
  const runs = dateRuns(normalised);
  if (runs) {
    expected.set(
      'build date',
      vehicle.productionDay === undefined ? undefined : partForDay(runs, vehicle.productionDay),
    );
  }

  const splits = Array.from(expected.keys());
  return {
    varies: true,
    splits,
    veto(partNumber) {
      if (splits.length === 0) return 'part number varies on this model (no clean split)';
      for (const [kind, part] of expected) {
        if (part === undefined) return `varies by ${kind}: can't tell for this vehicle`;
        if (part !== partNumber.toUpperCase())
          return `varies by ${kind}: other part for this vehicle`;
      }
      return undefined;
    },
  };
}
