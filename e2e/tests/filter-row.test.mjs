// The filter row (CD-366) on Today, Companies, Contacts and Products: one combined scenario each
// (Pipeline, Overview and Calendar have theirs in pipeline-views, conversion and meetings), a new
// custom field offered without code, the no-results card, and the row remembered per page.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, email, finishOnboarding, newUserWithWorkspace, READY_IDENTITY, signIn, steps, testPib, useBrowser } from '../lib/harness.mjs';
import { addFilter, chips, chipText, clearFilters, closePopover, offeredFields, openChip, pickOption, setOp, setRange, typeText } from '../lib/filters.mjs';

/** An ISO date `days` from today in Europe/Belgrade (new workspaces use it). */
function isoDay(days) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() + days * 86_400_000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const rowsText = (page, selector = '.table-row') => page.$$eval(selector, (els) => els.map((el) => el.innerText));
const waitRows = (page, n, selector = '.table-row') => page.waitForFunction((n, sel) => document.querySelectorAll(sel).length === n, {}, n, selector);
const emptyCard = (page) => page.waitForSelector('[data-testid=filter-empty]').then((el) => el.evaluate((x) => x.innerText));

describe('filter row', () => {
  const browser = useBrowser();
  const step = steps(browser, 'filter-row');
  let page;
  let tier;
  let acmeId;
  let dealId;

  step('sets up companies, contacts, tasks, products and a company custom field', async () => {
    page = await browser.person('fiona');
    await newUserWithWorkspace(page, { label: 'filter-row', name: 'Fiona Filter', workspace: 'Filters Co' });
    tier = await api(page, '/crm/custom-fields', { method: 'POST', body: JSON.stringify({ entity: 'company', label: 'Tier', type: 'select', options: [{ label: 'Gold' }, { label: 'Silver' }] }) });
    const gold = tier.options.find((o) => o.label === 'Gold').id;
    const acme = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Acme Freight', industry: 'Freight & logistics', hq: 'Belgrade', customFields: { [tier.id]: gold }, ...READY_IDENTITY }) });
    const bolt = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Bolt Wine', industry: 'Wine', hq: 'Novi Sad' }) });
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Ana Acme', companyId: acme.id, jobTitle: 'CFO', email: 'ana@acme.example.com', buyerRole: 'Economic buyer' }) });
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Bob Bolt', companyId: bolt.id, jobTitle: 'Owner' }) });
    const [funnel] = await api(page, '/crm/funnels');
    const deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Acme lanes', funnelId: funnel.id, companyId: acme.id }) });
    [acmeId, dealId] = [acme.id, deal.id];
    const task = (label, channel, dueDate) => api(page, `/crm/deals/${deal.id}/tasks`, { method: 'POST', body: JSON.stringify({ stageId: funnel.stages[0].id, label, blocksAdvance: false, channel, dueDate }) });
    await task('Call Acme back', 'PH', isoDay(0));
    await task('Email the price list', 'EM', isoDay(5));
    await api(page, '/crm/products', { method: 'POST', body: JSON.stringify({ name: 'Annual licence', unitPrice: 4800, billingFrequency: 'annually' }) });
    await api(page, '/crm/products', { method: 'POST', body: JSON.stringify({ name: 'Workshop day', unitPrice: 1200, billingFrequency: 'one_time' }) });
  });

  step('Today: Salesperson Me, then Type, Due date and is not together; the no-results card', async () => {
    await page.goto(BASE_URL + '/today', { waitUntil: 'networkidle0' });
    assert.deepEqual(await chips(page), ['owner']);
    assert.equal(await chipText(page, 'owner'), 'Salesperson Me');
    await page.waitForFunction(() => document.body.innerText.includes('Call Acme back') && document.body.innerText.includes('Email the price list'));
    await addFilter(page, 'type');
    await pickOption(page, 'type', 'Call');
    await closePopover(page);
    await addFilter(page, 'due');
    await pickOption(page, 'due', 'today');
    assert.match(await page.$eval('[data-testid="filter-pop-due"]', (el) => el.innerText), /Updates with today's date\./);
    await closePopover(page);
    await page.waitForFunction(() => document.body.innerText.includes('Call Acme back') && !document.body.innerText.includes('Email the price list'));
    await setOp(page, 'type', 'isnot');
    await closePopover(page);
    assert.equal(await chipText(page, 'type'), 'Type is not Call');
    assert.match(await emptyCard(page), /No tasks match these filters/);
    await clearFilters(page);
    assert.deepEqual(await chips(page), ['owner']);
    assert.equal(await chipText(page, 'owner'), 'Salesperson Any');
    await page.waitForFunction(() => document.body.innerText.includes('Email the price list'));
  });

  step("Today: Meetings today follow every ticked salesperson, not only you", async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('filter-row-ana'), role: 'member' }) });
    const ana = await browser.person('filter-row-ana');
    await ana.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(ana, email('filter-row-ana'), 'Ana Agent');
    await clickButton(ana, 'Accept and join');
    await finishOnboarding(ana);
    // One meeting each, today: Fiona organizes hers, Ana hers.
    const at = (h) => `${isoDay(0)}T${String(h).padStart(2, '0')}:00:00Z`;
    const meeting = (p, title, h) => api(p, '/crm/meetings', { method: 'POST', body: JSON.stringify({ title, type: 'visit', startsAt: at(h), endsAt: at(h + 1), companyId: acmeId, dealId }) });
    await meeting(page, 'Fiona site visit', 8);
    await meeting(ana, 'Ana site visit', 9);
    const team = (await api(page, '/team')).members;
    const id = (name) => team.find((m) => m.displayName === name).userId;

    await page.goto(BASE_URL + '/today', { waitUntil: 'networkidle0' });
    const meetings = () => page.$$eval('[data-testid=meetings-today] [data-meeting-id]', (els) => els.map((el) => el.innerText).join(' | '));
    // Me and Ana ticked: both meetings (it used to show only yours).
    await openChip(page, 'owner');
    await click(page, `[data-testid="filter-pop-owner"] [data-testid="filter-option"][data-value="${id('Fiona Filter')}"]`);
    await click(page, `[data-testid="filter-pop-owner"] [data-testid="filter-option"][data-value="${id('Ana Agent')}"]`);
    await closePopover(page);
    await page.waitForFunction(() => /Fiona site visit/.test(document.querySelector('[data-testid=meetings-today]')?.innerText ?? '') && /Ana site visit/.test(document.querySelector('[data-testid=meetings-today]')?.innerText ?? ''));
    // Ana alone: only hers.
    await openChip(page, 'owner');
    await click(page, `[data-testid="filter-pop-owner"] [data-testid="filter-option"][data-value="${id('Fiona Filter')}"]`);
    await closePopover(page);
    await page.waitForFunction(() => !/Fiona site visit/.test(document.querySelector('[data-testid=meetings-today]')?.innerText ?? ''));
    assert.match(await meetings(), /Ana site visit/);
    await clearFilters(page);
  });

  step('Companies: + Filter lists every field, the new custom one tagged; Industry and Tier together', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    await waitRows(page, 2);
    const offered = await offeredFields(page);
    for (const id of ['name', 'industry', 'hq', 'size', 'source', 'pib', 'ownership', 'city', 'domain', 'openValue', 'lifetimeValue', 'cf:' + tier.id]) assert.ok(offered.includes(id), `offers ${id}`);
    assert.ok(!offered.includes('owner'), 'the pinned Salesperson is not offered again');
    // The custom field has the Custom tag and the list popover of its type, without any code for it.
    await addFilter(page, 'cf:' + tier.id);
    await pickOption(page, 'cf:' + tier.id, tier.options.find((o) => o.label === 'Gold').id);
    await closePopover(page);
    assert.equal(await chipText(page, 'cf:' + tier.id), 'Tier Gold');
    await waitRows(page, 1);
    assert.match((await rowsText(page))[0], /Acme Freight/);
    await addFilter(page, 'industry');
    await pickOption(page, 'industry', 'Wine');
    await closePopover(page);
    assert.match(await emptyCard(page), /No companies match these filters/);
    await clearFilters(page);
    await waitRows(page, 2);
  });

  step('Contacts: Buyer role and Email contains, then Email is empty; remembered after a reload', async () => {
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await waitRows(page, 2);
    await addFilter(page, 'buyerRole');
    await pickOption(page, 'buyerRole', 'Economic buyer');
    await closePopover(page);
    await addFilter(page, 'email');
    await typeText(page, 'email', 'acme');
    await closePopover(page);
    assert.equal(await chipText(page, 'email'), 'Email contains “acme”');
    await waitRows(page, 1);
    assert.match((await rowsText(page))[0], /Ana Acme/);
    await page.reload({ waitUntil: 'networkidle0' });
    await waitRows(page, 1);
    assert.deepEqual(await chips(page), ['owner', 'buyerRole', 'email']);
    // Is empty, with the buyer role unticked again: only the contact without an email.
    await setOp(page, 'email', 'isempty');
    await closePopover(page);
    await pickOption(page, 'buyerRole', 'Economic buyer');
    await closePopover(page);
    await waitRows(page, 1);
    assert.match((await rowsText(page))[0], /Bob Bolt/);
  });

  step('Products: Billing frequency and Unit price together; each page keeps its own filters', async () => {
    await page.goto(BASE_URL + '/products', { waitUntil: 'networkidle0' });
    const rows = '[data-testid=product-row]';
    await waitRows(page, 2, rows);
    assert.deepEqual(await chips(page), [], 'no pinned chips on Products');
    await addFilter(page, 'frequency');
    await pickOption(page, 'frequency', 'annually');
    await closePopover(page);
    await addFilter(page, 'unitPrice');
    await setRange(page, 'unitPrice', { min: '1000' });
    await closePopover(page);
    await waitRows(page, 1, rows);
    assert.match((await rowsText(page, rows))[0], /Annual licence/);
    await setRange(page, 'unitPrice', { max: '1000' });
    await closePopover(page);
    assert.match(await emptyCard(page), /No products match these filters/);
    // The empty card's own Clear filters.
    await page.click('[data-testid=filter-empty] button');
    await waitRows(page, 2, rows);
    // Contacts still has its own.
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await waitRows(page, 1);
    assert.deepEqual(await chips(page), ['owner', 'buyerRole', 'email']);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
