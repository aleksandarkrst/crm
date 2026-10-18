// Floating panels really show (CD-355): the date range calendar in Request time off and Report sick
// leave, and the Timesheet's "+ Task @Project" dropdown open fully inside the window and on top
// (nothing clips or covers them), at a tall and a short window, and a pick goes through. Written
// after the 18 Oct regression where a review fix left the calendar clipped inside the dialog.
// Run locally before every PR that touches the frontend: `npm test -- --test-name-pattern=popovers`.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

/** The panel is inside the window and the topmost element at its centre and near its corners. */
async function assertOnTop(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  const result = await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    const inside = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
    const points = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + 12, r.top + 12],
      [r.right - 12, r.bottom - 12],
    ];
    const onTop = points.every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
    return { inside, onTop, rect: [Math.round(r.top), Math.round(r.left), Math.round(r.width), Math.round(r.height)], view: [window.innerWidth, window.innerHeight] };
  });
  assert.ok(result.inside, `${selector} is inside the window: ${JSON.stringify(result)}`);
  assert.ok(result.onTop, `${selector} is on top, not clipped or covered: ${JSON.stringify(result)}`);
}

/** Two weekdays of this month shown in the calendar (not days of the neighbouring months). */
const weekdaysIn = (page, calendar) =>
  page.$$eval(`${calendar} .drp-day:not(.other)`, (els) =>
    els.map((el) => el.dataset.date).filter((d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; }),
  );

describe('popovers', () => {
  const browser = useBrowser();
  const step = steps(browser, 'popovers');
  let page;
  let task;

  step('sets up someone with an employee record and a task', async () => {
    page = await browser.person('poppy');
    await newUserWithWorkspace(page, { label: 'popovers', name: 'Poppy Panel', workspace: 'Panel Co' });
    const me = (await api(page, '/people/access')).employeeId;
    await api(page, '/people/employees/' + me, { method: 'PATCH', body: JSON.stringify({ employmentStartDate: '2024-03-01' }) });
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Kovin Pančevo' }) });
    const [type] = await api(page, '/project-types');
    const project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Service contract 2026', projectTypeId: type.id, companyId: company.id }) });
    task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Inspect the pumps', assigneeIds: [me] }) });
  });

  for (const height of [1100, 620]) {
    step(`Request time off: the calendar shows on top of the dialog and picks a range (window ${height} px high)`, async () => {
      await page.setViewport({ width: 1400, height });
      await page.goto(BASE_URL + '/timeoff', { waitUntil: 'networkidle0' });
      await click(page, '[data-testid=request-new]');
      await click(page, '[data-testid=request-dates-open]');
      await assertOnTop(page, '[data-testid=request-dates-calendar]');
      const [first, , third] = await weekdaysIn(page, '[data-testid=request-dates-calendar]');
      await click(page, `[data-testid=request-dates-calendar] .drp-day[data-date="${first}"]`);
      await click(page, `[data-testid=request-dates-calendar] .drp-day[data-date="${third}"]`);
      await page.waitForFunction(() => !document.querySelector('[data-testid=request-dates-calendar]'));
      assert.match(await page.$eval('[data-testid=request-dates-open]', (el) => el.textContent), /–/);
    });

    step(`Report sick leave: the one-day calendar shows on top of the dialog (window ${height} px high)`, async () => {
      await page.goto(BASE_URL + '/timeoff', { waitUntil: 'networkidle0' });
      await click(page, 'button::-p-text(Report sick leave)');
      await click(page, '[data-testid=sick-dates-open]');
      await assertOnTop(page, '[data-testid=sick-dates-calendar]');
      const [day] = await weekdaysIn(page, '[data-testid=sick-dates-calendar]');
      await click(page, `[data-testid=sick-dates-calendar] .drp-day[data-date="${day}"]`);
      await page.waitForFunction(() => !document.querySelector('[data-testid=sick-dates-calendar]'));
      assert.doesNotMatch(await page.$eval('[data-testid=sick-dates-open]', (el) => el.textContent), /Pick/);
    });
  }

  step('Timesheet: "+ Task @Project" shows on top and adds the task', async () => {
    await page.setViewport({ width: 1400, height: 620 });
    await page.goto(BASE_URL + '/timesheet', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=ts-add-row]');
    await assertOnTop(page, '[data-testid=ts-picker]');
    // The search takes focus as it opens; Escape closes and gives focus back to the button.
    await page.waitForFunction(() => document.activeElement?.dataset.testid === 'ts-picker-search');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=ts-picker]') && document.activeElement?.dataset.testid === 'ts-add-row');
    await click(page, '[data-testid=ts-add-row]');
    await click(page, '[data-testid=ts-picker-expand]');
    await click(page, `[data-testid=ts-picker-task][data-id="${task.id}"]`);
    await page.waitForSelector(`[data-testid=ts-row][data-row="${task.id}"]`);
  });
});
