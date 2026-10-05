// Visit plan tracking (CD-135): an owner plans two visits at a customer for a member this month;
// the member schedules one from the plan and marks it held; the owner's open plan page counts it
// without a reload (1 held, 50%); Reports → Visit-plan completion shows the same, and its count
// opens the Calendar's table with the right filters; the Overview card agrees; the member sees
// their own card and no Reports.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, createWorkspace, email, eventually, finishOnboarding, signIn, steps, useBrowser } from '../lib/harness.mjs';

describe('visit plan tracking', () => {
  const browser = useBrowser();
  const step = steps(browser, 'visit-plan-tracking');
  let olga;
  let mia;
  let miaId;
  let alphaId;
  let planId;
  let period;
  let meetingId;

  const textOf = (page, selector) => page.$eval(selector, (el) => el.textContent.trim());

  step('an owner plans two visits at a customer for a member this month', async () => {
    olga = await browser.person('olga');
    await olga.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(olga, email('track-olga'), 'Olga Owner');
    await createWorkspace(olga, 'Tracking Co');
    alphaId = (await api(olga, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Alpha Track' }) })).id;
    const { token } = await api(olga, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('track-mia'), role: 'member' }) });
    mia = await browser.person('mia');
    await mia.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(mia, email('track-mia'), 'Mia Member');
    await clickButton(mia, 'Accept and join');
    await finishOnboarding(mia);
    miaId = (await api(olga, '/team')).members.find((m) => m.email === email('track-mia')).userId;

    // This month on the workspace's clock, as the server counts it.
    period = await api(olga, '/crm/visit-plans/progress-summary?periodType=month');
    const plan = await api(olga, '/crm/visit-plans', {
      method: 'POST',
      body: JSON.stringify({ salespersonUserId: miaId, periodType: 'month', periodStart: period.periodStart, lines: [{ companyId: alphaId, plannedVisits: 2 }] }),
    });
    planId = plan.id;
  });

  step('the member schedules a visit from the plan', async () => {
    await mia.goto(`${BASE_URL}/visit-plans/${planId}`, { waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-testid=visit-plan-line]');
    await mia.waitForFunction(() => document.querySelector('[data-testid=visit-plan-held]')?.textContent.trim() === '0');
    await click(mia, '[data-testid=visit-plan-schedule]');
    await mia.waitForSelector('.modal [data-testid=meeting-form]');
    await click(mia, '[data-testid=meeting-save]');
    await mia.waitForSelector('[data-testid=meeting-no-external]');
    await click(mia, '[data-testid=meeting-save]');
    await mia.waitForFunction(() => !document.querySelector('.modal [data-testid=meeting-form]'), { timeout: 10_000 });
    const meetings = await eventually(async () => {
      const { meetings } = await api(mia, `/crm/meetings?companyId=${alphaId}`);
      return meetings.length === 1 && meetings;
    });
    assert.ok(meetings, 'scheduled');
    meetingId = meetings[0].id;
    // It started a minute ago (so it can be marked held), still this month.
    const start = new Date(Date.now() - 60_000);
    await api(mia, `/crm/meetings/${meetingId}`, { method: 'PATCH', body: JSON.stringify({ startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() }) });
  });

  step('marking it held updates the owner’s open plan page without a reload', async () => {
    await olga.goto(`${BASE_URL}/visit-plans/${planId}`, { waitUntil: 'networkidle0' });
    await olga.waitForFunction(() => document.querySelector('[data-testid=visit-plan-completion]')?.textContent.trim() === '0%');
    await olga.evaluate(() => (window.__noReload = true));

    await mia.goto(`${BASE_URL}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await mia.waitForFunction(() => document.querySelector('[data-testid=meeting-held]')?.disabled === false);
    await click(mia, '[data-testid=meeting-held]');
    await mia.waitForFunction(() => document.querySelector('[data-testid=meeting-status]')?.innerText.trim() === 'Held');

    await olga.waitForFunction(() => document.querySelector('[data-testid=visit-plan-held]')?.textContent.trim() === '1', { timeout: 15_000 });
    await olga.waitForFunction(() => document.querySelector('[data-testid=visit-plan-completion]')?.textContent.trim() === '50%');
    assert.equal(await olga.evaluate(() => window.__noReload), true, 'no reload');
    assert.equal(await textOf(olga, '[data-testid=visit-plan-progress]'), '1 of 2 planned visits held');

    // The number opens the meeting behind it.
    await click(olga, 'button[data-testid=visit-plan-held]');
    await olga.waitForSelector('[data-testid=visit-plan-drill-meeting]');
    assert.equal(await olga.$eval('[data-testid=visit-plan-drill-meeting]', (a) => a.getAttribute('href')), `/meetings/${meetingId}`);

    // The member's plan list shows the same completion.
    await mia.goto(`${BASE_URL}/visit-plans`, { waitUntil: 'networkidle0' });
    await mia.waitForFunction(() => document.querySelector('[data-testid=visit-plan-completion]')?.textContent.trim() === '50%');
  });

  step('Reports shows the same numbers, and a count opens the Calendar table with its filters', async () => {
    await olga.goto(`${BASE_URL}/overview`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('a[href^="/reports"]');
    await click(olga, 'a[href^="/reports"]');
    await olga.waitForSelector('[data-testid=report-tab-visit-plans]');
    assert.equal(await textOf(olga, '[data-testid=report-tab-visit-plans]'), 'Visit-plan completion');
    await olga.waitForSelector(`[data-testid=report-row][data-user-id="${miaId}"]`);
    const row = `[data-testid=report-row][data-user-id="${miaId}"]`;
    assert.equal(await textOf(olga, `${row} [data-testid=report-planned]`), '2');
    assert.equal(await textOf(olga, `${row} [data-testid=report-held]`), '1');
    assert.equal(await textOf(olga, `${row} [data-testid=report-completion]`), '50%');
    assert.equal(await olga.$eval(`${row} [data-testid=report-plan-link]`, (a) => a.getAttribute('href')), `/visit-plans/${planId}`);
    const report = await api(olga, `/crm/visit-plans/report?periodType=month&periodStart=${period.periodStart}`);
    const progress = await api(olga, `/crm/visit-plans/${planId}/progress`);
    const mine = report.rows.find((r) => r.salespersonUserId === miaId);
    assert.deepEqual([mine.planned, mine.heldCapped, mine.completion], [progress.totals.planned, progress.totals.heldCapped, progress.totals.completion]);

    await click(olga, `${row} a[data-testid=report-held]`);
    await olga.waitForFunction(() => location.pathname === '/calendar');
    const q = new URL(olga.url()).searchParams;
    assert.equal(q.get('view'), 'table');
    assert.equal(q.get('user'), miaId);
    assert.equal(q.get('type'), 'visit');
    assert.equal(q.get('status'), 'held');
    assert.equal(q.get('from'), period.periodStart);
    assert.ok(q.get('to') < period.periodEnd && q.get('to').slice(0, 7) === period.periodStart.slice(0, 7), 'to: the last day of the month');
    await olga.waitForSelector(`[data-testid=meeting-table] [data-meeting-id="${meetingId}"]`);
  });

  step('the Overview card agrees, for the team and for the member', async () => {
    await olga.goto(`${BASE_URL}/overview`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=visit-progress-card]');
    await olga.waitForFunction(() => document.querySelector('[data-testid=visit-progress-completion]')?.textContent.trim() === '50%');
    assert.equal(await textOf(olga, '[data-testid=visit-progress-planned]'), '2');
    assert.equal(await textOf(olga, '[data-testid=visit-progress-held]'), '1');
    await olga.select('[data-testid=visit-progress-person]', miaId);
    assert.ok((await olga.$eval('[data-testid=visit-progress-report]', (a) => a.getAttribute('href'))).includes(`salesperson=${miaId}`), 'the report link keeps the salesperson');
    await olga.waitForFunction(() => document.querySelector('[data-testid=visit-progress-held]')?.textContent.trim() === '1');

    await mia.goto(`${BASE_URL}/overview`, { waitUntil: 'networkidle0' });
    await mia.waitForFunction(() => document.querySelector('[data-testid=visit-progress-completion]')?.textContent.trim() === '50%');
    assert.equal(await mia.$('[data-testid=visit-progress-person]'), null, 'members see only their own');
    assert.equal(await mia.$eval('[data-testid=visit-progress-plan]', (a) => a.getAttribute('href')), `/visit-plans/${planId}`);
    assert.equal(await mia.$('a[href^="/reports"]'), null, 'no Reports for members');
    await mia.goto(`${BASE_URL}/reports/visit-plans`, { waitUntil: 'networkidle0' });
    await mia.waitForFunction(() => !location.pathname.startsWith('/reports'));
  });

  step('the company page says how many of this month’s planned visits were held', async () => {
    await olga.goto(`${BASE_URL}/companies/${alphaId}`, { waitUntil: 'networkidle0' });
    await olga.waitForFunction(() => document.querySelector('[data-testid=company-visits-this-month]')?.textContent.trim() === 'Visits this month: 1 / 2');
  });
});

