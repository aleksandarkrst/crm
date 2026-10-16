export type CsvValue = string | number | null;

/**
 * One CSV cell like the CRM and time report exports: numbers stay numbers, text is guarded against
 * formulas and quoted when needed (the same rule as `csvCell` in projects/time-report.ts, kept here
 * because modules import each other only through their index).
 */
export function csvCell(value: CsvValue): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
