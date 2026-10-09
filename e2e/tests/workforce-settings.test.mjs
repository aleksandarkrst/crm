// Settings → Workforce (CD-153): Employees (time format, max hours per day, the standard working
// day), Holidays (add, copy from last year) and Approvals (deadline with its live line, auto
// submit), and what they change in the Timesheet: Expected, the hours' format, the holiday row and
// header, and "Submit by".
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

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
  const timesheet = async () => (await api(page, '/workspace')).timesheet;

  step('sets up a task to log time on', async () => {
    page = await browser.person('wanda');
    await newUserWithWorkspace(page, { label: 'wf-settings', name: 'Wanda Admin', workspace: 'Workforce Co' });
    const me = (await api(page, '/people/access')).employeeId;
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Kovin Pančevo' }) });
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
    await page.waitForSelector('[data-testid=ts-expected]');
    const expected = await page.$$eval('[data-testid=ts-expected] .ts-sum', (els) => els.map((el) => el.textContent));
    assert.deepEqual(expected, ['7:30', '7:30', '7:30', '7:30', '7:30', '7:30', '']);
    assert.equal(await page.$eval(`[data-testid=ts-cell][data-row="${task.id}"][data-date="${monday}"]`, (el) => el.value), '7:30');
  });

  step('Holidays: add one this week; it shows as a row and lowers Expected', async () => {
    await page.goto(BASE_URL + '/settings/holidays', { waitUntil: 'networkidle0' });
    const wed = addDays(monday, 2);
    if ((await page.$eval('[data-testid=holidays-year]', (el) => el.textContent)) !== wed.slice(0, 4)) await click(page, wed.slice(0, 4) > String(new Date().getFullYear()) ? '[aria-label="Next year"]' : '[aria-label="Previous year"]');
    await setValue(page, '[data-testid=holiday-add-date]', wed);
    await setValue(page, '[data-testid=holiday-add-name]', 'Statehood Day');
    await click(page, '[data-testid=holiday-add-go]');
    await page.waitForSelector(`[data-testid=holiday-row][data-date="${wed}"]`);
    await waitForToastToClear(page);
    await page.goto(BASE_URL + '/timesheet', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=ts-holiday-row]');
    assert.match(await page.$eval('[data-testid=ts-holiday-row]', (el) => el.textContent), /Public holiday · Statehood Day/);
    assert.match(await page.$eval(`[data-testid=ts-day][data-date="${wed}"]`, (el) => el.textContent), /· holiday/);
    const expected = await page.$$eval('[data-testid=ts-expected] .ts-sum', (els) => els.map((el) => el.textContent));
    assert.equal(expected[2], '0');
    assert.match(await page.$eval('[data-testid=ts-expected]', (el) => el.textContent), /minus holidays/);
  });

  step('Copy from last year says what it did', async () => {
    await page.goto(BASE_URL + '/settings/holidays', { waitUntil: 'networkidle0' });
    await click(page, '[aria-label="Previous year"]');
    const last = Number(await page.$eval('[data-testid=holidays-year]', (el) => el.textContent));
    await setValue(page, '[data-testid=holiday-add-date]', `${last}-01-01`);
    await setValue(page, '[data-testid=holiday-add-name]', 'New Year');
    await click(page, '[data-testid=holiday-add-go]');
    await page.waitForSelector(`[data-testid=holiday-row][data-date="${last}-01-01"]`);
    await waitForToastToClear(page);
    await click(page, '[aria-label="Next year"]');
    await click(page, '[data-testid=holidays-copy]');
    await page.waitForSelector(`.toast::-p-text(Copied 1 holiday from ${last})`);
    await page.waitForSelector(`[data-testid=holiday-row][data-date="${last + 1}-01-01"]`);
  });

  step('Approvals: the deadline day and time, the live line, and "Submit by" in the Timesheet', async () => {
    await page.goto(BASE_URL + '/settings/approvals', { waitUntil: 'networkidle0' });
    await setValue(page, '[data-testid=deadline-day]', '4');
    await setValue(page, '[data-testid=deadline-time]', '15:30');
    await eventually(async () => {
      const t = await timesheet();
      return t.deadlineWeekday === 4 && t.deadlineTime === '15:30';
    });
    await page.waitForFunction(() => /is due Thu \d+ \w{3}, 15:30\./.test(document.querySelector('[data-testid=deadline-next]')?.textContent ?? ''));
    await click(page, '[data-setting=auto-submit] [role=switch]');
    assert.ok(await eventually(async () => (await timesheet()).autoSubmit === true));
    await page.goto(BASE_URL + '/timesheet', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.ts-due');
    assert.equal(await page.$eval('.ts-due', (el) => el.textContent), `Submit by ${label(addDays(monday, 3))}, 15:30`);
  });
});
