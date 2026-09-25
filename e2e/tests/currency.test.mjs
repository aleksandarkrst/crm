// Currencies (CD-83): products have no currency; a deal has one, set in its products dialog, and
// any product can go on a deal in any currency (the price is read in the deal's currency). The
// workspace's main currency is picked when it is created.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, createDealInUi, eventually, newUserWithWorkspace, setValue, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('deal currency', () => {
  const browser = useBrowser();
  const step = steps(browser, 'currency');
  let page;
  let dealId;

  step('the owner picks the main currency when creating the workspace', async () => {
    page = await browser.person('cora');
    await newUserWithWorkspace(page, { label: 'currency', name: 'Cora Currency', workspace: 'Currency Co', currency: 'GBP' });
    assert.equal((await api(page, '/workspace')).currency, 'GBP');
  });

  step('a product and a deal', async () => {
    await api(page, '/crm/products', { method: 'POST', body: JSON.stringify({ name: 'Audit', unitPrice: 1000 }) });
    await page.reload({ waitUntil: 'networkidle0' });
    dealId = await createDealInUi(page, { company: 'Dollar Corp', contact: 'Dora Dollar' });
    await waitForToastToClear(page);
  });

  step('the Products screen shows prices without a currency', async () => {
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    const headers = await page.$$eval('.table-head .th', (els) => els.map((el) => el.textContent));
    assert.ok(!headers.includes('Currency'), JSON.stringify(headers));
    assert.match(await text(page), /1,000\.00/);
  });

  step('the products dialog sets the deal currency to USD and adds the product', async () => {
    await page.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=open-products]');
    await page.waitForSelector('.modal');
    await setValue(page, '.modal select', 'USD'); // the first select is the deal currency
    await click(page, '[data-testid=add-line]');
    await page.waitForSelector('[data-testid=deal-line]');
    await page.waitForFunction(() => document.querySelector('[data-testid=summary-subtotal]')?.textContent.includes('US$1,000.00'));
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return d.currency === 'USD' && Number(d.amount) === 1000 && d;
    });
    assert.ok(deal, 'deal saved in USD with the product');
    await page.waitForFunction(() => document.querySelector('[data-testid=deal-value]')?.textContent.includes('US$1,000.00'));
  });

  step('the same product stays when the deal switches to RSD (no currency on products)', async () => {
    await waitForToastToClear(page);
    await click(page, '[data-testid=open-products]');
    await page.waitForSelector('[data-testid=deal-line]');
    await setValue(page, '.modal select', 'RSD');
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return d.currency === 'RSD' && d;
    });
    assert.equal(Number(deal.amount), 1000);
    const lines = (await api(page, '/crm/deal-lines')).filter((l) => l.dealId === dealId);
    assert.equal(lines.length, 1);
    assert.equal(Number(lines[0].unitPrice), 1000);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
