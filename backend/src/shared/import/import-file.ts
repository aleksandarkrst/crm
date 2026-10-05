import { BadRequestException, HttpException, PayloadTooLargeException } from '@nestjs/common';
import { z } from 'zod';
import { mapDbError } from '../database/errors';
import { CsvError, type CsvRow, parseCsv, unguardCell } from './csv';

/**
 * The parts of an import every type shares (CSV import CD-64, employees CD-141): the request body,
 * the limits, reading the file, the column mapping guessed from the headers, and the template.
 * Each module keeps its own fields and row rules.
 */

/** Limits: the file as UTF-8 bytes, and data rows (the header doesn't count). */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
/** Rows per transaction on commit. */
export const IMPORT_BATCH_SIZE = 200;
/** Rows shown in the preview table. */
export const PREVIEW_ROWS = 20;
/** Invalid rows listed in the preview (the counts cover every row). */
export const PREVIEW_PROBLEMS = 100;

/** Field key → column index (null or absent means "not imported"). */
export const ColumnMappingSchema = z.record(z.string(), z.number().int().min(0).nullable());
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  /** Another field that can stand in for this required one (employees: Full name for First and Last name). */
  alternative?: string;
  /** Other header names that map to this field (compared without case, accents, spaces or punctuation). */
  aliases: string[];
  /** Shown in the dialog next to the field. */
  hint?: string;
  /** Value in the template's example row. */
  example: string;
  /** Left out of the template (e.g. Full name, when First and Last name are there). */
  notInTemplate?: boolean;
}

/** "Datum rođenja" and "datum-rodjenja" compare equal: lower case, no accents, letters and digits only. */
export function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Guesses the mapping from the header names: a header matches a field when it equals the field's
 * key, label or one of its aliases, ignoring case, accents, spaces and punctuation. Each column is
 * used once; exact labels win over aliases, so "Company" and "Company name" in one file both find a
 * home.
 */
export function guessMappingOf(fields: readonly ImportField[], headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  const pass = (names: (f: ImportField) => string[]) => {
    for (const f of fields) {
      if (mapping[f.key] !== undefined) continue;
      const wanted = new Set(names(f).map(normalizeHeader));
      const idx = normalized.findIndex((h, i) => !used.has(i) && wanted.has(h));
      if (idx >= 0) {
        mapping[f.key] = idx;
        used.add(idx);
      }
    }
  };
  pass((f) => [f.key, f.label]);
  pass((f) => f.aliases);
  for (const f of fields) mapping[f.key] ??= null;
  return mapping;
}

/** Quotes a template cell when needed (the templates are plain, but keep them valid CSV). */
const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Header row with the field labels plus one example row, UTF-8 with a BOM so Excel reads it right. */
export function templateCsvOf(fields: readonly ImportField[]): string {
  const shown = fields.filter((f) => !f.notInTemplate);
  return '\uFEFF' + [shown.map((f) => cell(f.label)).join(','), shown.map((f) => cell(f.example)).join(',')].join('\r\n') + '\r\n';
}

/** A file read and checked against the limits, with the mapping to use. */
export interface PreparedImport {
  headers: string[];
  delimiter: string;
  rows: CsvRow[];
  mapping: ColumnMapping;
  /** Labels of required fields without a column ("First name or Full name"). */
  missingRequired: string[];
  /** About the whole file (e.g. characters that weren't UTF-8). */
  warnings: string[];
}

/**
 * Reads the file's text: size and row limits, CSV parsing, the mapping (given, or guessed from the
 * headers) checked against the fields and the columns, and the required fields left unmapped.
 */
export function prepareImport(fields: readonly ImportField[], typeName: string, csv: string, given: ColumnMapping | undefined): PreparedImport {
  if (Buffer.byteLength(csv, 'utf8') > MAX_IMPORT_BYTES) {
    throw new PayloadTooLargeException(`The file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
  }
  let parsed;
  try {
    parsed = parseCsv(csv);
  } catch (err) {
    if (err instanceof CsvError) throw new BadRequestException(`The file can't be read as CSV. ${err.message}`);
    throw err;
  }
  if (parsed.rows.length === 0) throw new BadRequestException('The file has a header row but no data rows');
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(`The file has ${parsed.rows.length.toLocaleString('en-US')} rows; the limit is ${MAX_IMPORT_ROWS.toLocaleString('en-US')}. Split it into smaller files.`);
  }
  const mapping = given ? { ...given } : guessMappingOf(fields, parsed.headers);
  for (const [field, idx] of Object.entries(mapping)) {
    if (!fields.some((f) => f.key === field)) throw new BadRequestException(`Unknown field "${field}" for ${typeName}`);
    if (idx !== null && idx >= parsed.headers.length) throw new BadRequestException(`Column ${idx + 1} doesn't exist (the file has ${parsed.headers.length})`);
  }
  for (const f of fields) mapping[f.key] ??= null;
  const warnings: string[] = [];
  if (csv.includes('�')) warnings.push('Some characters could not be read. Save the file as UTF-8 (in Excel: "CSV UTF-8") and upload it again.');
  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const missingRequired = fields
    .filter((f) => f.required && mapping[f.key] === null && !(f.alternative && mapping[f.alternative] !== null))
    .map((f) => (f.alternative ? `${f.label} (or ${labelOf(f.alternative)})` : f.label));
  return { headers: parsed.headers, delimiter: parsed.delimiter, rows: parsed.rows, mapping, missingRequired, warnings };
}

/** The mapped cells of a row by field key, trimmed, with the export's formula guard removed. */
export function valuesOf(mapping: ColumnMapping, row: CsvRow): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [field, idx] of Object.entries(mapping)) values[field] = idx === null ? '' : unguardCell(row.cells[idx] ?? '').trim();
  return values;
}

/** ISO dates stay; DD.MM.YYYY (and D.M.YYYY, with or without the final dot) become ISO. Other formats are left for zod to reject. */
export function normalizeDate(raw: string): string {
  const m = /^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\.?$/.exec(raw.trim());
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : raw.trim();
}

/** A short reason for a row that failed to save. */
export function failureReason(err: unknown): string {
  try {
    mapDbError(err);
  } catch (mapped) {
    if (mapped instanceof HttpException) return mapped.message;
  }
  // drizzle wraps the driver's error ("Failed query: …"); the database's own message is on `cause`.
  const cause = (err as { cause?: unknown }).cause;
  const source = cause instanceof Error && cause.message ? cause : err;
  return source instanceof Error && source.message ? source.message.split('\n')[0]!.slice(0, 200) : 'Could not be saved';
}
