// Lost deals (CD-60): mark a deal lost with a reason, it leaves the pipeline board (and shows
// again with the "Include lost deals" view), the timeline says why, and it can be reopened.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, createDealInUi, eventually, newUserWithWorkspace, setValue, steps, text, useBrowser } from '../lib/harness.mjs';

/** Picks an option in the Pipeline filter bar's select that offers `option`. */
const pickView = (page, option) =>
  page.evaluate((option) => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === option));
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, option);

const boardCards = (page) => page.$$eval('[draggable]', (els) => els.map((el) => ({ text: el.innerText, lost: el.hasAttribute('data-lost') })));

describe('lost deals', () => {
  const browser = useBrowser();
  const step = steps(browser, 'lost-deals');
  let page;
  let dealId;

  step('sets up a workspace with two deals', async () => {
    page = await browser.person('lou');
    await newUserWithWorkspace(page, { label: 'lost', name: 'Lou Tester', workspace: 'Lost Co' });
    dealId = await createDealInUi(page, { company: 'Gone Away d.o.o.', contact: 'Gina Gone' });
    // The second deal through the API (the New deal dialog offers existing companies first).
    const funnels = await api(page, '/crm/funnels');
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Keeper Ltd' }) });
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Keeper Ltd', funnelId: funnels[0].id, companyId: company.id }) });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=mark-lost]');
  });

  step('marks the deal as lost with a reason and a note', async () => {
    await page.click('[data-testid=mark-lost]');
    await page.waitForSelector('.modal select');
    // The reason is required.
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => document.body.innerText.includes('Pick the reason the deal was lost.'));
    await setValue(page, '.modal select', 'Chose a competitor');
    await page.type('.modal textarea', 'Picked a bigger agency');
    await click(page, '.modal-actions .btn-primary');
    await page.waitForFunction(() => !document.querySelector('.modal'));

    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return d.outcome === 'lost' && d;
    });
    assert.ok(deal, 'the deal is lost in the API');
    assert.equal(deal.lostReason, 'Chose a competitor');
    assert.equal(deal.lostNote, 'Picked a bigger agency');
  });

  step('the deal shows its lost state and the reason is on the timeline', async () => {
    await page.waitForSelector('[data-testid=lost-state]');
    const state = await page.$eval('[data-testid=lost-state]', (el) => el.innerText);
    assert.match(state, /Lost · Chose a competitor/);
    assert.match(state, /Picked a bigger agency/);
    await page.waitForFunction(() => document.body.innerText.includes('Marked as lost: Chose a competitor'));
    assert.equal(await page.$('[data-testid=mark-lost]'), null, 'no "Lost" button on a lost deal');
    // Still there after a reload.
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=lost-state]');
  });

  step('the pipeline board hides it by default', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Keeper Ltd'));
    const cards = await boardCards(page);
    assert.ok(!cards.some((c) => c.text.includes('Gone Away')), 'lost deal hidden');
    assert.match(await text(page), /1 lost hidden/);
  });

  step('shows it with the "Include lost deals" view, marked as lost', async () => {
    assert.ok(await pickView(page, 'Include lost deals'), 'lost view chip found');
    await page.waitForFunction(() => document.body.innerText.includes('Gone Away'));
    const lost = (await boardCards(page)).find((c) => c.text.includes('Gone Away'));
    assert.ok(lost.lost, 'the card is marked as lost');
    assert.match(lost.text, /Lost · Chose a competitor/);
    assert.ok((await boardCards(page)).some((c) => c.text.includes('Keeper Ltd')), 'open deals still shown');

    assert.ok(await pickView(page, 'Lost deals only'));
    await page.waitForFunction(() => !document.body.innerText.includes('Keeper Ltd'));
    assert.ok((await boardCards(page)).some((c) => c.text.includes('Gone Away')));
  });

  step('reopens the deal', async () => {
    await page.goto(BASE_URL + '/deals/' + dealId, { waitUntil: 'networkidle0' });
    await clickButton(page, 'Reopen');
    await page.waitForSelector('[data-testid=mark-lost]');
    const deal = await eventually(async () => {
      const d = await api(page, '/crm/deals/' + dealId);
      return d.outcome === 'open' && d;
    });
    assert.ok(deal, 'the deal is open again in the API');
    assert.equal(deal.lostReason, null);
    await page.waitForFunction(() => document.body.innerText.includes('Reopened'));

    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    assert.ok(await pickView(page, 'Open & won deals'));
    await page.waitForFunction(() => [...document.querySelectorAll('[draggable]')].some((el) => el.innerText.includes('Gone Away')));
    const history = await api(page, '/crm/deal-stage-history?dealId=' + dealId);
    assert.deepEqual(
      history.map((h) => h.kind),
      ['created', 'lost', 'reopened'],
    );
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
