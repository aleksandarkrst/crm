// CSV import (CD-64) and export (CD-65): import companies and deals through the dialog and see
// them in the lists, then export the contacts list and check the downloaded file.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe } from 'node:test';
import { api, BASE_URL, clickButton, eventually, newUserWithWorkspace, RUN, steps, useBrowser } from '../lib/harness.mjs';

const dir = mkdtempSync(join(tmpdir(), 'cadence-e2e-csv-'));
const downloads = join(dir, 'downloads');
after(() => rmSync(dir, { recursive: true, force: true }));

/** Writes a CSV for the file input and returns its path. */
const csvFile = (name, content) => {
  const file = join(dir, name);
  writeFileSync(file, content, 'utf8');
  return file;
};

/** Opens the import dialog on the current screen and uploads `file`; waits for the column step. */
async function upload(page, file) {
  await clickButton(page, 'Import');
  const input = await page.waitForSelector('.modal input[type=file]');
  await input.uploadFile(file);
  await page.waitForSelector('.modal select[data-field]');
}

const modalText = (page) => page.$eval('.modal', (el) => el.innerText);

describe('CSV import and export', () => {
  const browser = useBrowser();
  const step = steps(browser, 'import-export');
  let page;
  const acme = `Acme; "Quoted", Ltd ${RUN}`;
  const globex = `Globex ${RUN}`;

  step('sets up a workspace', async () => {
    page = await browser.person('ivy');
    await newUserWithWorkspace(page, { label: 'import', name: 'Ivy Importer', workspace: 'Import Co' });
  });

  step('imports companies: maps the columns, previews errors, reports the failed row', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    // Semicolon separated, a quoted name with the delimiter and doubled quotes, a row without a name.
    const file = csvFile('companies.csv', `\uFEFFCompany name;Sector;City\r\n"${acme.replace(/"/g, '""')}";Retail;Belgrade\r\n${globex};Energy;Novi Sad\r\n;Nameless;Nowhere\r\n`);
    await upload(page, file);
    // The header names were matched to fields.
    const mapped = await page.$$eval('.modal select[data-field]', (els) => Object.fromEntries(els.map((el) => [el.dataset.field, el.options[el.selectedIndex].text])));
    assert.equal(mapped.name, 'Company name');
    assert.equal(mapped.industry, 'Sector');
    assert.equal(mapped.hq, 'City');

    await clickButton(page, 'Preview');
    await page.waitForSelector('[data-testid=import-counts]');
    const counts = await page.$eval('[data-testid=import-counts]', (el) => el.innerText);
    assert.match(counts, /3 rows/);
    assert.match(counts, /2 new/);
    assert.match(counts, /1 row with errors/);
    assert.match(await modalText(page), /Name is required/);

    await clickButton(page, 'Import 2 rows');
    await page.waitForSelector('[data-testid=import-summary]');
    const summary = await page.$eval('[data-testid=import-summary]', (el) => el.innerText.replace(/\s+/g, ' '));
    assert.match(summary, /Created 2 Updated 0 Skipped 0 Failed 1/i);
    assert.match(await modalText(page), /line 4: Name is required/);
    await clickButton(page, 'Done');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    await page.waitForFunction((names) => names.every((n) => document.body.innerText.includes(n)), {}, [acme, globex]);
  });

  step('imports deals from the Pipeline: company matched or created, stage by name', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    const funnels = await api(page, '/crm/funnels');
    const funnel = funnels[0];
    const second = funnel.stages[1];
    const initech = `Initech ${RUN}`;
    const file = csvFile('deals.csv', `Deal,Company,Stage,Value,Closing date,Contact,Contact email\nWebsite ${RUN},${globex.toUpperCase()},${second.name},"14,000",31.12.2026,Gina Globex,gina-${RUN}@example.test\nRetainer ${RUN},${initech},,2500,,,\n`);
    await upload(page, file);
    // Opened from the Pipeline, the dialog imports deals into the funnel on screen.
    assert.match(await modalText(page), /Import deals/);
    await clickButton(page, 'Preview');
    await page.waitForSelector('[data-testid=import-counts]');
    const counts = await page.$eval('[data-testid=import-counts]', (el) => el.innerText);
    assert.match(counts, /2 new/);
    assert.match(counts, /1 new company/);
    assert.match(counts, /1 new contact/);
    await clickButton(page, 'Import 2 rows');
    await page.waitForSelector('[data-testid=import-summary]');
    assert.match(await page.$eval('[data-testid=import-summary]', (el) => el.innerText.replace(/\s+/g, ' ')), /Created 2 Updated 0 Skipped 0 Failed 0/i);
    await clickButton(page, 'Done');

    // Both deals are on the board (a card shows the company name).
    await page.waitForFunction((names) => names.every((n) => [...document.querySelectorAll('[draggable]')].some((el) => el.innerText.includes(n))), {}, [globex, initech]);
    const deals = await api(page, '/crm/deals');
    const website = deals.find((r) => r.deal.title === `Website ${RUN}`);
    assert.equal(website.companyName, globex, 'matched the existing company, ignoring case');
    assert.equal(website.deal.stageId, second.id);
    assert.equal(website.deal.amount, '14000.00');
    assert.equal(website.deal.closeDate, '2026-12-31');
    assert.equal(website.contactName, 'Gina Globex');
    const retainer = deals.find((r) => r.deal.title === `Retainer ${RUN}`);
    assert.equal(retainer.deal.stageId, funnel.stages[0].id, 'no stage: the first stage');
  });

  step('exports the contacts list as an Excel-friendly CSV', async () => {
    const companies = await api(page, '/crm/companies');
    const globexId = companies.find((c) => c.name === globex).id;
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: '=HYPERLINK("x")', email: `formula-${RUN}@example.test`, jobTitle: 'Head, Growth', companyId: globexId }) });
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('=HYPERLINK'));

    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, browserContextId: page.browserContext().id });
    await clickButton(page, 'Export');
    const name = await eventually(() => existsSync(downloads) && readdirSync(downloads).find((f) => f.endsWith('.csv')), { timeout: 10_000 });
    assert.ok(name, 'a CSV was downloaded');
    assert.match(name, /^cadence-contacts-\d{4}-\d{2}-\d{2}\.csv$/);

    const bytes = readFileSync(join(downloads, name));
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'starts with a UTF-8 BOM');
    const lines = bytes.subarray(3).toString('utf8').split('\r\n');
    assert.equal(lines[0], 'Contact ID,Full name,Job title,Company ID,Company,Email,Phone,LinkedIn,Buyer role,Owner');
    assert.equal(lines.at(-1), '', 'ends with a line break');
    const rows = lines.slice(1, -1);
    assert.equal(rows.length, 2, 'the imported contact and the new one');
    const formula = rows.find((r) => r.includes(`formula-${RUN}@example.test`));
    // Guarded against formula injection, and quoted because of the quotes and the comma.
    assert.ok(formula.includes(`,"'=HYPERLINK(""x"")","Head, Growth",${globexId},${globex},`), formula);
    assert.ok(rows.some((r) => r.includes(`Gina Globex,,${globexId},${globex},gina-${RUN}@example.test`)));
    assert.ok(formula.endsWith(',Influencer,Ivy Importer'), formula);
  });

  step('export follows the filters on screen', async () => {
    rmSync(downloads, { recursive: true, force: true });
    const globexId = (await api(page, '/crm/companies')).find((c) => c.name === globex).id;
    await page.$$eval(
      'select',
      (els, id) => {
        const el = els.find((x) => [...x.options].some((o) => o.value === id));
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, id);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      globexId,
    );
    await page.waitForFunction(() => document.querySelectorAll('.table-row').length === 2);
    await clickButton(page, 'Export');
    const name = await eventually(() => existsSync(downloads) && readdirSync(downloads).find((f) => f.endsWith('.csv')), { timeout: 10_000 });
    const lines = readFileSync(join(downloads, name), 'utf8').split('\r\n').filter(Boolean);
    // The header and the two contacts at Globex; the others are filtered out.
    assert.equal(lines.length, 3, lines.join('\n'));
    assert.ok(lines.every((l, i) => i === 0 || l.includes(globex)), lines.join('\n'));
    assert.equal(browser.errors.length, 0, browser.errors.join('\n'));
  });
});

