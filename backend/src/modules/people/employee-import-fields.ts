import type { EmploymentType } from '../../shared/database/schema';
import { type ImportField, normalizeDate, normalizeHeader } from '../../shared/import/import-file';

/**
 * The columns of the employee import (spec 8.4) and the pure parsers for their values. Headers are
 * matched by label, key or alias (case, accents, spaces and punctuation ignored), including the
 * Serbian names WBM's own file uses. Unit-tested in test/employee-import.spec.ts.
 */
export const EMPLOYEE_IMPORT_FIELDS: readonly ImportField[] = [
  { key: 'firstName', label: 'First name', required: true, alternative: 'fullName', aliases: ['ime', 'given name', 'firstname', 'first'], example: 'Ana' },
  { key: 'lastName', label: 'Last name', required: true, alternative: 'fullName', aliases: ['prezime', 'surname', 'family name', 'lastname', 'last'], example: 'Petrović' },
  {
    key: 'fullName',
    label: 'Full name',
    required: false,
    aliases: ['ime i prezime', 'name', 'employee', 'employee name', 'zaposleni', 'puno ime'],
    hint: 'Instead of first and last name: the last word is the last name',
    example: '',
    notInTemplate: true,
  },
  {
    key: 'workEmail',
    label: 'Work email',
    required: false,
    aliases: ['email', 'e-mail', 'email adresa', 'e-mail adresa', 'mail', 'poslovni email', 'poslovni e-mail', 'sluzbeni email', 'sluzbeni e-mail'],
    hint: 'Matches existing employees and managers',
    example: 'ana.petrovic@example.com',
  },
  { key: 'employeeNumber', label: 'Employee number', required: false, aliases: ['broj zaposlenog', 'personal number', 'employee id', 'personalni broj', 'maticni broj zaposlenog', 'id zaposlenog'], example: '00123' },
  { key: 'jobTitle', label: 'Job title', required: false, aliases: ['radno mesto', 'radno mjesto', 'pozicija', 'position', 'title', 'funkcija'], example: 'Sales representative' },
  { key: 'department', label: 'Department', required: false, aliases: ['sektor', 'odeljenje', 'odjeljenje', 'department name', 'sluzba'], hint: 'Matched by name, created if new', example: 'Sales' },
  { key: 'team', label: 'Team', required: false, aliases: ['tim', 'grupa', 'group', 'team name'], hint: "Matched by name in the row's department, created if new", example: 'Field sales Belgrade' },
  {
    key: 'managerEmail',
    label: 'Manager email',
    required: false,
    aliases: ['manager', 'reports to', 'nadredjeni', 'naredjeni', 'rukovodilac', 'menadzer', 'sef', 'manager e-mail', 'email rukovodioca', 'email nadredjenog'],
    hint: 'Work email of an employee, or of another row in the file',
    example: 'marko.ilic@example.com',
  },
  {
    key: 'employmentStartDate',
    label: 'Employment start date',
    required: false,
    aliases: ['datum zaposlenja', 'start date', 'hire date', 'pocetak rada', 'datum pocetka rada', 'zaposlen od'],
    hint: 'YYYY-MM-DD or DD.MM.YYYY',
    example: '2024-03-01',
  },
  {
    key: 'employmentType',
    label: 'Employment type',
    required: false,
    aliases: ['vrsta ugovora', 'contract type', 'tip ugovora', 'vrsta zaposlenja', 'ugovor'],
    hint: 'Permanent, Fixed term, Contractor or Student; empty means Permanent',
    example: 'Permanent',
  },
  { key: 'weeklyHours', label: 'Weekly hours', required: false, aliases: ['sati nedeljno', 'hours', 'sati', 'radni sati', 'hours per week'], hint: '1 to 60; empty means the workspace default', example: '40' },
  { key: 'workPhone', label: 'Work phone', required: false, aliases: ['telefon', 'phone', 'poslovni telefon', 'sluzbeni telefon'], example: '+381 11 000 0000' },
  { key: 'workLocation', label: 'Work location', required: false, aliases: ['lokacija', 'location', 'office', 'kancelarija', 'mesto rada'], example: 'Belgrade HQ' },
  { key: 'dateOfBirth', label: 'Date of birth', required: false, aliases: ['datum rodjenja', 'birth date', 'birthday', 'dob'], example: '' },
  { key: 'addressStreet', label: 'Address', required: false, aliases: ['adresa', 'street', 'ulica', 'ulica i broj', 'address street'], example: '' },
  { key: 'addressPostalCode', label: 'Postal code', required: false, aliases: ['postanski broj', 'zip', 'zip code', 'postcode'], example: '' },
  { key: 'addressCity', label: 'City', required: false, aliases: ['grad', 'mesto', 'town'], example: '' },
  { key: 'privateEmail', label: 'Private email', required: false, aliases: ['privatni email', 'privatni e-mail', 'personal email', 'licni email'], example: '' },
  { key: 'privatePhone', label: 'Private phone', required: false, aliases: ['mobilni', 'mobile', 'privatni telefon', 'licni telefon', 'mobilni telefon'], example: '' },
  {
    key: 'iban',
    label: 'IBAN',
    required: false,
    aliases: ['racun', 'tekuci racun', 'bank account', 'broj racuna', 'account number', 'ziro racun'],
    hint: 'IBAN or Serbian account number (260-0056010016113-79)',
    example: '',
  },
  { key: 'bankName', label: 'Bank name', required: false, aliases: ['banka', 'bank', 'naziv banke'], example: '' },
];

export const EMPLOYEE_FIELD_LABELS: Record<string, string> = Object.fromEntries(EMPLOYEE_IMPORT_FIELDS.map((f) => [f.key, f.label]));

/**
 * Employment type from English labels and keys and the Serbian contract names (spec 8.4):
 * "neodređeno" → permanent, "određeno" → fixed term, "ugovor o delu" → contractor, "student" or
 * intern → student. Null when nothing matches.
 */
export function parseEmploymentType(raw: string): EmploymentType | null {
  const v = normalizeHeader(raw);
  if (!v) return null;
  const has = (...parts: string[]) => parts.some((p) => v.includes(p));
  // "neodređeno" contains "određeno", so permanent is checked first.
  if (has('permanent', 'neodredjen', 'neodreden', 'stalni', 'indefinite')) return 'permanent';
  if (has('contractor', 'ugovorodelu', 'ugovorodjelu', 'privremeniipovremeni', 'honorar', 'freelanc', 'autorski')) return 'contractor';
  if (has('fixed', 'odredjen', 'odreden', 'temporary')) return 'fixed_term';
  if (has('student', 'intern', 'praksa', 'praktikant', 'pripravn', 'trainee')) return 'student';
  return null;
}

/**
 * "Ana Marija Petrović" → first "Ana Marija", last "Petrović" (spec 8.4: split at the last space).
 * Null for one word (or nothing).
 */
export function splitFullName(raw: string): { firstName: string; lastName: string } | null {
  const v = raw.trim().replace(/\s+/g, ' ');
  const at = v.lastIndexOf(' ');
  if (at <= 0) return null;
  return { firstName: v.slice(0, at), lastName: v.slice(at + 1) };
}

/** Excel's day 0 is 30 Dec 1899 in the 1900 date system (with its 1900 leap-year bug folded in). */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * A date cell as YYYY-MM-DD: `YYYY-MM-DD`, `DD.MM.YYYY` (with or without the final dot, one-digit
 * day and month too), or an Excel date number (a cell Excel saved as a number, e.g.
 * 45366, between 1950 and 2100). Anything else is returned as typed, for the validation to reject.
 */
export function parseImportDate(raw: string): string {
  const v = raw.trim();
  if (/^\d{4,6}(\.0+)?$/.test(v)) {
    const serial = Number(v);
    if (serial >= 18264 && serial <= 73415) return new Date(EXCEL_EPOCH + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
  }
  // A date with a time (Excel's "2024-03-01 00:00:00", ISO "2024-03-01T00:00:00Z"): the day.
  const withTime = /^(\d{4}-\d{2}-\d{2})[ T]\d{1,2}:\d{2}/.exec(v);
  if (withTime) return withTime[1]!;
  return normalizeDate(v);
}

/** "40", "37,5", "37.5" → a number; null when it isn't one. */
export function parseHours(raw: string): number | null {
  const v = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return Number(v);
}
