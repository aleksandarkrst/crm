// Deal lines and stage to-dos: edits in the UI reach the API and come back after a reload.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  api,
  BASE_URL,
  click,
  clickButton,
  createDealInUi,
  eventually,
  newUserWithWorkspace,
  setByLabel,
  setClosingDate,
  steps,
  text,
  useBrowser,
  waitForToastToClear,
} from '../lib/harness.mjs';

describe('deal lines and stage to-dos', () => {
  const browser = useBrowser();
  const step = steps(browser, 'deal-work');
  let page;
  let dealId;

  /** The to-do row (the element holding its "Mark done" button) for a to-do label. */
  const todoRow = (label) =>
    page.evaluateHandle((label) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
      let row = btn;
      while (row && !row.querySelector('button[title="Mark done"]')) row = row.parentElement;
      return row;
    }, label);

  step('sets up a workspace with a product and a deal', async () => {
    page = await browser.person('lina');
    await newUserWithWorkspace(page, { label: 'lines', name: 'Lina Tester', workspace: 'Lines Co' });
    await api(page, '/crm/products', { method: 'POST', body: JSON.stringify({ name: 'Website', unitPrice: 5000, vatRate: 20 }) });
    await page.reload({ waitUntil: 'networkidle0' });
    dealId = await createDealInUi(page, { company: 'Initech', contact: 'Bill Lumbergh' });
    await waitForToastToClear(page);
  });

  step('adds a deal line and saves quantity and payment schedule', async () => {
    // A closing date enables "Add line".
    await setClosingDate(page, '2026-12-15');
    await eventually(async () => (await api(page, '/crm/deals/' + dealId)).closeDate === '2026-12-15');
    await clickButton(page, 'Products');
    await clickButton(page, 'Add line');
    await page.waitForFunction(() => document.body.innerText.includes('1 line'));
    assert.ok(await setByLabel(page, 'Qty', '3'), 'Qty field found');
    assert.ok(await setByLabel(page, 'Payment schedule', 'Custom milestones', 'select'), 'Payment schedule field found');

    const line = await eventually(async () => {
      const lines = await api(page, '/crm/deal-lines');
      return lines.length === 1 && Number(lines[0].quantity) === 3 && lines[0].schedule === 'Custom milestones' && lines[0];
    });
    assert.ok(line, 'line saved with quantity 3 and custom milestones');
    assert.equal(line.dealId, dealId);
  });

  step('the backend recalculates the deal amount', async () => {
    const amount = await eventually(async () => Number((await api(page, '/crm/deals/' + dealId)).amount) === 15000);
    assert.ok(amount, 'amount is 3 × 5000');
  });

  step('ticks, annotates and adds to-dos', async () => {
    await waitForToastToClear(page);
    const socials = await todoRow('Website + socials reviewed');
    await (await socials.$('button[title="Mark done"]')).click();
    await clickButton(page, 'Fit score entered');
    await page.type('textarea[placeholder="One line. This becomes the timeline entry."]', 'Budget confirmed');
    await clickButton(page, '+ Add a to-do for this lead');
    await page.waitForSelector('input[placeholder="Name this to-do"]');
    await page.type('input[placeholder="Name this to-do"]', 'Send NDA');

    const tasks = await eventually(async () => {
      const byLabel = Object.fromEntries((await api(page, '/crm/deal-tasks')).map((t) => [t.label, t]));
      const ready = byLabel['Website + socials reviewed']?.done && byLabel['Fit score entered']?.note === 'Budget confirmed' && byLabel['Send NDA'];
      return ready && byLabel;
    });
    assert.ok(tasks, 'all three to-dos saved');
    assert.equal(tasks['Website + socials reviewed'].doneByName, 'Lina Tester');
    assert.equal(tasks['Fit score entered'].done, false);
    assert.equal(tasks['Send NDA'].offPlaybook, true);
  });

  step('shows lines and to-dos again after a reload', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('by Lina'));
    assert.match(await text(page), /Done/);
    const extra = await page.evaluate(() => [...document.querySelectorAll('input[placeholder="Name this to-do"]')].some((i) => i.value === 'Send NDA'));
    assert.ok(extra, 'off-playbook to-do shown');
    await clickButton(page, 'Products');
    await page.waitForFunction(() => document.body.innerText.includes('1 line · €15,000 net'));
  });

  step('deletes the off-playbook to-do', async () => {
    await click(page, 'button[title="Delete this to-do"]');
    const gone = await eventually(async () => !(await api(page, '/crm/deal-tasks')).some((t) => t.label === 'Send NDA'));
    assert.ok(gone, 'to-do deleted');
  });

  step("won't delete a product that is on a deal", async () => {
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    await waitForToastToClear(page);
    await click(page, 'button[title="Remove"], button[title="Remove line"], .table-row button');
    const toast = await page.waitForSelector('.toast');
    const message = await toast.evaluate((el) => el.textContent);
    assert.match(message, /is on 1 deal/);
    assert.equal((await api(page, '/crm/products')).length, 1);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
