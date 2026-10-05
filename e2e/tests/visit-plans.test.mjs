// Customer visit plans (CD-134): an owner makes a monthly plan for a member with two customers,
// changes a number on the plan page, copies it to the next period (and "Copy from previous period"
// fills a new plan from it); the member sees their plan read-only and schedules a visit from it,
// also on a phone; plans are monthly and a quarter in Reports adds up its months (CD-212).
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, createWorkspace, email, eventually, finishOnboarding, setValue, signIn, steps, text, useBrowser } from '../lib/harness.mjs';

/** The first day of the month `months` after the month of an ISO date. */
const shiftMonths = (iso, months) => {
  const [y, m] = iso.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
};

describe('visit plans', () => {
  const browser = useBrowser();
  const step = steps(browser, 'visit-plans');
  let olga;
  let mia;
  let miaId;
  let planId;
  let plan;

  /** Adds a customer in the open New plan dialog through its company picker. */
  async function addCustomer(page, name) {
    await click(page, '[data-testid=plan-add-company] .picker-search');
    await page.type('[data-testid=plan-add-company] .picker-search', name);
    await click(page, `.picker-item::-p-text(${name})`);
    await page.waitForSelector(`input[aria-label="Planned visits at ${name}"]`);
  }
  const selected = (page, selector) => page.$eval(selector, (el) => el.selectedOptions[0]?.textContent ?? '');

  step('an owner and a member share a workspace with two customers', async () => {
    olga = await browser.person('olga');
    await olga.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(olga, email('plans-olga'), 'Olga Owner');
    await createWorkspace(olga, 'Plans Co');
    const ids = [];
    for (const name of ['Alpha Visits', 'Bravo Visits']) ids.push((await api(olga, '/crm/companies', { method: 'POST', body: JSON.stringify({ name }) })).id);
    // Alpha's one open deal: "Schedule visit" picks it (a meeting needs a deal, CD-213).
    const funnels = await api(olga, '/crm/funnels');
    await api(olga, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Alpha deal', funnelId: funnels[0].id, companyId: ids[0] }) });
    const { token } = await api(olga, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('plans-mia'), role: 'member' }) });

    mia = await browser.person('mia');
    await mia.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(mia, email('plans-mia'), 'Mia Member');
    await clickButton(mia, 'Accept and join');
    await finishOnboarding(mia);
    const team = await api(olga, '/team');
    miaId = team.members.find((m) => m.email === email('plans-mia')).userId;
  });

  step('the owner creates a monthly plan for the member with two customers', async () => {
    await olga.goto(`${BASE_URL}/visit-plans`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=visit-plans-empty]');
    await clickButton(olga, 'New plan');
    await olga.waitForSelector('[data-testid=plan-salesperson]');
    await setValue(olga, '[data-testid=plan-salesperson]', miaId);
    assert.equal(await olga.$eval('[data-testid=plan-copy-previous]', (b) => b.disabled), true, 'nothing to copy yet');
    await addCustomer(olga, 'Alpha Visits');
    await setValue(olga, 'input[aria-label="Planned visits at Alpha Visits"]', '3');
    await addCustomer(olga, 'Bravo Visits');
    const label = await selected(olga, '[data-testid=plan-period]');
    assert.match(label, /^[A-Z][a-z]+ \d{4}$/, 'a month');
    await click(olga, '[data-testid=plan-save]');

    await olga.waitForFunction(() => /^\/visit-plans\/[0-9a-f-]{36}$/.test(location.pathname));
    planId = olga.url().split('/visit-plans/')[1];
    await olga.waitForSelector('[data-testid=visit-plan-period]');
    assert.equal(await olga.$eval('[data-testid=visit-plan-period]', (el) => el.textContent), label);
    assert.equal(await olga.$eval('[data-testid=visit-plan-salesperson]', (el) => el.textContent), 'Mia Member');
    assert.equal(await olga.$eval('[data-testid=visit-plan-summary]', (el) => el.textContent), '4 visits at 2 customers');
    plan = await api(olga, `/crm/visit-plans/${planId}`);
    assert.deepEqual(
      plan.lines.map((l) => [l.companyName, l.plannedVisits]),
      [
        ['Alpha Visits', 3],
        ['Bravo Visits', 1],
      ],
    );
  });

  step('the owner changes a number on the plan page; it is saved and in the history', async () => {
    await setValue(olga, 'input[aria-label="Planned visits at Bravo Visits"]', '2');
    await olga.waitForFunction(() => document.querySelector('[data-testid=visit-plan-summary]')?.textContent === '5 visits at 2 customers');
    const saved = await eventually(async () => (await api(olga, `/crm/visit-plans/${planId}`)).totalPlanned === 5);
    assert.ok(saved, 'saved: 5 planned visits');
    await olga.waitForFunction(() => document.querySelector('[data-testid=change-history]')?.innerText.includes('Planned visits at Bravo Visits: 1 visit → 2 visits'), { timeout: 10_000 });
  });

  step('"Copy to next period" makes the next month\'s plan with the same customers', async () => {
    await click(olga, '[data-testid=visit-plan-copy-next]');
    await olga.waitForSelector('[data-testid=plan-period]');
    assert.equal(await olga.$eval('[data-testid=plan-period]', (el) => el.value), shiftMonths(plan.periodStart, 1));
    assert.equal((await olga.$$('[data-testid=plan-draft-line]')).length, 2);
    await click(olga, '[data-testid=plan-save]');
    await olga.waitForFunction((id) => location.pathname.startsWith('/visit-plans/') && !location.pathname.endsWith(id), {}, planId);
    const next = await api(olga, `/crm/visit-plans/${olga.url().split('/visit-plans/')[1]}`);
    assert.equal(next.periodStart, shiftMonths(plan.periodStart, 1));
    assert.equal(next.salespersonUserId, miaId);
    assert.equal(next.totalPlanned, 5);

    // "Copy from previous period" in a new plan fills in that plan's customers.
    await olga.goto(`${BASE_URL}/visit-plans`, { waitUntil: 'networkidle0' });
    await olga.waitForFunction(() => document.querySelectorAll('[data-testid=visit-plan-row]').length === 2);
    await clickButton(olga, 'New plan');
    await setValue(olga, '[data-testid=plan-salesperson]', miaId);
    await setValue(olga, '[data-testid=plan-period]', shiftMonths(plan.periodStart, 2));
    await olga.waitForFunction(() => document.querySelector('[data-testid=plan-copy-previous]')?.disabled === false);
    await click(olga, '[data-testid=plan-copy-previous]');
    await olga.waitForFunction(() => document.querySelectorAll('[data-testid=plan-draft-line]').length === 2);
    assert.equal(await olga.$eval('input[aria-label="Planned visits at Bravo Visits"]', (el) => el.value), '2');
    await clickButton(olga, 'Cancel');
  });

  step('the member sees their plans read-only, and can schedule a visit, on a phone too', async () => {
    await mia.setViewport({ width: 375, height: 800 });
    await mia.goto(`${BASE_URL}/visit-plans`, { waitUntil: 'networkidle0' });
    await mia.waitForFunction(() => document.querySelectorAll('[data-testid=visit-plan-row]').length === 2);
    assert.equal(await mia.$('button::-p-text(New plan)'), null, 'no New plan for members');
    assert.ok(await mia.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 375 px');

    await mia.goto(`${BASE_URL}/visit-plans/${planId}`, { waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-testid=visit-plan-line]');
    assert.equal(await mia.$('input[data-testid=visit-plan-planned]'), null, 'numbers are read-only');
    assert.equal(await mia.$('[data-testid=visit-plan-delete]'), null, 'no delete');
    assert.equal(await mia.$('[data-testid=visit-plan-add]'), null, 'no add customer');
    assert.ok((await text(mia)).includes('Alpha Visits'));
    assert.ok(await mia.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the plan fits 375 px');

    // "Schedule visit" opens New meeting prefilled with the company, Customer visit and the salesperson.
    const alphaId = plan.lines.find((l) => l.companyName === 'Alpha Visits').companyId;
    await click(mia, '[data-testid=visit-plan-schedule]');
    await mia.waitForSelector('.modal [data-testid=meeting-form]');
    assert.equal(await mia.$eval('[data-testid=meeting-company]', (el) => el.value), alphaId);
    assert.equal(await mia.$eval('[data-testid=meeting-type]', (el) => el.value), 'visit');
    assert.equal(await mia.$eval('[data-testid=meeting-organizer]', (el) => el.value), miaId);
    assert.equal(await selected(mia, '[data-testid=meeting-deal]'), 'Alpha deal');
    // A customer visit without anyone from the customer warns first; the second click saves.
    await click(mia, '[data-testid=meeting-save]');
    await mia.waitForSelector('[data-testid=meeting-no-external]');
    await click(mia, '[data-testid=meeting-save]');
    await mia.waitForFunction(() => !document.querySelector('.modal [data-testid=meeting-form]'), { timeout: 10_000 });
    const meetings = await eventually(async () => {
      const { meetings } = await api(mia, `/crm/meetings?companyId=${alphaId}`);
      return meetings.length === 1 && meetings;
    });
    assert.ok(meetings, 'the visit was scheduled');
    assert.equal(meetings[0].type, 'visit');
    assert.equal(meetings[0].organizerUserId, miaId);
  });

  step('plans are monthly; Reports adds up a quarter from its monthly plans (CD-212)', async () => {
    await olga.goto(`${BASE_URL}/visit-plans`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=visit-plan-row]');
    await clickButton(olga, 'New plan');
    await olga.waitForSelector('[data-testid=plan-period]');
    assert.equal(await olga.$('[data-testid=plan-period-type]'), null, 'no period type to choose');
    const labels = await olga.$$eval('[data-testid=plan-period] option', (options) => options.map((o) => o.textContent));
    assert.ok(labels.every((l) => /^[A-Z][a-z]+ \d{4}$/.test(l)), `only months: ${labels.join(', ')}`);
    await clickButton(olga, 'Cancel');

    // The API refuses a quarterly plan.
    const refused = await olga.evaluate(async (miaId) => {
      const res = await fetch('/api/crm/visit-plans', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + localStorage.getItem('crm.devToken'), 'X-Tenant-Id': localStorage.getItem('crm.tenantId') ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ salespersonUserId: miaId, periodType: 'quarter', periodStart: '2027-01-01', lines: [] }),
      });
      return res.status;
    }, miaId);
    assert.equal(refused, 400);

    // This quarter in Reports: the member's planned visits are the sum of her monthly plans in it.
    const quarter = await api(olga, '/crm/visit-plans/progress-summary?periodType=quarter');
    const end = shiftMonths(quarter.periodStart, 3);
    const months = (await api(olga, '/crm/visit-plans')).plans.filter((p) => p.salespersonUserId === miaId && p.periodType === 'month' && p.periodStart >= quarter.periodStart && p.periodStart < end);
    assert.ok(months.length >= 1, 'a monthly plan in this quarter');
    const planned = months.reduce((n, p) => n + p.totalPlanned, 0);
    await olga.goto(`${BASE_URL}/reports/visit-plans?periodType=quarter&periodStart=${quarter.periodStart}`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector(`[data-testid=report-row][data-user-id="${miaId}"]`);
    await olga.waitForFunction(
      (miaId, planned) => document.querySelector(`[data-testid=report-row][data-user-id="${miaId}"] [data-testid=report-planned]`)?.textContent.trim() === String(planned),
      { timeout: 10_000 },
      miaId,
      planned,
    );
    assert.equal((await olga.$$(`[data-testid=report-row][data-user-id="${miaId}"] [data-testid=report-plan-link]`)).length, months.length, 'a link to each monthly plan');
  });
});
