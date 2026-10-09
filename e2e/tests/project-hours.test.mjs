// Logged hours on projects (CD-277, design Timesheet.dc.html#cd-277): the company page's Projects
// card (the hours line, each project's month and total against its budget), the Projects table's
// This month and Logged / budget columns, and "this month" on the board's cards.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

describe('project hours', () => {
  const browser = useBrowser();
  const step = steps(browser, 'project-hours');
  let page;
  let company;
  let project;

  step('sets up a project with a 10 h budget and 6 h logged today', async () => {
    page = await browser.person('hana');
    await newUserWithWorkspace(page, { label: 'project-hours', name: 'Hana Hours', workspace: 'Hours Projects' });
    const me = (await api(page, '/people/access')).employeeId;
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Kovin Pančevo' }) });
    const [type] = await api(page, '/project-types');
    project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Service contract 2026', projectTypeId: type.id, companyId: company.id, budgetHours: 10 }) });
    const task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Hydraulic leak', assigneeIds: [me] }) });
    const today = (await api(page, '/timesheet/week')).today;
    await api(page, '/timesheet/cells', { method: 'PUT', body: JSON.stringify({ date: today, taskId: task.id, minutes: 360 }) });
  });

  step("the company's Projects card", async () => {
    await page.goto(BASE_URL + '/companies/' + company.id, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=company-projects-hours]');
    assert.equal(await page.$eval('[data-testid=company-projects-hours]', (el) => el.textContent), '6 h this month · 6 h total');
    assert.equal(await page.$eval('[data-testid=company-project-month]', (el) => el.textContent), '6 h this month');
    assert.equal(await page.$eval('[data-testid=company-project-total]', (el) => el.textContent), '6 of 10 h');
  });

  step('the Projects table and the board', async () => {
    await page.goto(BASE_URL + '/projects', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=project-card-month]');
    assert.equal(await page.$eval('[data-testid=project-card-month]', (el) => el.textContent), '6 h this month');
    await click(page, '[data-testid=projects-view-list]');
    await page.waitForSelector('[data-testid=projects-row] [data-testid=project-logged]');
    assert.equal(await page.$eval('[data-testid=projects-row] [data-testid=project-month]', (el) => el.textContent), '6 h');
    assert.match(await page.$eval('[data-testid=projects-row] [data-testid=project-logged]', (el) => el.textContent), /^6 \/ 10 h$/);
  });
});
