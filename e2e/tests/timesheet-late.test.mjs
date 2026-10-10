// Late status (CD-155): last week, after its deadline, says how long ago the deadline passed, the
// button reads Submit late and confirms "This week will be marked as submitted late.", and the
// week is then Late.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('timesheet late', () => {
  const browser = useBrowser();
  const step = steps(browser, 'timesheet-late');
  let page;
  let last;
  let employeeId;

  step('sets up hours last week', async () => {
    page = await browser.person('lou');
    await newUserWithWorkspace(page, { label: 'ts-late', name: 'Lou Late', workspace: 'Late Co' });
    const me = (await api(page, '/people/access')).employeeId;
    employeeId = me;
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Hidrogradnja' }) });
    const [type] = await api(page, '/project-types');
    const project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Engine overhaul', projectTypeId: type.id, companyId: company.id }) });
    const task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Inspect engine', assigneeIds: [me] }) });
    last = addDays((await api(page, '/timesheet/week')).thisWeek, -7);
    for (let i = 0; i < 5; i++) await api(page, '/timesheet/cells', { method: 'PUT', body: JSON.stringify({ date: addDays(last, i), taskId: task.id, minutes: 480 }) });
  });

  step('after the deadline: "Deadline passed", Submit late and its confirmation, then the Late badge', async () => {
    await page.goto(BASE_URL + '/timesheet?week=' + last, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=ts-deadline-passed]');
    assert.match(await page.$eval('[data-testid=ts-deadline-passed]', (el) => el.textContent), /^Deadline passed (yesterday|\d+ days ago)$/);
    assert.equal(await page.$eval('[data-testid=ts-submit]', (el) => el.textContent), 'Submit late');
    await click(page, '[data-testid=ts-submit]');
    await page.waitForSelector('[data-testid=confirm-dialog]');
    assert.match(await page.$eval('[data-testid=confirm-dialog]', (el) => el.textContent), /Submit week \d+ late\?This week will be marked as submitted late\./);
    await click(page, '[data-testid=confirm-ok]');
    await page.waitForSelector('[data-testid=ts-late]');
    assert.equal(await page.$eval('[data-testid=ts-status]', (el) => el.textContent), 'Submitted');
    assert.equal(await page.$('[data-testid=ts-deadline-passed]'), null);
  });

  step('the employee card shows the late week and fits at phone width', async () => {
    await page.goto(`${BASE_URL}/people/${employeeId}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=employee-timesheet]')?.textContent.includes('Late (12 months)'));
    const content = await page.$eval('[data-testid=employee-timesheet]', (el) => el.textContent);
    assert.match(content, /Late \(12 months\)1/);
    assert.match(content, /Recent late weeks/);
    assert.match(content, /First submitted:/);
    await page.setViewport({ width: 360, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.setViewport({ width: 1440, height: 900 });
  });
});
