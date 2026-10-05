/**
 * A small RFC 4180 CSV reader for imports (CD-64): UTF-8 text with a header row, comma or
 * semicolon separated (Excel uses ";" in locales with a decimal comma), fields optionally quoted
 * with `"` (a quote inside is doubled), and line breaks inside quoted fields. No dependency, so the
 * rules are exactly the ones tested in test/csv.spec.ts.
 */

export type Delimiter = ',' | ';';

export interface CsvRow {
  /** Line in the file where the record starts (the header is line 1). */
  line: number;
  cells: string[];
}

export interface ParsedCsv {
  delimiter: Delimiter;
  headers: string[];
  rows: CsvRow[];
}

export class CsvError extends Error {}

/** The first record decides: semicolons outside quotes outnumbering commas mean ";". */
export function detectDelimiter(text: string): Delimiter {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch === ',') commas++;
    else if (!quoted && ch === ';') semicolons++;
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Parses the whole text. Empty lines (and records whose cells are all blank) are skipped; a record
 * with fewer cells than the header gets empty strings, and cells beyond the header are dropped.
 * An unterminated quote is an error, because everything after it would be one field.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const records: CsvRow[] = [];

  let line = 1;
  let recordLine = 1;
  let cells: string[] = [];
  let cell = '';
  let quoted = false; // inside a quoted field
  let quoteLine = 0;
  let i = 0;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        // A line break inside quotes is part of the value; normalise CRLF to LF.
        if (ch === '\r' && text[i + 1] === '\n') i++;
        cell += '\n';
        line++;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      // Opening quote (spaces before it, as some tools write `a, "b"`, are dropped).
      cell = '';
      quoted = true;
      quoteLine = line;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endCell();
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
      i++;
      continue;
    }
    // Anything else, including a stray quote in the middle of an unquoted field, is literal.
    cell += ch;
    i++;
  }
  if (quoted) throw new CsvError(`Line ${quoteLine}: a quoted field is never closed (missing ")`);
  endRecord();

  const [header, ...rows] = records;
  if (!header) throw new CsvError('The file is empty');
  const headers = header.cells.map((h, idx) => h.trim() || `Column ${idx + 1}`);
  return { delimiter, headers, rows: rows.map((r) => ({ line: r.line, cells: headers.map((_, idx) => r.cells[idx] ?? '') })) };
}

/**
 * Exports guard cells that start with = + - @ (formula injection) by prefixing an apostrophe. On
 * import that apostrophe is dropped again, so an exported file imports back unchanged.
 */
export const unguardCell = (value: string): string => (/^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value);
