/**
 * Excel (.xlsx) files for the employee import (CD-141, spec 8.3), read and written in the browser.
 * This module and its libraries are loaded only when someone picks an .xlsx or downloads the Excel
 * template (`import('./spreadsheet')`), so they never weigh on the rest of the app.
 *
 * Reading: read-excel-file (maintained, no known vulnerabilities; not the npm `xlsx` 0.18.5). A
 * sheet becomes CSV text for the import API, so the server path and its limits stay one:
 * - the first non-empty row is the header; row N of the sheet is line N of the CSV, so the import's
 *   line numbers are the sheet's row numbers;
 * - formulas give their saved values; merged cells take the top-left cell's value (all of them);
 * - date cells become YYYY-MM-DD; numbers keep the digits Excel saved; text keeps leading zeros;
 * - line breaks inside a cell become spaces (they would shift the line numbers).
 * Refused with the spec's messages: old .xls files and password-protected workbooks (both are OLE
 * compound files, not zip archives).
 */
import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';

export const MAX_XLSX_BYTES = 5 * 1024 * 1024;
export const XLS_MESSAGE = 'Save the file as .xlsx or .csv and try again';
export const PROTECTED_MESSAGE = 'This file is protected. Save it without a password and try again';

export class SpreadsheetError extends Error {}

export interface SheetRows {
  name: string;
  /** Cells as text, row by row from row 1 (empty rows are empty arrays). */
  rows: string[][];
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** "EncryptedPackage" as UTF-16LE: the stream an encrypted (password-protected) .xlsx keeps its content in. */
const ENCRYPTED = [...'EncryptedPackage'].flatMap((c) => [c.charCodeAt(0), 0]);

function startsWith(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((b, i) => bytes[i] === b);
}
function contains(bytes: Uint8Array, needle: number[]) {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Reads every sheet of an .xlsx file. Throws SpreadsheetError with a message for people. */
export async function readWorkbook(file: File): Promise<SheetRows[]> {
  if (/\.xls$/i.test(file.name)) throw new SpreadsheetError(XLS_MESSAGE);
  if (file.size > MAX_XLSX_BYTES) throw new SpreadsheetError(`The file is larger than ${MAX_XLSX_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (startsWith(bytes, OLE_MAGIC)) throw new SpreadsheetError(contains(bytes, ENCRYPTED) ? PROTECTED_MESSAGE : XLS_MESSAGE);
  if (!startsWith(bytes, [0x50, 0x4b])) throw new SpreadsheetError("This file can't be read as an Excel workbook. " + XLS_MESSAGE);

  let sheets;
  try {
    // parseNumber keeps the number as Excel saved it ("00123" text cells are text anyway).
    sheets = await readXlsxFile(new Blob([bytes]), { parseNumber: (s: string) => s });
  } catch (err) {
    throw new SpreadsheetError(`This file can't be read as an Excel workbook (${err instanceof Error ? err.message : String(err)}). ${XLS_MESSAGE}`);
  }
  const merges = mergedRanges(bytes);
  return sheets.map(({ sheet, data }) => {
    const rows = data.map((row) => row.map(cellText));
    for (const range of merges.get(sheet) ?? []) fillMerged(rows, range);
    return { name: sheet, rows };
  });
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).replace(/\r\n|\r|\n/g, ' ');
}

interface Range {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** "B3" → [row 2, column 1] (zero-based). */
function address(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.replace(/\$/g, ''));
  if (!m) return [-1, -1];
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, col - 1];
}

/** Each sheet's merged cell ranges, read from the workbook's XML (read-excel-file leaves them out). */
function mergedRanges(bytes: Uint8Array): Map<string, Range[]> {
  const out = new Map<string, Range[]>();
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' || f.name.startsWith('xl/worksheets/sheet') });
  } catch {
    return out;
  }
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    const xml = rid && targets.get(rid) ? files[`xl/${targets.get(rid)}`] : undefined;
    if (!name || !xml) continue;
    const ranges: Range[] = [];
    for (const merge of strFromU8(xml).matchAll(/<mergeCell\b[^>]*\bref="([A-Z$]+\d+):([A-Z$]+\d+)"/g)) {
      const [top, left] = address(merge[1]!);
      const [bottom, right] = address(merge[2]!);
      if (top >= 0 && left >= 0) ranges.push({ top, left, bottom, right });
    }
    out.set(unescapeXml(name), ranges);
  }
  return out;
}

const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Copies the top-left value of a merged range into its other cells. */
function fillMerged(rows: string[][], r: Range) {
  const value = rows[r.top]?.[r.left] ?? '';
  if (!value) return;
  for (let row = r.top; row <= r.bottom; row++) {
    rows[row] ??= [];
    for (let col = r.left; col <= r.right; col++) {
      while (rows[row]!.length < col) rows[row]!.push('');
      if (!rows[row]![col]) rows[row]![col] = value;
    }
  }
}

/** True when a sheet has at least a header and one more non-empty row. */
export const hasData = (sheet: SheetRows) => sheet.rows.filter((r) => r.some((c) => c.trim() !== '')).length > 1;

/**
 * A sheet as CSV text for the import API: comma separated, quoted where needed, one line per sheet
 * row (row 1 = line 1; empty rows stay as empty lines, which the import skips).
 */
export function sheetToCsv(sheet: SheetRows): string {
  const quote = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return sheet.rows.map((row) => (row.some((c) => c !== '') ? row.map(quote).join(',') : '')).join('\n') + '\n';
}

/**
 * The Excel template: the CSV template's header (bold) and example row, with the employee number
 * as text (so "00123" keeps its zeros) and the start date as a real date cell.
 */
export async function xlsxTemplate(csvTemplate: string): Promise<Blob> {
  const [header = [], example = []] = parseSimpleCsv(csvTemplate.replace(/^\uFEFF/, ''));
  const data = [
    header.map((value) => ({ value, fontWeight: 'bold' as const })),
    example.map((value, i) => {
      const label = header[i] ?? '';
      if (/date/i.test(label) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { value: new Date(`${value}T00:00:00Z`), type: Date, format: 'yyyy-mm-dd' };
      return { value, type: String, format: '@' };
    }),
  ];
  return writeXlsxFile([{ data, sheet: 'Employees', columns: header.map((h) => ({ width: Math.max(12, h.length + 2) })) }]).toBlob();
}

/** The template's two rows (quoted fields allowed, no line breaks inside them). */
function parseSimpleCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const cells: string[] = [];
      let cell = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') {
            cell += '"';
            i++;
          } else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',') {
          cells.push(cell);
          cell = '';
        } else cell += ch;
      }
      cells.push(cell);
      return cells;
    });
}
