import { describe, expect, it } from 'vitest';
import { CsvError, detectDelimiter, parseCsv, unguardCell } from '../src/shared/import/csv';
import { guessMapping, IMPORT_FIELDS, templateCsv } from '../src/modules/crm/import/import-fields';
import { normalizeAmount, normalizeDate } from '../src/modules/crm/import/import.service';

describe('parseCsv', () => {
  it('reads a header row and data rows with line numbers', () => {
    const csv = parseCsv('Name,Industry\nAcme,Retail\nGlobex,Energy\n');
    expect(csv).toEqual({
      delimiter: ',',
      headers: ['Name', 'Industry'],
      rows: [
        { line: 2, cells: ['Acme', 'Retail'] },
        { line: 3, cells: ['Globex', 'Energy'] },
      ],
    });
  });

  it('handles quotes, doubled quotes, delimiters and line breaks inside quotes, and CRLF', () => {
    const csv = parseCsv('Name,Notes\r\n"Acme, Inc.","He said ""hi""\r\nsecond line"\r\nGlobex,""\r\n');
    expect(csv.rows).toEqual([
      { line: 2, cells: ['Acme, Inc.', 'He said "hi"\nsecond line'] },
      { line: 4, cells: ['Globex', ''] },
    ]);
  });

  it('detects semicolons (Excel in decimal-comma locales) and keeps commas in values', () => {
    const csv = parseCsv('Name;Value\n"Acme; Ltd";14.000,50\nGlobex;1,5\n');
    expect(csv.delimiter).toBe(';');
    expect(csv.rows.map((r) => r.cells)).toEqual([
      ['Acme; Ltd', '14.000,50'],
      ['Globex', '1,5'],
    ]);
  });

  it('ignores delimiters inside quoted header cells when detecting', () => {
    expect(detectDelimiter('"a;b;c",d\n')).toBe(',');
    expect(detectDelimiter('a;b,c;d\n')).toBe(';');
  });

  it('strips the BOM, skips blank lines, pads short rows and drops extra cells', () => {
    const csv = parseCsv('\uFEFFName,Industry\n\nAcme\n , \nGlobex,Energy,extra\n');
    expect(csv.headers).toEqual(['Name', 'Industry']);
    expect(csv.rows).toEqual([
      { line: 3, cells: ['Acme', ''] },
      { line: 5, cells: ['Globex', 'Energy'] },
    ]);
  });

  it('keeps unicode, a stray quote inside an unquoted value, and names empty headers', () => {
    const csv = parseCsv('Name,,Note\nĐorđe Š. 5" screen,x,Zürich\n');
    expect(csv.headers).toEqual(['Name', 'Column 2', 'Note']);
    expect(csv.rows[0]!.cells).toEqual(['Đorđe Š. 5" screen', 'x', 'Zürich']);
  });

  it('reads a last line without a newline and a lone CR as a line break', () => {
    expect(parseCsv('Name\rAcme\rGlobex').rows.map((r) => r.cells[0])).toEqual(['Acme', 'Globex']);
  });

  it('rejects an unterminated quote and an empty file', () => {
    expect(() => parseCsv('Name\n"Acme\nGlobex\n')).toThrow(new CsvError('Line 2: a quoted field is never closed (missing ")'));
    expect(() => parseCsv('\n\n')).toThrow(CsvError);
  });
});

describe('unguardCell', () => {
  it('drops the apostrophe the export adds before = + - @, and nothing else', () => {
    expect(unguardCell("'=SUM(A1)")).toBe('=SUM(A1)');
    expect(unguardCell("'-5")).toBe('-5');
    expect(unguardCell("'quoted'")).toBe("'quoted'");
    expect(unguardCell('=SUM(A1)')).toBe('=SUM(A1)');
  });
});

describe('guessMapping', () => {
  it('matches labels, keys and aliases regardless of case and punctuation', () => {
    expect(guessMapping('companies', ['Company Name', 'WEBSITE', 'team_size', 'Owner'])).toMatchObject({ name: 0, domain: 1, teamSize: 2, ownerEmail: 3, industry: null, notes: null });
  });

  it('uses each column once and prefers exact labels', () => {
    const m = guessMapping('deals', ['Deal', 'Company', 'Email', 'Value', 'Stage']);
    expect(m).toMatchObject({ title: 0, company: 1, contactEmail: 2, amount: 3, stage: 4, funnel: null });
    expect(guessMapping('contacts', ['Name', 'Role', 'Buyer role'])).toMatchObject({ fullName: 0, jobTitle: 1, buyerRole: 2 });
  });
});

describe('templates', () => {
  it('have a BOM, the field labels and an example row that maps back onto every field', () => {
    for (const type of ['companies', 'contacts', 'deals'] as const) {
      const csv = parseCsv(templateCsv(type));
      expect(csv.headers).toEqual(IMPORT_FIELDS[type].map((f) => f.label));
      const mapping = guessMapping(type, csv.headers);
      expect(Object.values(mapping).every((v) => v !== null)).toBe(true);
    }
    expect(templateCsv('deals').startsWith('\uFEFF')).toBe(true);
  });
});

describe('normalizing values', () => {
  it('reads amounts with thousands separators, decimal commas and currency signs', () => {
    expect(normalizeAmount('14000')).toBe('14000');
    expect(normalizeAmount('14,000.50')).toBe('14000.50');
    expect(normalizeAmount('14.000,50')).toBe('14000.50');
    expect(normalizeAmount('€ 14 000')).toBe('14000');
    expect(normalizeAmount('1250,5')).toBe('1250.5');
    expect(normalizeAmount('lots')).toBe('lots');
  });

  it('turns DD.MM.YYYY into ISO and leaves ISO alone', () => {
    expect(normalizeDate('31.12.2026')).toBe('2026-12-31');
    expect(normalizeDate('1.2.2027.')).toBe('2027-02-01');
    expect(normalizeDate('2026-12-31')).toBe('2026-12-31');
    expect(normalizeDate('12/31/2026')).toBe('12/31/2026');
  });
});
