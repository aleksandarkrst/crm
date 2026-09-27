/**
 * CSV import (CD-64), next to the store: preview, commit and the template come from the API. For
 * owners and admins (the API returns 403 to members; the buttons are hidden for them).
 */
import { api, authorizedFetch } from '../lib/api';
import { type CsvColumn, toCsv } from '../lib/csv';
import type { Funnel, State } from './types';

export type ImportType = 'companies' | 'contacts' | 'deals' | 'products';
export type DuplicateMode = 'skip' | 'update';
export type Mapping = Record<string, number | null>;

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
}
export type RowStatus = 'create' | 'update' | 'skip' | 'invalid';
export interface ImportPreview {
  type: ImportType;
  delimiter: ',' | ';';
  headers: string[];
  mapping: Mapping;
  fields: ImportField[];
  missingRequired: string[];
  warnings: string[];
  counts: { rows: number; create: number; update: number; skip: number; invalid: number; newCompanies: number; newContacts: number };
  rows: { line: number; values: Record<string, string>; status: RowStatus; messages: string[]; notes: string[] }[];
  problems: { line: number; messages: string[] }[];
}
export interface ImportResult {
  type: ImportType;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  newCompanies: number;
  newContacts: number;
  headers: string[];
  failures: { line: number; reason: string; cells: string[] }[];
  skippedRows: { line: number; reason: string }[];
}
export interface ImportRequest {
  csv: string;
  mapping?: Mapping;
  duplicates: DuplicateMode;
  funnelId?: string;
}

/** The same limits as the API, checked before uploading. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export const importApi = {
  preview: (type: ImportType, req: ImportRequest) => api<ImportPreview>(`/crm/import/${type}/preview`, { method: 'POST', json: req }),
  commit: (type: ImportType, req: ImportRequest) => api<ImportResult>(`/crm/import/${type}/commit`, { method: 'POST', json: req }),
  /** The template is CSV, not JSON, so it doesn't go through api(). */
  template: async (type: ImportType): Promise<string> => {
    const res = await authorizedFetch(`/crm/import/${type}/template`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Keep the BOM: text() drops it, and Excel needs it to read UTF-8.
    return '\uFEFF' + (await res.text()).replace(/^\uFEFF/, '');
  },
};

/** Owners and admins import and export. */
export const canImportExport = (role: string) => role === 'owner' || role === 'admin';

/** Funnels with a backend id, in the store's order (works for a keyed record or a list). */
export function funnelOptions(s: State): { id: string; label: string }[] {
  return (Object.values(s.funnels) as Funnel[]).filter((f) => !!f.id).map((f) => ({ id: f.id!, label: f.label }));
}

/** The funnel the Pipeline is showing, if the store can tell. */
export function currentFunnelId(s: State): string | undefined {
  const current = (s.funnels as unknown as Record<string, Funnel | undefined>)[String(s.segment)];
  return current?.id ?? funnelOptions(s)[0]?.id;
}

/** The failed rows of an import as a CSV: line, reason, then the original columns. */
export function failuresCsv(result: ImportResult): string {
  const columns: CsvColumn<ImportResult['failures'][number]>[] = [
    { header: 'Line', value: (f) => f.line },
    { header: 'Reason', value: (f) => f.reason },
    ...result.headers.map((h, i) => ({ header: h, value: (f: ImportResult['failures'][number]) => f.cells[i] ?? '' })),
  ];
  return toCsv(result.failures, columns);
}
