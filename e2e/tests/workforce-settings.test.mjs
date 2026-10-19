// Settings → Workforce (CD-153): Employees (time format, max hours per day, the standard working
// day), Holidays (add, copy from last year) and Approvals (deadline with its live line, auto
// submit; the reminders, CD-154), and what they change in the Timesheet: Expected, the hours' format, the holiday row and
// header, and "Submit by".
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear, testPib } from '../lib/harness.mjs';

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (date) => `${DAY[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]} ${Number(date.slice(8))} ${MONTH[Number(date.slice(5, 7)) - 1]}`;

describe('workforce settings', () => {
  const browser = useBrowser();
  const step = steps(browser, 'workforce-settings');
  let page;
  let task;
  let monday;
  /** Picks `from` and `to` in the holiday form's range picker (CD-318): opens it, pages to each month, clicks the day. */
  const pickDates = async (from, to) => {
    await click(page, '[data-testid=holiday-add-dates-open]');
    for (const date of [from, to]) {
      for (let i = 0; i < 24 && !(await page.$(`[data-testid=holiday-add-dates-calendar] .drp-day:not(.other)[data-date="${date}"]`)); i++) {
        const shown = await page.$eval('[data-testid=holiday-add-dates-calendar] .drp-month', (el) => el.textContent);
        const shownIso = new Date(`1 ${shown} 00:00:00Z`).toISOString().slice(0, 7);
        await click(page, `[data-testid=holiday-add-dates-calendar] [aria-label="${date.slice(0, 7) > shownIso ? 'Next month' : 'Previous month'}"]`);
      }
      await click(page, `[data-testid=holiday-add-dates-calendar] .drp-day:not(.other)[data-date="${date}"]`);
    }
    await page.waitForFunction(() => !document.querySelector('[data-testid=holiday-add-dates-calendar]'));
  };
  const timesheet = async () => (await api(page, '/workspace')).timesheet;

  step('sets up a task to log time on', async () => {
    page = await browser.person('wanda');
    await newUserWithWorkspace(page, { label: 'wf-settings', name: 'Wanda Admin', workspace: 'Workforce Co' });
    const me = (await api(page, '/people/access')).employeeId;
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Kovin Pančevo' }) });
    const [type] = await api(page, '/project-types');
    const project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Service contract 2026', projectTypeId: type.id, companyId: company.id }) });
    task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Parts price list', assigneeIds: [me] }) });
    monday = (await api(page, '/timesheet/week')).thisWeek;
  });

  step('Employees: time format, max hours per day and the standard working day save as you change them', async () => {
    await page.goto(BASE_URL + '/settings/employees', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=time-format-clock]');
    await setValue(page, '[data-testid=max-day-hours]', '10');
    await setValue(page, '[data-testid=day-hours]', '7.5');
    await click(page, '[data-testid=working-days] button::-p-text(Sat)');
    const saved = await eventually(async () => {
      const t = await timesheet();
      return t.timeFormat === 'clock' && t.maxDayHours === 10 && t.dayMinutes === 450 && t.workingDays.includes(6) && t;
    });
    assert.ok(saved, 'saved');
  });

  step('the Timesheet follows them: 7:30 a day Monday to Saturday, hours shown as 7:30', async () => {
    await api(page, '/timesheet/cells', { method: 'PUT', body: JSON.stringify({ date: monday, taskId: task.id, minutes: 450 }) });
    await page.goto(BASE_URL + '/timesheet', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=ts-total-entered]');
    // Expected hours sit on the Total row's day cells (CD-351: no Expected row).
    const expected = await page.$$eval('[data-testid=ts-total-entered] .ts-sum', (els) => els.map((el) => el.dataset.expected));
    assert.deepEqual(expected, ['7:30', '7:30', '7:30', '7:30', '7:30', '7:30', '0:00']);
    assert.equal(await page.$eval(`[data-testid=ts-cell][data-row="${task.id}"][data-date="${monday}"]`, (el) => el.value), '7:30');
  });

  step('Holidays: add one this week; it shows as a row and lowers Expected', async () => {
    await page.goto(BASE_URL + '/settings/holidays', { waitUntil: 'networkidle0' });
    const wed = addDays(monday, 2);
    if ((await page.$eval('[data-testid=holidays-year]', (el) => el.textContent)) !== wed.slice(0, 4)) await click(page, wed.slice(0, 4) > String(new Date().getFullYear()) ? '[aria-label="Next year"]' : '[aria-label="Previous year"]');
    await pickDates(wed, wed);
    await setValue(page, '[data-testid=holiday-add-name]', 'Statehood Day');
    await click(page, '[data-testid=holiday-add-go]');
    await page.waitForSelector(`[data-testid=holiday-row][data-date="${wed}"]`);
    await waitForToastToClear(page);
    await page.goto(BASE_URL + '/timesheet', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=ts-holiday-row]');
    assert.match(await page.$eval('[data-testid=ts-holiday-row]', (el) => el.textContent), /Public holiday · Statehood Day/);
    assert.match(await page.$eval(`[data-testid=ts-day][data-date="${wed}"]`, (el) => el.textContent), /Holiday/);
    const expected = await page.$$eval('[data-testid=ts-total-entered] .ts-sum', (els) => els.map((el) => el.dataset.expected));
    assert.equal(expected[2], '0:00');
    assert.match(await page.$eval('[data-testid=ts-expected-note]', (el) => el.textContent), /minus holidays/);
  });

  step('a holiday spans days and repeats every year (CD-318): no Copy from last year', async () => {
    await page.goto(BASE_URL + '/settings/holidays', { waitUntil: 'networkidle0' });
    assert.equal(await page.$('[data-testid=holidays-copy]'), null);
    const year = Number(await page.$eval('[data-testid=holidays-year]', (el) => el.textContent));
    await pickDates(`${year}-12-31`, `${year + 1}-01-01`);
    await setValue(page, '[data-testid=holiday-add-name]', 'New Year');
    await click(page, '[data-testid=holiday-add-go]');
    await page.waitForSelector(`[data-testid=holiday-row][data-date="${year}-12-31"]`);
    assert.match(await page.$eval(`[data-testid=holiday-row][data-date="${year}-12-31"]`, (el) => el.textContent), /31 Dec – .* 1 Jan/);
    await waitForToastToClear(page);
    await click(page, '[aria-label="Next year"]');
    await page.waitForSelector(`[data-testid=holiday-row][data-date="${year + 1}-12-31"]`);
    assert.match(await page.$eval(`[data-testid=holiday-row][data-date="${year + 1}-12-31"]`, (el) => el.textContent), new RegExp(`every year since ${year}`));
    // Delete from the row's ⋯ menu.
    await click(page, `[data-testid=holiday-row][data-date="${year + 1}-12-31"] [data-testid=holiday-menu]`);
    await click(page, '[data-testid=holiday-remove]');
    await click(page, '[data-testid=confirm-ok]');
    await page.waitForFunction((d) => !document.querySelector(`[data-testid=holiday-row][data-date="${d}"]`), {}, `${year + 1}-12-31`);
  });

  step('Approvals: the deadline day and time, the live line, and "Submit by" in the Timesheet', async () => {
    await page.goto(BASE_URL + '/settings/approvals', { waitUntil: 'networkidle0' });
    // Sunday 23:30: still ahead whatever day the test runs (a passed deadline shows "Deadline passed", CD-155).
    await setValue(page, '[data-testid=deadline-day]', '7');
    await setValue(page, '[data-testid=deadline-time]', '23:30');
    await eventually(async () => {
      const t = await timesheet();
      return t.deadlineWeekday === 7 && t.deadlineTime === '23:30';
    });
    await page.waitForFunction(() => /is due Sun \d+ \w{3}, 23:30\./.test(document.querySelector('[data-testid=deadline-next]')?.textContent ?? ''));
    await click(page, '[data-setting=auto-submit] [role=switch]');
    assert.ok(await eventually(async () => (await timesheet()).autoSubmit === true));
    // Reminders (CD-154): 2 hours before by default; 4 hours, and the after-deadline emails off.
    assert.equal(await page.$eval('[data-testid=reminder-hours]', (el) => el.value), '2');
    await setValue(page, '[data-testid=reminder-hours]', '4');
    await click(page, '[data-setting=after-deadline-emails] [role=switch]');
    assert.ok(await eventually(async () => {
      const t = await timesheet();
      return t.reminderHours === 4 && t.afterDeadlineEmails === false;
    }));
    await setValue(page, '[data-testid=reminder-hours]', '');
    assert.ok(await eventually(async () => (await timesheet()).reminderHours === null));
    await page.goto(BASE_URL + '/timesheet', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.ts-due');
    assert.equal(await page.$eval('.ts-due', (el) => el.textContent), `Submit by ${label(addDays(monday, 6))}, 23:30`);
  });
});
