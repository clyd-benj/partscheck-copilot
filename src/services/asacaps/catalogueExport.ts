import { AsaCapsDatabase } from '@/storage/asacapsDb';
import { formatBuildMonth, parseBuildMonthText } from '@/services/quoteCapture/buildDate';
import { normaliseDescription, parseSide } from '@/services/quoteCapture/normalise';
import { withFitmentSource, type FitmentSource, type PartFitment, type Vehicle } from '@/types/asacaps';
import type { QuoteMapping, Side } from '@/types/quoteMapping';

export interface CatalogueRow {
  vin: string;
  make?: string;
  model?: string;
  variant?: string;
  year?: string;
  modelCode?: string;
  chassisCode?: string;
  classification?: string;
  option?: string;
  exteriorColor?: string;
  interiorColor?: string;
  /** ASA CAPS production dates, "year.month.day" (e.g. "2010.12.3"). */
  productionFrom?: string;
  productionTo?: string;
  partNumber: string;
  description?: string;
  /** ERA description, for parts captured from PartsCheck quotes. */
  eraDescription?: string;
  sources: FitmentSource[];
  pnc?: string;
  timesCopied: number;
  firstCapturedAt: string;
  lastCapturedAt: string;
}

export async function buildCatalogueRows(): Promise<CatalogueRow[]> {
  const [fitments, vehicles] = await Promise.all([
    AsaCapsDatabase.listFitments(),
    AsaCapsDatabase.listVehicles(),
  ]);
  const vehicleByVin = new Map<string, Vehicle>(vehicles.map((v) => [v.vin, v]));

  return fitments
    .map((f: PartFitment) => {
      const vehicle = vehicleByVin.get(f.vin);
      return {
        vin: f.vin,
        make: vehicle?.make,
        model: vehicle?.model,
        variant: vehicle?.variant,
        year: vehicle?.year,
        modelCode: vehicle?.modelCode,
        chassisCode: vehicle?.chassisCode,
        classification: vehicle?.classification,
        option: vehicle?.option,
        exteriorColor: vehicle?.exteriorColor,
        interiorColor: vehicle?.interiorColor,
        productionFrom: vehicle?.productionFrom,
        productionTo: vehicle?.productionTo,
        partNumber: f.partNumber,
        description: f.description,
        eraDescription: f.eraDescription,
        sources: f.sources ?? ['asacaps'],
        pnc: f.pnc,
        timesCopied: f.timesCopied,
        firstCapturedAt: f.firstCapturedAt,
        lastCapturedAt: f.lastCapturedAt,
      };
    })
    .sort((a, b) => b.lastCapturedAt.localeCompare(a.lastCapturedAt));
}

function csvEscape(value: unknown): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Columns up to "Last Captured" are the original catalogue export, in their
// original order; everything after was added for PartsCheck quote capture.
// "Record Type" tells fitment rows from quote-mapping rows; files exported
// before it existed import as fitments.
const FITMENT_HEADERS = [
  'VIN',
  'Make',
  'Model',
  'Variant',
  'Year',
  'Model Code',
  'Chassis Code',
  'Classification',
  'Option',
  'Exterior Color',
  'Interior Color',
  'Part Number',
  'PNC',
  'Description',
  'Times Copied',
  'First Captured',
  'Last Captured',
  'Production From',
  'Production To',
  'ERA Description',
  'Sources',
  'Record Type',
];

const MAPPING_HEADERS = [
  'Quote Key',
  'Draft ID',
  'PartsCheck Reference',
  'ERA Quote No',
  'Row',
  'Iteration',
  'Draft Item ID',
  'Repairer Description',
  'Repairer Normalised',
  'Side',
  'Qty',
  'List Price',
  'Buy Price',
  'Note',
  'No Genuine Part',
  'Accessory',
  'Side Conflict',
  'Series',
  'Model Nr',
  'Registration',
  'Mth/Yr',
  'Build Month',
  'Build Month Source',
];

const RECORD_FITMENT = 'fitment';
const RECORD_QUOTE_MAPPING = 'quote-mapping';

function fitmentCells(row: CatalogueRow): unknown[] {
  return [
    row.vin,
    row.make,
    row.model,
    row.variant,
    row.year,
    row.modelCode,
    row.chassisCode,
    row.classification,
    row.option,
    row.exteriorColor,
    row.interiorColor,
    row.partNumber,
    row.pnc,
    row.description,
    row.timesCopied,
    row.firstCapturedAt,
    row.lastCapturedAt,
    row.productionFrom,
    row.productionTo,
    row.eraDescription,
    row.sources.join(';'),
    RECORD_FITMENT,
    ...MAPPING_HEADERS.map(() => undefined),
  ];
}

function mappingCells(m: QuoteMapping): unknown[] {
  return [
    m.vin,
    m.make,
    m.model,
    undefined, // Variant
    undefined, // Year
    m.modelCode,
    undefined, // Chassis Code
    undefined, // Classification
    undefined, // Option
    undefined, // Exterior Color
    undefined, // Interior Color
    m.partNumber,
    undefined, // PNC
    undefined, // Description (ASA) — quote rows only have the ERA one
    undefined, // Times Copied
    m.firstSeen,
    m.lastSeen,
    undefined, // Production From (on the vehicle's fitment rows)
    undefined, // Production To
    m.eraDescription,
    undefined, // Sources
    RECORD_QUOTE_MAPPING,
    m.quoteKey,
    m.draftId,
    m.reference,
    m.eraQuoteNo,
    m.rowNo,
    m.iteration,
    m.draftItemId,
    m.repairerDescription,
    m.repairerNormalised,
    m.side,
    m.qty,
    m.listPrice,
    m.buyPrice,
    m.note,
    m.noGenuinePart,
    m.isAccessory,
    m.sideConflict,
    m.series,
    m.modelNr,
    m.registration,
    m.mthYr,
    m.buildMonth === undefined ? undefined : formatBuildMonth(m.buildMonth),
    m.buildMonthSource,
  ];
}

export function rowsToCsv(rows: CatalogueRow[], mappings: QuoteMapping[] = []): string {
  const lines = [[...FITMENT_HEADERS, ...MAPPING_HEADERS].join(',')];
  for (const row of rows) lines.push(fitmentCells(row).map(csvEscape).join(','));
  for (const mapping of mappings) lines.push(mappingCells(mapping).map(csvEscape).join(','));
  return lines.join('\n');
}

export function rowsToJson(rows: CatalogueRow[], mappings: QuoteMapping[] = []): string {
  return JSON.stringify({ fitments: rows, quoteMappings: mappings }, null, 2);
}

export function triggerDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportCsv(): Promise<void> {
  const [rows, mappings] = await Promise.all([buildCatalogueRows(), AsaCapsDatabase.listQuoteMappings()]);
  triggerDownload(`asa-caps-catalogue-${Date.now()}.csv`, rowsToCsv(rows, mappings), 'text/csv');
}

export async function exportJson(): Promise<void> {
  const [rows, mappings] = await Promise.all([buildCatalogueRows(), AsaCapsDatabase.listQuoteMappings()]);
  triggerDownload(`asa-caps-catalogue-${Date.now()}.json`, rowsToJson(rows, mappings), 'application/json');
}

// --- CSV import: restores a catalogue (and any PartsCheck quote mappings
// in it) from a file previously produced by exportCsv() (same column set). Used to carry data across removing and
// reloading the unpacked extension, since that wipes the extension's
// IndexedDB. Merge-safe: importing the same file twice, or importing into
// a catalogue that already has data, upserts rather than duplicating —
// existing values win where the import is missing them, timesCopied takes
// the max, and first/last captured dates take the widest range.

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // skip; \n (handled below) ends the row
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export interface ImportResult {
  vehiclesImported: number;
  fitmentsImported: number;
  quoteMappingsImported: number;
}

const FITMENT_SOURCES: readonly FitmentSource[] = ['asacaps', 'partscheck-quote', 'imported'];
const SIDES: readonly Side[] = ['LH', 'RH', 'BOTH', 'NONE'];

function parseSources(value: string | undefined): FitmentSource[] {
  if (!value) return [];
  return value
    .split(';')
    .map((source) => source.trim())
    .filter((source): source is FitmentSource => FITMENT_SOURCES.includes(source as FitmentSource));
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function importCsv(text: string): Promise<ImportResult> {
  const rows = parseCsv(text);
  if (rows.length < 2) return { vehiclesImported: 0, fitmentsImported: 0, quoteMappingsImported: 0 };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const colIndex = (name: string) => header.indexOf(name);
  const col = {
    vin: colIndex('vin'),
    make: colIndex('make'),
    model: colIndex('model'),
    variant: colIndex('variant'),
    year: colIndex('year'),
    modelCode: colIndex('model code'),
    chassisCode: colIndex('chassis code'),
    classification: colIndex('classification'),
    option: colIndex('option'),
    exteriorColor: colIndex('exterior color'),
    interiorColor: colIndex('interior color'),
    partNumber: colIndex('part number'),
    pnc: colIndex('pnc'),
    description: colIndex('description'),
    timesCopied: colIndex('times copied'),
    firstCaptured: colIndex('first captured'),
    lastCaptured: colIndex('last captured'),
    productionFrom: colIndex('production from'),
    productionTo: colIndex('production to'),
    eraDescription: colIndex('era description'),
    sources: colIndex('sources'),
    recordType: colIndex('record type'),
    quoteKey: colIndex('quote key'),
    draftId: colIndex('draft id'),
    reference: colIndex('partscheck reference'),
    eraQuoteNo: colIndex('era quote no'),
    rowNo: colIndex('row'),
    iteration: colIndex('iteration'),
    draftItemId: colIndex('draft item id'),
    repairerDescription: colIndex('repairer description'),
    repairerNormalised: colIndex('repairer normalised'),
    side: colIndex('side'),
    qty: colIndex('qty'),
    listPrice: colIndex('list price'),
    buyPrice: colIndex('buy price'),
    note: colIndex('note'),
    noGenuinePart: colIndex('no genuine part'),
    accessory: colIndex('accessory'),
    sideConflict: colIndex('side conflict'),
    series: colIndex('series'),
    modelNr: colIndex('model nr'),
    registration: colIndex('registration'),
    mthYr: colIndex('mth/yr'),
    buildMonth: colIndex('build month'),
    buildMonthSource: colIndex('build month source'),
  };

  if (col.vin === -1 || col.partNumber === -1) {
    throw new Error('CSV must have "VIN" and "Part Number" columns (use a file exported from this extension).');
  }

  const cell = (row: string[], index: number): string | undefined => {
    if (index < 0) return undefined;
    const value = row[index]?.trim();
    return value ? value : undefined;
  };

  const now = new Date().toISOString();
  const touchedVins = new Set<string>();
  let fitmentsImported = 0;

  let quoteMappingsImported = 0;

  for (const row of rows.slice(1)) {
    if (cell(row, col.recordType) === RECORD_QUOTE_MAPPING) {
      if (await importQuoteMappingRow(row)) quoteMappingsImported++;
      continue;
    }

    const vin = cell(row, col.vin);
    const partNumber = cell(row, col.partNumber);
    if (!vin || !partNumber) continue;

    const firstCapturedAt = cell(row, col.firstCaptured) ?? now;
    const lastCapturedAt = cell(row, col.lastCaptured) ?? firstCapturedAt;
    const timesCopiedRaw = cell(row, col.timesCopied);
    const parsedTimesCopied = timesCopiedRaw ? parseInt(timesCopiedRaw, 10) : NaN;
    // 0 is valid: a part only seen on PartsCheck quotes was never copied in ASA CAPS.
    const timesCopied = Number.isNaN(parsedTimesCopied) ? 1 : parsedTimesCopied;

    if (!touchedVins.has(vin)) {
      touchedVins.add(vin);
      const existingVehicle = await AsaCapsDatabase.getVehicle(vin);
      const vehicle: Vehicle = {
        id: vin,
        vin,
        make: cell(row, col.make) ?? existingVehicle?.make,
        model: cell(row, col.model) ?? existingVehicle?.model,
        variant: cell(row, col.variant) ?? existingVehicle?.variant,
        year: cell(row, col.year) ?? existingVehicle?.year,
        modelCode: cell(row, col.modelCode) ?? existingVehicle?.modelCode,
        chassisCode: cell(row, col.chassisCode) ?? existingVehicle?.chassisCode,
        classification: cell(row, col.classification) ?? existingVehicle?.classification,
        option: cell(row, col.option) ?? existingVehicle?.option,
        exteriorColor: cell(row, col.exteriorColor) ?? existingVehicle?.exteriorColor,
        interiorColor: cell(row, col.interiorColor) ?? existingVehicle?.interiorColor,
        productionFrom: cell(row, col.productionFrom) ?? existingVehicle?.productionFrom,
        productionTo: cell(row, col.productionTo) ?? existingVehicle?.productionTo,
        rawText: existingVehicle?.rawText ?? '',
        firstSeen: existingVehicle?.firstSeen ?? firstCapturedAt,
        lastSeen:
          existingVehicle?.lastSeen && existingVehicle.lastSeen > lastCapturedAt
            ? existingVehicle.lastSeen
            : lastCapturedAt,
      };
      await AsaCapsDatabase.putVehicle(vehicle);
    }

    const normalisedPartNumber = partNumber.toUpperCase();
    const fitmentId = `${vin}::${normalisedPartNumber}`;
    const existingFitment = await AsaCapsDatabase.getFitment(fitmentId);
    const importedSources = parseSources(cell(row, col.sources));
    const fitment: PartFitment = {
      id: fitmentId,
      vin,
      sessionId: existingFitment?.sessionId ?? 'imported',
      partNumber: normalisedPartNumber,
      description: cell(row, col.description) ?? existingFitment?.description,
      eraDescription: cell(row, col.eraDescription) ?? existingFitment?.eraDescription,
      // Files exported before the Sources column existed are marked 'imported'.
      sources: existingFitment
        ? importedSources.reduce(withFitmentSource, existingFitment.sources ?? ['asacaps'])
        : importedSources.length > 0
          ? importedSources
          : ['imported'],
      pnc: cell(row, col.pnc) ?? existingFitment?.pnc,
      timesCopied: Math.max(existingFitment?.timesCopied ?? 0, timesCopied),
      firstCapturedAt:
        existingFitment && existingFitment.firstCapturedAt < firstCapturedAt
          ? existingFitment.firstCapturedAt
          : firstCapturedAt,
      lastCapturedAt:
        existingFitment && existingFitment.lastCapturedAt > lastCapturedAt
          ? existingFitment.lastCapturedAt
          : lastCapturedAt,
    };
    await AsaCapsDatabase.putFitment(fitment);
    fitmentsImported++;
  }

  return { vehiclesImported: touchedVins.size, fitmentsImported, quoteMappingsImported };

  function importedBuildMonth(row: string[]): Pick<QuoteMapping, 'buildMonth' | 'buildMonthSource'> {
    const buildMonth = parseBuildMonthText(cell(row, col.buildMonth));
    const source = cell(row, col.buildMonthSource);
    if (buildMonth === undefined) return {};
    return {
      buildMonth,
      buildMonthSource: source === 'asacaps' || source === 'partscheck' ? source : undefined,
    };
  }

  /** Upserts one quote-mapping row by id; keeps the widest first/last seen range. */
  async function importQuoteMappingRow(row: string[]): Promise<boolean> {
    const quoteKey = cell(row, col.quoteKey);
    const rowNo = parseOptionalNumber(cell(row, col.rowNo));
    const partNumber = cell(row, col.partNumber)?.toUpperCase();
    const repairerDescription = cell(row, col.repairerDescription);
    if (!quoteKey || rowNo === undefined || !partNumber || !repairerDescription) return false;

    const iteration = parseOptionalNumber(cell(row, col.iteration)) ?? 0;
    const id = iteration === 0 ? `${quoteKey}::${rowNo}` : `${quoteKey}::${rowNo}.${iteration}`;
    const existing = (await AsaCapsDatabase.listQuoteMappingsForQuote(quoteKey)).find((m) => m.id === id);
    const firstSeen = cell(row, col.firstCaptured) ?? now;
    const lastSeen = cell(row, col.lastCaptured) ?? firstSeen;
    const side = cell(row, col.side) as Side | undefined;
    const flag = (index: number) => cell(row, index)?.toLowerCase() === 'true';

    await AsaCapsDatabase.putQuoteMappings([
      {
        id,
        quoteKey,
        draftId: cell(row, col.draftId),
        reference: cell(row, col.reference),
        eraQuoteNo: cell(row, col.eraQuoteNo),
        rowNo,
        iteration,
        draftItemId: cell(row, col.draftItemId) ?? '',
        repairerDescription,
        repairerNormalised:
          cell(row, col.repairerNormalised) ?? normaliseDescription(repairerDescription),
        side: side && SIDES.includes(side) ? side : parseSide(repairerDescription),
        partNumber,
        eraDescription: cell(row, col.eraDescription),
        qty: parseOptionalNumber(cell(row, col.qty)),
        listPrice: parseOptionalNumber(cell(row, col.listPrice)),
        buyPrice: parseOptionalNumber(cell(row, col.buyPrice)),
        note: cell(row, col.note),
        noGenuinePart: flag(col.noGenuinePart),
        isAccessory: flag(col.accessory),
        sideConflict: flag(col.sideConflict),
        vin: cell(row, col.vin),
        make: cell(row, col.make),
        model: cell(row, col.model),
        series: cell(row, col.series),
        modelNr: cell(row, col.modelNr),
        registration: cell(row, col.registration),
        mthYr: cell(row, col.mthYr),
        modelCode: cell(row, col.modelCode),
        ...importedBuildMonth(row),
        learnedLinkId: existing?.learnedLinkId,
        firstSeen: existing && existing.firstSeen < firstSeen ? existing.firstSeen : firstSeen,
        lastSeen: existing && existing.lastSeen > lastSeen ? existing.lastSeen : lastSeen,
      },
    ]);
    return true;
  }
}
