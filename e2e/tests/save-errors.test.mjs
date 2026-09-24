// A failed save (CD-19): the change that failed is named and reset to the saved value, and
// other edits still waiting to be saved are kept and saved instead of being thrown away.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, createDealInUi, eventually, newUserWithWorkspace, setByLabel, setValue, sleep, steps, useBrowser } from '../lib/harness.mjs';

describe('failed saves', () => {
  const browser = useBrowser();
  const step = steps(browser, 'save-errors');
  let page;
  let dealId;
  let companyId;
  let failDealPatches = false;

  step('sets up a deal and makes saving the deal fail', async () => {
    page = await browser.person('fiona');
    await newUserWithWorkspace(page, { label: 'fiona', name: 'Fiona Fail', workspace: 'Failing Co' });
    dealId = await createDealInUi(page, { company: 'Sturdy d.o.o.', contact: 'Petar Petrović' });
    companyId = (await api(page, '/crm/deals/' + dealId)).companyId;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.isInterceptResolutionHandled()) return;
      if (failDealPatches && req.method() === 'PATCH' && req.url().endsWith('/api/crm/deals/' + dealId))
        return void req.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Simulated failure' }) });
      void req.continue();
    });
    failDealPatches = true;
  });

  step('a failed title save keeps the HQ typed right after it', async () => {
    await page.waitForSelector('header input.ghost');
    // The title is saved (and fails) while the HQ edit is still waiting out its typing pause.
    await setValue(page, 'header input.ghost', 'Renamed but not saved');
    await sleep(500);
    assert.ok(await setByLabel(page, 'HQ', 'Novi Sad'), 'HQ field found');

    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Not saved'));
    const toast = await page.$eval('.toast', (el) => el.textContent);

    // The HQ reached the database, and the screen still shows it after the reload.
    const saved = await eventually(async () => (await api(page, '/crm/companies/' + companyId)).hq === 'Novi Sad');
    assert.ok(saved, 'HQ saved');
    await sleep(1_000); // let the reload after the failure land
    const hq = await page.evaluate(() => {
      const span = [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === 'HQ');
      return span?.parentElement?.querySelector('input')?.value;
    });
    assert.equal(hq, 'Novi Sad');

    // The failed title is back to what the database has, so the screen doesn't claim it was saved.
    const title = await page.$eval('header input.ghost', (el) => el.value);
    assert.equal(title, (await api(page, '/crm/deals/' + dealId)).title);
    assert.notEqual(title, 'Renamed but not saved');

    // The message names the change that failed, why, and that it was reset.
    assert.match(toast, /Not saved: the deal title/);
    assert.match(toast, /Simulated failure/);
    assert.match(toast, /reset to the saved value/);
  });

  step('edits made after the failure are saved normally', async () => {
    failDealPatches = false;
    await setValue(page, 'header input.ghost', 'Renamed for real');
    const saved = await eventually(async () => (await api(page, '/crm/deals/' + dealId)).title === 'Renamed for real');
    assert.ok(saved, 'title saved once the API accepts it');
    assert.equal(await page.$eval('header input.ghost', (el) => el.value), 'Renamed for real');
  });

  it('throws no uncaught errors in the pages', () => {
    assert.deepEqual(browser.errors, []);
  });
});
