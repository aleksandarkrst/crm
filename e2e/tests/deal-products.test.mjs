// CD-83: the product dialog on the Products page, the deal's products dialog (tax mode, discounts,
// installments) and the redesigned deal page (header with Won and Lost, stage bar, sections).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, createDealInUi, eventually, newUserWithWorkspace, setValue, steps, text, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('products and the deal page', () => {
  const browser = useBrowser();
  const step = steps(browser, 'deal-products');
  let page;
  let dealId;

  step('adds a recurring product in the product dialog', async () => {
    page = await browser.person('paula');
    await newUserWithWorkspace(page, { label: 'products', name: 'Paula Products', workspace: 'Products Co' });
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    await clickButton(page, 'New product');
    await page.waitForSelector('.modal');
    await page.type('.modal input[placeholder="e.g. Brand identity sprint"]', 'Automation');
    await page.type('.modal textarea', 'Workflow automation seats');
    await page.type('.modal input[placeholder="6500"]', '40');
    await page.type('.modal input[placeholder="e.g. hour"]', 'seat');
    await setValue(page, '.modal input[inputmode=decimal]:not([placeholder])', '2'); // quantity
    await page.waitForFunction(() => document.querySelector('[data-testid=product-price]')?.textContent === '80.00');
    await setValue(page, '.modal select', 'monthly');
    await click(page, '.modal input[type=radio]:not(:checked)');
    await setValue(page, '.modal input[aria-label="Number of billing cycles"]', '4');
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const product = await eventually(async () => (await api(page, '/crm/products')).find((p) => p.name === 'Automation'));
    assert.deepEqual(
      { description: product.description, unit: product.unit, unitPrice: Number(product.unitPrice), quantity: Number(product.quantity), billingFrequency: product.billingFrequency, billingCycles: product.billingCycles },
      { description: 'Workflow automation seats', unit: 'seat', unitPrice: 40, quantity: 2, billingFrequency: 'monthly', billingCycles: 4 },
    );
  });

  step('the list shows the billing, and a row opens the product for editing', async () => {
    await page.waitForFunction(() => document.body.innerText.includes('Monthly (4 cycles)'));
    await click(page, '[data-testid=product-row]');
    await page.waitForSelector('.modal');
    assert.equal(await page.$eval('.modal input[placeholder="e.g. Brand identity sprint"]', (el) => el.value), 'Automation');
    await click(page, '.modal input[type=radio]:not(:checked)'); // "Renew until canceled"
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const renewed = await eventually(async () => (await api(page, '/crm/products')).find((p) => p.name === 'Automation' && p.billingCycles === null));
    assert.ok(renewed, 'renews until canceled');
    await api(page, '/crm/products', { method: 'POST', body: JSON.stringify({ name: 'Setup', unitPrice: 1000, vatRate: 20 }) });
  });

  step('the deal page: name in the header, not in the screen title; no Products tab', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    dealId = await createDealInUi(page, { company: 'Globex', contact: 'Hank Scorpio' });
    await waitForToastToClear(page);
    assert.equal(await page.$eval('[data-testid=deal-title]', (el) => el.value), 'Globex');
    assert.equal(await page.$eval('header h1', (el) => el.textContent), 'Deal');
    assert.match(await page.$eval('[data-testid=deal-crumb]', (el) => el.innerText), /→/);
    assert.ok(await page.$('[data-testid=stage-bar] .stage-chev.current'), 'the stage bar marks the current stage');
    const tabs = await page.$$eval('.composer-tab', (els) => els.map((el) => el.textContent.trim()));
    assert.ok(!tabs.some((t) => t.startsWith('Products')), JSON.stringify(tabs));
    assert.ok(!(await text(page)).includes('Delete deal'), 'Delete deal is in the menu, not on the page');
    assert.ok(await page.$('[data-testid=company-section]'));
  });

  step('one-time products with tax included and a deal discount', async () => {
    await click(page, '[data-testid=open-products]');
    await click(page, '[data-testid=add-line]');
    await page.waitForSelector('[data-testid=deal-line]');
    // The first product of the catalog (by name) is Automation; pick Setup.
    const setupId = (await api(page, '/crm/products')).find((p) => p.name === 'Setup').id;
    await setValue(page, '.modal select[aria-label=Product]', setupId);
    await page.$$eval('.modal select', (els) => {
      const mode = els.find((el) => [...el.options].some((o) => o.value === 'inclusive'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(mode, 'inclusive');
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await clickButton(page, '+ Add discount');
    await setValue(page, '.modal input[aria-label="Discount value"]', '10');
    // 1,000 incl. 20% tax, less 10%: 900 with tax, 750 without.
    await page.waitForFunction(() => document.querySelector('[data-testid=summary-total]')?.textContent.includes('900.00'));
    assert.match(await page.$eval('[data-testid=summary-subtotal]', (el) => el.textContent), /750\.00/);
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return Number(d.amount) === 750 && d;
    });
    assert.equal(deal.taxMode, 'inclusive');
    assert.equal(deal.discounts.length, 1);
  });

  step('installments that don\'t add up get a warning; saved ones show on the deal', async () => {
    await waitForToastToClear(page);
    await click(page, '[data-testid=open-products]');
    await clickButton(page, 'Installments (0)');
    await clickButton(page, '+ Installment');
    await page.waitForSelector('[data-testid=installment]');
    await setValue(page, '.modal input[aria-label="Installment amount"]', '400');
    await setValue(page, '.modal input[aria-label="Billing date"]', '2027-01-15');
    await page.waitForSelector('[data-testid=installments-mismatch]');
    await clickButton(page, '+ Installment');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=installment]').length === 2);
    await page.$$eval('.modal input[aria-label="Billing date"]', (els) => {
      const el = els[1];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2027-02-15');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // The second one takes what is left (500), so the warning goes away.
    await page.waitForFunction(() => !document.querySelector('[data-testid=installments-mismatch]'));
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return d.installments.length === 2 && d;
    });
    assert.deepEqual(
      deal.installments.map((i) => [i.date, i.amount]),
      [
        ['2027-01-15', 400],
        ['2027-02-15', 500],
      ],
    );
    await page.waitForSelector('[data-testid=deal-installments]');
    assert.match(await page.$eval('[data-testid=deal-installments]', (el) => el.innerText), /2[\s\S]*900\.00/);
  });

  step('a recurring product next to installments is refused', async () => {
    await waitForToastToClear(page);
    await click(page, '[data-testid=open-products]');
    await clickButton(page, 'Products (1)'); // it opens on the installments
    await click(page, '[data-testid=add-line]'); // Automation, monthly
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=deal-line]').length === 2);
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => document.querySelector('.modal [role=alert]')?.textContent.includes('one-time products only'));
    await clickButton(page, 'Cancel');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    assert.equal((await api(page, '/crm/deal-lines')).filter((l) => l.dealId === dealId).length, 1);
  });

  step('Won moves the deal to the won stage', async () => {
    await click(page, '[data-testid=mark-won]');
    await page.waitForSelector('[data-testid=won-state]');
    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return d.outcome === 'won' && d;
    });
    assert.ok(deal, 'won in the API');
  });

  step('the owner deletes the deal from the header menu', async () => {
    await click(page, 'button[aria-label="More actions"]');
    await clickButton(page, 'Delete deal');
    await page.waitForFunction(() => location.pathname.startsWith('/pipeline'));
    const gone = await eventually(async () => !(await api(page, '/crm/deals')).some((d) => d.deal.id === dealId));
    assert.ok(gone, 'deal deleted');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
