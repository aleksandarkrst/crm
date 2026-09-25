// Currencies (CD-77): products have a currency, a deal's currency can be changed on the deal
// screen, and a deal only takes products in its own currency.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, createDealInUi, eventually, newUserWithWorkspace, setByLabel, setClosingDate, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('deal and product currency', () => {
  const browser = useBrowser();
  const step = steps(browser, 'currency');
  let page;
  let dealId;

  step('a workspace in EUR with a product in EUR and one in USD, and a deal', async () => {
    page = await browser.person('cora');
    await newUserWithWorkspace(page, { label: 'currency', name: 'Cora Currency', workspace: 'Currency Co' });
    await api(page, '/crm/products', { method: 'POST', body: JSON.stringify({ name: 'Audit EUR', unitPrice: 1000 }) });
    await api(page, '/crm/products', { method: 'POST', body: JSON.stringify({ name: 'Audit USD', unitPrice: 1200, currency: 'USD' }) });
    await page.reload({ waitUntil: 'networkidle0' });
    dealId = await createDealInUi(page, { company: 'Dollar Corp', contact: 'Dora Dollar' });
    await waitForToastToClear(page);
  });

  step('the Products screen lists each product with its currency', async () => {
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    const currencies = await page.$$eval('select[aria-label^="Currency of"]', (els) => els.map((el) => [el.getAttribute('aria-label'), el.value]));
    assert.deepEqual(Object.fromEntries(currencies), { 'Currency of Audit EUR': 'EUR', 'Currency of Audit USD': 'USD' });
  });

  step("changes the deal's currency to USD on the deal screen", async () => {
    await page.goto(`${BASE_URL}/deals/${dealId}`, { waitUntil: 'networkidle0' });
    await setClosingDate(page, '2026-12-15');
    await eventually(async () => (await api(page, '/crm/deals/' + dealId)).closeDate === '2026-12-15');
    assert.ok(await setByLabel(page, 'Currency', 'USD', 'select'), 'Currency field found');
    const saved = await eventually(async () => (await api(page, '/crm/deals/' + dealId)).currency === 'USD');
    assert.ok(saved, 'deal currency saved');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Deal value'));
    const value = await page.evaluate(() => {
      const span = [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === 'Currency');
      return span?.parentElement?.querySelector('select')?.value;
    });
    assert.equal(value, 'USD');
  });

  step('a new line takes the product priced in USD', async () => {
    await waitForToastToClear(page);
    await clickButton(page, 'Products');
    await clickButton(page, 'Add line');
    const line = await eventually(async () => (await api(page, '/crm/deal-lines')).find((l) => l.dealId === dealId));
    const products = await api(page, '/crm/products');
    assert.equal(products.find((p) => p.id === line.productId).name, 'Audit USD');
    // The EUR product can't be picked for this deal.
    const disabled = await page.$$eval('option', (els) => els.filter((o) => o.textContent.includes('Audit EUR')).map((o) => o.disabled));
    assert.deepEqual(disabled, [true]);
  });

  step('changing the currency back is refused while the line is in USD', async () => {
    await waitForToastToClear(page);
    assert.ok(await setByLabel(page, 'Currency', 'EUR', 'select'));
    await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes("Can't change the currency to EUR"));
    assert.match(await text(page), /Audit USD \(USD\)/);
    assert.equal((await api(page, '/crm/deals/' + dealId)).currency, 'USD');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
