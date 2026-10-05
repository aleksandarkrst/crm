import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/shared/import/csv';
import { guessMappingOf, normalizeHeader, prepareImport } from '../src/shared/import/import-file';
import { EMPLOYEE_IMPORT_FIELDS, parseEmploymentType, parseHours, parseImportDate, splitFullName } from '../src/modules/people/employee-import-fields';
import { type ExistingEmployee, type ImportLookups, planImport } from '../src/modules/people/employee-import-plan';
import { templateCsv } from '../src/modules/people/employee-import.service';

/** Employee import (CD-141): header aliases, value parsers and the plan (spec 8.4–8.6), without a database. */

const mappingOf = (headers: string[]) => {
  const m = guessMappingOf(EMPLOYEE_IMPORT_FIELDS, headers);
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null).map(([k, v]) => [k, headers[v!]]));
};

describe('header mapping', () => {
  it("maps WBM's Serbian headers without changes", () => {
    const headers = ['Ime', 'Prezime', 'E-mail adresa', 'Broj zaposlenog', 'Radno mesto', 'Sektor', 'Tim', 'Nadređeni', 'Datum zaposlenja', 'Vrsta ugovora', 'Sati nedeljno', 'Telefon', 'Lokacija', 'Datum rođenja', 'Adresa', 'Poštanski broj', 'Grad', 'Privatni email', 'Mobilni', 'Tekući račun', 'Banka'];
    expect(mappingOf(headers)).toEqual({
      firstName: 'Ime',
      lastName: 'Prezime',
      workEmail: 'E-mail adresa',
      employeeNumber: 'Broj zaposlenog',
      jobTitle: 'Radno mesto',
      department: 'Sektor',
      team: 'Tim',
      managerEmail: 'Nadređeni',
      employmentStartDate: 'Datum zaposlenja',
      employmentType: 'Vrsta ugovora',
      weeklyHours: 'Sati nedeljno',
      workPhone: 'Telefon',
      workLocation: 'Lokacija',
      dateOfBirth: 'Datum rođenja',
      addressStreet: 'Adresa',
      addressPostalCode: 'Poštanski broj',
      addressCity: 'Grad',
      privateEmail: 'Privatni email',
      privatePhone: 'Mobilni',
      iban: 'Tekući račun',
      bankName: 'Banka',
    });
  });

  it('maps English labels, keys and aliases, ignoring case, accents and punctuation', () => {
    expect(mappingOf(['FULL NAME', 'work-email', 'Reports to', 'hire date', 'Contract type', 'Department name', 'group'])).toEqual({
      fullName: 'FULL NAME',
      workEmail: 'work-email',
      managerEmail: 'Reports to',
      employmentStartDate: 'hire date',
      employmentType: 'Contract type',
      department: 'Department name',
      team: 'group',
    });
    expect(mappingOf(['Ime i prezime', 'Rukovodilac', 'Odeljenje', 'Grupa', 'Pozicija'])).toEqual({ fullName: 'Ime i prezime', managerEmail: 'Rukovodilac', department: 'Odeljenje', team: 'Grupa', jobTitle: 'Pozicija' });
    expect(normalizeHeader('Datum rođenja')).toBe(normalizeHeader('datum-rodjenja'));
    expect(normalizeHeader('Poštanski broj')).toBe('postanskibroj');
  });

  it('needs first and last name, or a full name', () => {
    const fields = EMPLOYEE_IMPORT_FIELDS;
    expect(prepareImport(fields, 'employees', 'Ime,Prezime\nAna,Petrović\n', undefined).missingRequired).toEqual([]);
    expect(prepareImport(fields, 'employees', 'Ime i prezime\nAna Petrović\n', undefined).missingRequired).toEqual([]);
    expect(prepareImport(fields, 'employees', 'Ime,Email\nAna,a@x.rs\n', undefined).missingRequired).toEqual(['Last name (or Full name)']);
  });

  it('serves a template with the labels (no Full name) and an example row', () => {
    const csv = templateCsv();
    expect(csv.startsWith('﻿')).toBe(true);
    const [header, example] = parseCsv(csv).headers.length ? [parseCsv(csv).headers, parseCsv(csv).rows[0]!.cells] : [[], []];
    expect(header.slice(0, 4)).toEqual(['First name', 'Last name', 'Work email', 'Employee number']);
    expect(header).not.toContain('Full name');
    expect(example[header.indexOf('Employee number')]).toBe('00123');
  });
});

describe('values', () => {
  it('reads employment types in English and Serbian', () => {
    const cases: [string, string | null][] = [
      ['Permanent', 'permanent'],
      ['neodređeno', 'permanent'],
      ['Na neodređeno vreme', 'permanent'],
      ['NEODREDJENO', 'permanent'],
      ['određeno', 'fixed_term'],
      ['Ugovor na određeno', 'fixed_term'],
      ['Fixed term', 'fixed_term'],
      ['fixed_term', 'fixed_term'],
      ['ugovor o delu', 'contractor'],
      ['Contractor', 'contractor'],
      ['student', 'student'],
      ['Student or intern', 'student'],
      ['Intern', 'student'],
      ['pripravnik', 'student'],
      ['part time', null],
      ['', null],
    ];
    for (const [raw, type] of cases) expect(parseEmploymentType(raw), raw).toBe(type);
  });

  it('reads dates as ISO, DD.MM.YYYY with or without the last dot, and Excel date numbers', () => {
    expect(parseImportDate('2024-03-01')).toBe('2024-03-01');
    expect(parseImportDate('01.03.2024')).toBe('2024-03-01');
    expect(parseImportDate('1.3.2024.')).toBe('2024-03-01');
    expect(parseImportDate('15. 3. 2023.')).toBe('2023-03-15');
    expect(parseImportDate('45352')).toBe('2024-03-01');
    expect(parseImportDate('45000')).toBe('2023-03-15');
    expect(parseImportDate('2024-03-01 00:00:00')).toBe('2024-03-01');
    // Not dates: returned as typed for the check to name.
    expect(parseImportDate('March 2024')).toBe('March 2024');
    expect(parseImportDate('2024')).toBe('2024');
  });

  it('splits a full name at the last space', () => {
    expect(splitFullName('Ana Petrović')).toEqual({ firstName: 'Ana', lastName: 'Petrović' });
    expect(splitFullName('  Ana  Marija   Petrović ')).toEqual({ firstName: 'Ana Marija', lastName: 'Petrović' });
    expect(splitFullName('Ana')).toBeNull();
    expect(splitFullName('')).toBeNull();
  });

  it('reads weekly hours with a decimal comma', () => {
    expect(parseHours('40')).toBe(40);
    expect(parseHours('37,5')).toBe(37.5);
    expect(parseHours('abc')).toBeNull();
  });
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const existing = (n: number, over: Partial<ExistingEmployee> = {}): ExistingEmployee => ({
  id: id(n),
  fullName: `Existing ${n}`,
  workEmail: `e${n}@wbm.rs`,
  employeeNumber: null,
  managerId: null,
  departmentId: null,
  teamId: null,
  employmentStartDate: '2020-01-01',
  deactivatedAt: null,
  ...over,
});
const lookups = (over: Partial<ImportLookups> = {}): ImportLookups => ({ employees: [], departments: [], teams: [], defaultWeeklyHours: 40, numberRequired: false, ...over });

/** Plans a CSV (header on line 1) and returns the rows by line. */
function plan(csv: string, lk: ImportLookups = lookups(), duplicates: 'skip' | 'update' = 'skip') {
  const prep = prepareImport(EMPLOYEE_IMPORT_FIELDS, 'employees', csv, undefined);
  const result = planImport(prep.rows, prep.mapping, duplicates, lk);
  return { ...result, at: (line: number) => result.rows.find((r) => r.line === line)! };
}

const HEADER = 'Ime,Prezime,Email,Nadređeni,Sektor,Tim,Datum zaposlenja';

describe('the plan', () => {
  it('creates departments and teams once, and resolves managers listed after their reports', () => {
    const p = plan(
      [
        HEADER,
        'Ana,Petrović,ana@wbm.rs,marko@wbm.rs,Prodaja,Teren BG,01.03.2024',
        'Ivan,Ilić,ivan@wbm.rs,marko@wbm.rs,prodaja,teren bg,2024-03-01',
        'Marko,Jović,marko@wbm.rs,,Prodaja,,45352',
      ].join('\n'),
    );
    expect(p.rows.map((r) => r.status)).toEqual(['create', 'create', 'create']);
    expect(p.newDepartments).toEqual(['Prodaja']);
    expect(p.newTeams).toEqual([{ department: 'Prodaja', name: 'Teren BG' }]);
    expect(p.at(2).manager).toMatchObject({ kind: 'row' });
    expect(p.at(2).manager?.kind === 'row' && p.at(2).manager.row.line).toBe(4);
    expect(p.at(4).work).toMatchObject({ firstName: 'Marko', employmentStartDate: '2024-03-01', weeklyHours: 40, workEmail: 'marko@wbm.rs' });
  });

  it('reports every error type with its line and field', () => {
    const lk = lookups({ employees: [existing(1, { employeeNumber: '007' }), existing(2, { workEmail: 'gone@wbm.rs', deactivatedAt: new Date() })] });
    const p = plan(
      [
        'Ime,Prezime,Ime i prezime,Email,Broj zaposlenog,Nadređeni,Sektor,Tim,Datum zaposlenja,Vrsta ugovora,Sati nedeljno,IBAN',
        ',,Ana,a1@wbm.rs,,,,,,,,', // 2: one-word full name
        'Ana,,,a2@wbm.rs,,,,,,,,', // 3: no last name
        'Ana,P,,not-an-email,,,,,,,,', // 4: email
        'Ana,P,,a5@wbm.rs,,,,,32.13.2024,,,', // 5: date
        'Ana,P,,a6@wbm.rs,,,,,,sezonski,,', // 6: type
        'Ana,P,,a7@wbm.rs,,,,,,,80,', // 7: hours
        'Ana,P,,a8@wbm.rs,,,,,,,,RS35260005601001611378', // 8: IBAN
        'Ana,P,,a8@wbm.rs,,,,,,,,', // 9: same email as line 8
        'Ana,P,,a10@wbm.rs,007,,,,,,,', // 10: number used
        'Ana,P,,a11@wbm.rs,,,,Tim bez sektora,,,,', // 11: team without department
        'Ana,P,,a12@wbm.rs,,nobody@wbm.rs,,,,,,', // 12: manager not found
        'Ana,P,,a13@wbm.rs,,a13@wbm.rs,,,,,,', // 13: own manager
        'Ana,P,,a14@wbm.rs,,gone@wbm.rs,,,,,,', // 14: manager left
        'Ana,P,,a15@wbm.rs,X1,,,,,,,', // 15
        'Ana,P,,a16@wbm.rs,X1,,,,,,,', // 16: same number as line 15
      ].join('\n'),
      lk,
    );
    const errors = (line: number) => p.at(line).messages.join(' | ');
    expect(p.at(2).status).toBe('invalid');
    expect(errors(2)).toBe('Full name: "Ana" needs a first and a last name');
    expect(errors(3)).toBe('Last name is required');
    expect(errors(4)).toBe('Work email: Not a valid email address');
    expect(errors(5)).toBe('Employment start date: "32.13.2024" is not a date (use YYYY-MM-DD or DD.MM.YYYY)');
    expect(errors(6)).toBe('Employment type: "sezonski" is not Permanent, Fixed term, Contractor or Student');
    expect(errors(7)).toBe('Weekly hours: 80 is not between 1 and 60');
    expect(errors(8)).toBe('IBAN: not a valid IBAN or Serbian account number');
    expect(errors(9)).toBe('Same email as line 8');
    expect(errors(10)).toBe('Employee number: 007 is already used by Existing 1');
    expect(errors(11)).toBe('Team: "Tim bez sektora" needs a department in the same row');
    expect(errors(12)).toBe('Manager not found: nobody@wbm.rs');
    expect(errors(13)).toBe("Manager email: an employee can't be their own manager");
    expect(errors(14)).toBe('Manager has left the company');
    expect(p.at(15).status).toBe('create');
    expect(errors(16)).toBe('Same employee number as line 15');
  });

  it('warns about a missing start date, a missing email and a converted account number', () => {
    const p = plan(['Ime,Prezime,Email,Račun', 'Ana,Petrović,,260-0056010016113-79'].join('\n'));
    expect(p.at(2).status).toBe('create');
    expect(p.at(2).warnings).toEqual(['Employment start date missing', 'No work email: cannot be invited or matched later', 'IBAN converted from the account number: RS35 2600 0560 1001 6113 79']);
  });

  it('refuses loops inside the file, naming every line of the loop', () => {
    const p = plan([HEADER, 'A,One,a@wbm.rs,b@wbm.rs,,,', 'B,Two,b@wbm.rs,c@wbm.rs,,,', 'C,Three,c@wbm.rs,a@wbm.rs,,,', 'D,Four,d@wbm.rs,a@wbm.rs,,,'].join('\n'));
    expect(p.at(2).messages).toEqual(['Reporting loop: lines 2 → 3 → 4 → 2']);
    expect(p.at(3).messages).toEqual(['Reporting loop: lines 3 → 4 → 2 → 3']);
    expect(p.at(4).messages).toEqual(['Reporting loop: lines 4 → 2 → 3 → 4']);
    // D's manager (line 2) isn't imported, so D comes in without a manager.
    expect(p.at(5).status).toBe('create');
    expect(p.at(5).warnings).toContain("Imported without manager: the manager's row (line 2) has errors");
  });

  it('refuses loops together with existing employees (update)', () => {
    // Existing: Marko (1) reports to Ana (2). The file makes Ana report to Marko.
    const lk = lookups({ employees: [existing(1, { fullName: 'Marko Ilić', workEmail: 'marko@wbm.rs', managerId: id(2) }), existing(2, { fullName: 'Ana Petrović', workEmail: 'ana@wbm.rs' })] });
    const p = plan([HEADER, 'Ana,Petrović,ana@wbm.rs,marko@wbm.rs,,,'].join('\n'), lk, 'update');
    expect(p.at(2).status).toBe('invalid');
    expect(p.at(2).messages).toEqual(['Reporting loop: line 2 → Marko Ilić → line 2']);
    // With Skip, the row changes nothing, so there is no loop.
    expect(plan([HEADER, 'Ana,Petrović,ana@wbm.rs,marko@wbm.rs,,,'].join('\n'), lk, 'skip').at(2).status).toBe('skip');
  });

  it('checks again after taking a looping row out', () => {
    // Existing: R reports to P. The file: R → Q, Q → R (a loop), and P → R. Without the loop rows
    // R reports to P again, and P → R would close a new loop.
    const lk = lookups({
      employees: [existing(1, { fullName: 'R', workEmail: 'r@wbm.rs', managerId: id(3) }), existing(2, { fullName: 'Q', workEmail: 'q@wbm.rs' }), existing(3, { fullName: 'P', workEmail: 'p@wbm.rs' })],
    });
    const p = plan([HEADER, 'R,R,r@wbm.rs,q@wbm.rs,,,', 'Q,Q,q@wbm.rs,r@wbm.rs,,,', 'P,P,p@wbm.rs,r@wbm.rs,,,'].join('\n'), lk, 'update');
    expect(p.rows.map((r) => r.status)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(p.at(4).messages).toEqual(['Reporting loop: line 4 → R → line 4']);
  });

  it('Skip leaves duplicates alone; Update sets only non-empty cells and never reactivates', () => {
    const lk = lookups({ employees: [existing(1, { workEmail: 'ana@wbm.rs', fullName: 'Ana Petrović', deactivatedAt: new Date() })] });
    const csv = ['Ime,Prezime,Email,Radno mesto,Telefon', 'Ana,Petrović,ANA@wbm.rs,Direktor,'].join('\n');
    const skip = plan(csv, lk, 'skip').at(2);
    expect(skip.status).toBe('skip');
    expect(skip.messages).toEqual(['An employee with the email ana@wbm.rs already exists']);
    const update = plan(csv, lk, 'update').at(2);
    expect(update.status).toBe('update');
    expect(update.id).toBe(id(1));
    expect(update.work).toEqual({ firstName: 'Ana', lastName: 'Petrović', jobTitle: 'Direktor' });
    expect(update.notes).toContain('Inactive: not reactivated');
  });

  it('requires the employee number when the workspace does', () => {
    const p = plan(['Ime,Prezime,Broj zaposlenog', 'Ana,P,', 'Ivan,I,0042'].join('\n'), lookups({ numberRequired: true }));
    expect(p.at(2).messages).toEqual(['Employee number is required in this workspace']);
    expect(p.at(3).status).toBe('create');
    expect(p.at(3).work.employeeNumber).toBe('0042');
  });
});
