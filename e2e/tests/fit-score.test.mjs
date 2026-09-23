// Scoring CHAMP in the "Fit score entered" to-do saves the fit score, which survives a reload.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, clickButton, createDealInUi, eventually, newUserWithWorkspace, sleep, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('fit score (CHAMP)', () => {
  const browser = useBrowser();
  const step = steps(browser, 'fit-score');
  let page;
  let dealId;

  step('creates a deal', async () => {
    page = await browser.person('champ');
    await newUserWithWorkspace(page, { label: 'champ', workspace: 'Champ Co' });
    dealId = await createDealInUi(page, { company: 'Globex', contact: 'Hank Scorpio' });
    await waitForToastToClear(page);
  });

  step('rates all four CHAMP criteria "Strong" and saves a fit score of 100', async () => {
    await clickButton(page, 'Fit score entered');
    await page.waitForSelector('button::-p-text(Strong)');
    const strong = await page.$$('button::-p-text(Strong)');
    assert.equal(strong.length, 4, 'one "Strong" button per CHAMP criterion');
    for (const button of strong) {
      await button.click();
      await sleep(100);
    }
    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return d.fitScore === 100 && d;
    });
    assert.ok(deal, 'fitScore 100 saved');
    assert.deepEqual(deal.champ, { C: 25, H: 25, M: 25, P: 25 });
  });

  step('shows the fit score after a reload', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Qualified.'));
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
