// Open and lifetime value (CD-380): the Pipeline summary counts and totals only open opportunities
// (neither Won nor Lost); a company's Open value is its open deals, its Lifetime value its Won deals.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, newUserWithWorkspace, steps, testPib, useBrowser } from '../lib/harness.mjs';

describe('open and lifetime value', () => {
  const browser = useBrowser();
  const step = steps(browser, 'open-lifetime');
  let page;
  let company;

  step('one company with an open, a Won and a Lost opportunity', async () => {
    page = await browser.person('values');
    await newUserWithWorkspace(page, { label: 'values', name: 'Val Values', workspace: 'Values Co' });
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Simplicity Labs' }) });
    const funnel = (await api(page, '/crm/funnels'))[0];
    const deal = (title, amount) => api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title, funnelId: funnel.id, companyId: company.id, amount }) });
    await deal('Open one', 2500);
    const won = await deal('Won one', 1200);
    await api(page, `/crm/deals/${won.id}/move`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages.find((st) => st.isWon).id }) });
    const lost = await deal('Lost one', 900);
    await api(page, `/crm/deals/${lost.id}/lost`, { method: 'POST', body: JSON.stringify({ reason: 'Price' }) });
  });

  step('the Pipeline summary counts and totals only the open opportunity', async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /1 open opportunity · €2,500/.test(document.body.innerText));
  });

  step('the company: Open value is the open deal, Lifetime value the Won one', async () => {
    await page.goto(`${BASE_URL}/companies/${company.id}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=company-lifetime-value]');
    assert.equal(await page.$eval('[data-testid=company-open-value]', (el) => el.textContent.trim()), '€2,500');
    assert.equal(await page.$eval('[data-testid=company-lifetime-value]', (el) => el.textContent.trim()), '€1,200');

    await page.goto(`${BASE_URL}/companies`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Lifetime value'));
    const row = await page.evaluate(() => [...document.querySelectorAll('.table-row')].find((el) => el.innerText.includes('Simplicity Labs'))?.innerText ?? '');
    assert.match(row, /€2,500\s+€1,200/, row);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
