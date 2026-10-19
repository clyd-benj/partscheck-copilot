import { AsaCapsDatabase } from '@/storage/asacapsDb';
import type { PartFitment, Vehicle } from '@/types/asacaps';

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
  partNumber: string;
  description?: string;
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
        partNumber: f.partNumber,
        description: f.description,
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

export function rowsToCsv(rows: CatalogueRow[]): string {
  const headers = [
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
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      [
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
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\n');
}

export function rowsToJson(rows: CatalogueRow[]): string {
  return JSON.stringify(rows, null, 2);
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
  const rows = await buildCatalogueRows();
  triggerDownload(`asa-caps-catalogue-${Date.now()}.csv`, rowsToCsv(rows), 'text/csv');
}

export async function exportJson(): Promise<void> {
  const rows = await buildCatalogueRows();
  triggerDownload(`asa-caps-catalogue-${Date.now()}.json`, rowsToJson(rows), 'application/json');
}

// --- CSV import: restores a catalogue from a file previously produced by
// exportCsv() (same column set). Used to carry data across removing and
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
}

export async function importCsv(text: string): Promise<ImportResult> {
  const rows = parseCsv(text);
  if (rows.length < 2) return { vehiclesImported: 0, fitmentsImported: 0 };

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

  for (const row of rows.slice(1)) {
    const vin = cell(row, col.vin);
    const partNumber = cell(row, col.partNumber);
    if (!vin || !partNumber) continue;

    const firstCapturedAt = cell(row, col.firstCaptured) ?? now;
    const lastCapturedAt = cell(row, col.lastCaptured) ?? firstCapturedAt;
    const timesCopiedRaw = cell(row, col.timesCopied);
    const timesCopied = timesCopiedRaw ? parseInt(timesCopiedRaw, 10) || 1 : 1;

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
    const fitment: PartFitment = {
      id: fitmentId,
      vin,
      sessionId: existingFitment?.sessionId ?? 'imported',
      partNumber: normalisedPartNumber,
      description: cell(row, col.description) ?? existingFitment?.description,
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

  return { vehiclesImported: touchedVins.size, fitmentsImported };
}
