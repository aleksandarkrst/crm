// Employee import (CD-141): a WBM-like Excel workbook (generated here with write-excel-file) with an
// instructions sheet first, Serbian headers, Excel date cells, an employee number with leading
// zeros, a department merged over two rows, teams, and managers listed after their reports. It is
// uploaded through "Import" on the Org structure page, the sheet is chosen, the columns are matched,
// the preview shows the counts and the new departments and teams, and the import creates everyone
// with the right org structure (checked through the API).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe } from 'node:test';
import writeXlsxFile from 'write-excel-file/node';
import { api, BASE_URL, click, clickButton, newUserWithWorkspace, RUN, setValue, steps, useBrowser } from '../lib/harness.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pultly-e2e-xlsx-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const mail = (who) => `${who}.${RUN}@wbm.test`;
const date = (y, m, d) => ({ value: new Date(Date.UTC(y, m - 1, d)), format: 'dd.mm.yyyy' });
const sales = `Prodaja ${RUN}`;
const office = `Uprava ${RUN}`;

/** The workbook: "Uputstvo" (instructions) first, the employees on "Zaposleni". */
async function workbook() {
  const header = ['Ime', 'Prezime', 'E-mail adresa', 'Broj zaposlenog', 'Radno mesto', 'Sektor', 'Tim', 'Nadređeni', 'Datum zaposlenja', 'Vrsta ugovora'].map((value) => ({ value, fontWeight: 'bold' }));
  const text = (value) => ({ value, type: String, format: '@' });
  const rows = [
    header,
    // Ana and Ivan report to Marko, who comes later; Sektor is merged over Ana's and Ivan's rows.
    ['Ana', 'Petrović', mail('ana'), text('00123'), 'Prodavac', { value: sales, rowSpan: 2 }, 'Teren BG', mail('marko'), date(2024, 3, 1), 'neodređeno'],
    ['Ivan', 'Ilić', mail('ivan'), text('00124'), 'Prodavac', null, 'Teren BG', mail('marko'), date(2023, 9, 15), 'određeno'],
    ['Marko', 'Jović', mail('marko'), text('00125'), 'Direktor prodaje', sales, null, mail('jelena'), date(2020, 1, 15), 'neodređeno'],
    ['Jelena', 'Đorđević', mail('jelena'), text('00126'), 'Direktorka', office, null, null, date(2018, 6, 1), 'ugovor o delu'],
  ];
  const file = join(dir, 'zaposleni.xlsx');
  const buffer = await writeXlsxFile([
    { data: [['Uputstvo'], ['Popunite list „Zaposleni“.']], sheet: 'Uputstvo' },
    { data: rows, sheet: 'Zaposleni' },
  ]).toBuffer();
  writeFileSync(file, buffer);
  return file;
}

describe('Employee import from Excel', () => {
  const browser = useBrowser();
  const step = steps(browser, 'employee-import');
  let page;

  step('sets up a workspace', async () => {
    page = await browser.person('hana');
    await newUserWithWorkspace(page, { label: 'employee-import', name: 'Hana Hr', workspace: 'WBM Import' });
  });

  step('uploads the workbook, picks the sheet, previews and imports', async () => {
    await page.goto(BASE_URL + '/org', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=employee-import]');
    const input = await page.waitForSelector('.modal input[type=file]');
    await input.uploadFile(await workbook());

    // Two sheets: the dialog asks which one (the first is preselected).
    await page.waitForSelector('[data-testid=import-sheet]');
    const sheets = await page.$$eval('[data-testid=import-sheet] option', (els) => els.map((el) => el.textContent));
    assert.deepEqual(sheets, ['Uputstvo', 'Zaposleni']);
    await setValue(page, '[data-testid=import-sheet]', '1');
    await clickButton(page, 'Use this sheet');

    // The Serbian headers were matched to the fields.
    await page.waitForSelector('.modal select[data-field]');
    const mapped = await page.$$eval('.modal select[data-field]', (els) => Object.fromEntries(els.map((el) => [el.dataset.field, el.options[el.selectedIndex].text])));
    assert.equal(mapped.firstName, 'Ime');
    assert.equal(mapped.lastName, 'Prezime');
    assert.equal(mapped.workEmail, 'E-mail adresa');
    assert.equal(mapped.employeeNumber, 'Broj zaposlenog');
    assert.equal(mapped.department, 'Sektor');
    assert.equal(mapped.team, 'Tim');
    assert.equal(mapped.managerEmail, 'Nadređeni');
    assert.equal(mapped.employmentStartDate, 'Datum zaposlenja');
    assert.equal(mapped.employmentType, 'Vrsta ugovora');

    await clickButton(page, 'Preview');
    await page.waitForSelector('[data-testid=import-counts]');
    const counts = await page.$eval('[data-testid=import-counts]', (el) => el.innerText);
    assert.match(counts, /4 rows/);
    assert.match(counts, /4 new/);
    assert.match(counts, /2 new departments/);
    assert.match(counts, /1 new team/);
    assert.doesNotMatch(counts, /errors/);
    const org = await page.$eval('[data-testid=import-new-org]', (el) => el.innerText);
    assert.match(org, new RegExp(`New departments: ${sales}, ${office}`));
    assert.match(org, new RegExp(`New teams: ${sales} / Teren BG`));

    await clickButton(page, 'Import 4 rows');
    await page.waitForSelector('[data-testid=import-summary]');
    const summary = await page.$eval('[data-testid=import-summary]', (el) => el.innerText.replace(/\s+/g, ' '));
    assert.match(summary, /Created 4 Updated 0 Skipped 0 Failed 0/i);
    await clickButton(page, 'Done');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  });

  step('everyone is there with department, team, manager, number and start date', async () => {
    const { employees } = await api(page, '/people/employees');
    const by = (who) => employees.find((e) => e.workEmail === mail(who));
    const [ana, ivan, marko, jelena] = ['ana', 'ivan', 'marko', 'jelena'].map(by);
    for (const e of [ana, ivan, marko, jelena]) assert.ok(e, 'imported');
    assert.equal(ana.departmentName, sales);
    assert.equal(ivan.departmentName, sales, 'the merged department cell counts for both rows');
    assert.equal(ana.teamName, 'Teren BG');
    assert.equal(ivan.teamId, ana.teamId);
    assert.equal(marko.teamId, null);
    assert.equal(jelena.departmentName, office);
    assert.equal(ana.managerId, marko.id);
    assert.equal(ivan.managerId, marko.id);
    assert.equal(marko.managerId, jelena.id);
    assert.equal(jelena.managerId, null);
    assert.equal(ana.employment.employeeNumber, '00123', 'text cells keep their leading zeros');
    assert.equal(ana.employment.startDate, '2024-03-01', 'Excel date cells');
    assert.equal(ivan.employment.startDate, '2023-09-15');
    assert.equal(ana.employment.type, 'permanent');
    assert.equal(ivan.employment.type, 'fixed_term');
    assert.equal(jelena.employment.type, 'contractor');
  });

  step('refuses an old .xls file with a clear message', async () => {
    await page.goto(BASE_URL + '/org', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=employee-import]');
    const input = await page.waitForSelector('.modal input[type=file]');
    const xls = join(dir, 'old.xls');
    const bytes = new Uint8Array(1024);
    bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    writeFileSync(xls, bytes);
    await input.uploadFile(xls);
    await page.waitForFunction(() => document.querySelector('.modal [role=alert]')?.textContent.includes('Save the file as .xlsx or .csv and try again'));
    assert.deepEqual(browser.errors, []);
  });
});
