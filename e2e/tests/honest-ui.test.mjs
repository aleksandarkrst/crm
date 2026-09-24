// Overview shows only figures computed from real data, its closing-date filter filters, the
// sidebar shows the signed-in user, and features without a backend don't claim to save anything.
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
  setClosingDate,
  steps,
  text,
  useBrowser,
  waitForToastToClear,
} from '../lib/harness.mjs';

/** Local ISO date `days` from today. */
function isoIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Picks an option in the Overview filter chip that offers it. */
function pickChip(page, option) {
  return page.evaluate((option) => {
    const select = [...document.querySelectorAll('select')].find((el) => [...el.options].some((o) => o.value === option));
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, option);
}

const metaText = (page) => page.evaluate(() => [...document.querySelectorAll('span')].map((el) => el.textContent).find((t) => / in view · /.test(t)) ?? '');

describe('honest UI', () => {
  const browser = useBrowser();
  const step = steps(browser, 'honest-ui');
  let page;
  let datedId;
  let undatedId;

  step('signs in and shows the signed-in user in the sidebar', async () => {
    page = await browser.person('olivia');
    await newUserWithWorkspace(page, { label: 'olivia', name: 'Olivia Honest', workspace: 'Honest Studio' });
    const avatar = await page.waitForSelector('[data-testid=sidebar-avatar]');
    assert.equal((await avatar.evaluate((el) => el.textContent)).trim(), 'OH');
    assert.ok(!(await text(page)).includes('MJ'), 'no sample initials');
  });

  step('creates one deal closing soon and one without a closing date', async () => {
    datedId = await createDealInUi(page, { company: 'Dated d.o.o.', contact: 'Dana Dated' });
    await page.waitForSelector('input[type=date]');
    await setClosingDate(page, isoIn(5));
    assert.ok(await eventually(async () => (await api(page, '/crm/deals/' + datedId)).closeDate === isoIn(5)), 'closing date saved');

    // The second deal through the API (the New deal dialog is covered elsewhere), in the same funnel.
    const { funnelId } = await api(page, '/crm/deals/' + datedId);
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Undated d.o.o.' }) });
    const deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Undated deal', funnelId, companyId: company.id }) });
    undatedId = deal.id;
    assert.equal(deal.closeDate, null);
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
  });

  step('Overview shows no made-up numbers', async () => {
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('in the current filter'));
    // The conversion card waits for the stage history (CD-62).
    await page.waitForFunction(() => document.body.innerText.includes('so far)'));
    const body = await text(page);
    for (const fake of ['41%', 'Proposal → won', 'Days to proposal', 'Docs generated', 'Up from 24%', '57h saved', 'nudge sent automatically']) assert.ok(!body.includes(fake), `no "${fake}"`);
    assert.ok(body.includes('Conversion rates appear once at least 5 deals in view have moved between stages (0 so far)'), 'conversion empty state');
    assert.ok(body.includes('Document counts appear once'), 'documents empty state');
    assert.match(body, /2 open deals in the current filter/);
    assert.match(await metaText(page), /^2 deals in view · any closing date$/);
  });

  step('the closing-date filter changes what Overview counts', async () => {
    assert.ok(await pickChip(page, 'Closing in 30 days'), 'date chip found');
    await page.waitForFunction(() => document.body.innerText.includes('1 deal in view'));
    assert.match(await metaText(page), /^1 deal in view · closing in 30 days · 1 without a closing date hidden$/);
    assert.match(await text(page), /1 open deal in the current filter/);

    assert.ok(await pickChip(page, 'Closing date passed'));
    await page.waitForFunction(() => document.body.innerText.includes('0 deals in view'));
    assert.match(await text(page), /0 open deals in the current filter/);

    assert.ok(await pickChip(page, 'Any closing date'));
    await page.waitForFunction(() => document.body.innerText.includes('2 deals in view'));
  });

  step('features without a backend are disabled and say so', async () => {
    await page.goto(BASE_URL + '/settings/templates', { waitUntil: 'networkidle0' });
    const newTemplate = await page.waitForSelector('button::-p-text(New template)');
    assert.ok(await newTemplate.evaluate((el) => el.disabled), 'New template is disabled');
    const body = await text(page);
    assert.ok(/coming soon/i.test(body), 'coming soon hint');
    assert.ok(!body.includes('Used 38 times') && !body.includes('owner: Mila'), 'no made-up template usage');

    // Funnels can be created now (CD-10): the builder offers "New funnel" instead of a disabled "New pipeline".
    await page.goto(BASE_URL + '/settings/funnel', { waitUntil: 'networkidle0' });
    const newFunnel = await page.waitForSelector('button::-p-text(New funnel)');
    assert.ok(!(await newFunnel.evaluate((el) => el.disabled)), 'New funnel is enabled for the owner');
    assert.ok(!(await text(page)).includes('New pipeline'), 'no "New pipeline" placeholder');
  });

  step('a custom field says it is only for this session', async () => {
    await page.goto(BASE_URL + '/settings/fields', { waitUntil: 'networkidle0' });
    await clickButton(page, 'New field');
    await page.type('input[placeholder="e.g. Contract end date"]', 'Renewal date');
    await clickButton(page, 'Add field');
    await page.waitForSelector('.toast');
    assert.match(await page.$eval('.toast', (el) => el.textContent), /Renewal date added to leads for this session only; not saved yet/);
    await waitForToastToClear(page);
  });

  step('marking a proposal as sent does not claim an email or a task', async () => {
    await page.goto(BASE_URL + '/settings/templates', { waitUntil: 'networkidle0' });
    await clickButton(page, 'Preview with a lead');
    await click(page, 'button::-p-text(Mark as sent)');
    await page.waitForSelector('.toast');
    const toast = await page.$eval('.toast', (el) => el.textContent);
    assert.match(toast, /this session only/);
    assert.ok(!/walkthrough task created/.test(toast), 'no fake task');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
