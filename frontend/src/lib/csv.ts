/**
 * Building and downloading CSV files in the browser (list export CD-65, the import's failed rows
 * CD-64). Excel-friendly: UTF-8 with a BOM, CRLF line ends, fields quoted when they contain a comma,
 * quote or line break. Cells that start with = + - @ (or a tab / carriage return) get a leading
 * apostrophe, so a spreadsheet shows them as text instead of running them as formulas; the import
 * drops that apostrophe again.
 */

export type CsvValue = string | number | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

/** One cell: numbers stay numbers, text is guarded against formulas and quoted when needed. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The whole file, BOM included. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)), ...rows.map((r) => columns.map((c) => csvCell(c.value(r))))];
  return '\uFEFF' + lines.map((l) => l.join(',')).join('\r\n') + '\r\n';
}

/** Saves text as a file through a temporary link. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type }));
}

/** Saves a Blob (e.g. an Excel file) as a file through a temporary link. */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "pultly-contacts-2026-09-24.csv" */
export const datedName = (what: string) => `pultly-${what}-${new Date().toISOString().slice(0, 10)}.csv`;
