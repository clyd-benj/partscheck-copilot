import * as XLSX from 'xlsx';
import type { CustomerRecord } from '@/types/customer';

export function buildCustomerWorkbookBlob(records: CustomerRecord[]): Blob {
  const rows: (string | undefined)[][] = [
    ['Customer #', 'Name', 'Address'],
    ...records.map((record) => [record.customerNumber, record.name, record.address]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Customers');

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as Uint8Array;
  return new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
