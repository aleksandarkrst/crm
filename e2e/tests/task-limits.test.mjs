// People and hours (CD-147 TC 5, 6, 10): the card under Details with stand-in hours (POST
// /api/dev/tasks/:id/hours until time entries), the Used bar's levels, "over" in red, the inline
// limit edit (Enter saves, Escape cancels) with its history row, and a limit set while assigning.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('task limits', () => {
  const browser = useBrowser();
  const step = steps(browser, 'task-limits');
  let page;
  let task;
  let me;
  let crew;

  const logHours = (hours) => api(page, `/dev/tasks/${task.id}/hours`, { method: 'POST', body: JSON.stringify({ employeeId: me, hours }) });
  const level = () => page.$eval(`[data-testid=hours-row][data-employee="${me}"] [data-testid=used-bar]`, (el) => el.getAttribute('data-level'));
  const reopen = async () => {
    await page.goto(BASE_URL + '/tasks/' + task.id, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`[data-testid=hours-row][data-employee="${me}"]`);
  };

  step('sets up a task with the owner on it, limit 10 h', async () => {
    page = await browser.person('lina');
    await newUserWithWorkspace(page, { label: 'limits', name: 'Lina Limits', workspace: 'Limits Co' });
    me = (await api(page, '/people/access')).employeeId;
    // An invited colleague (no account yet): listed in the org chart, so the picker offers them.
    await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: `crew-${Date.now()}@example.test`, role: 'member' }) });
    crew = (await api(page, '/people/employees')).employees.find((e) => e.id !== me).id;
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Delta Engines' }) });
    const [type] = await api(page, '/project-types');
    const project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Engine overhaul', projectTypeId: type.id, companyId: company.id }) });
    task = await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Overhaul engine 2' }) });
    await api(page, `/tasks/${task.id}/assignees`, { method: 'POST', body: JSON.stringify({ employeeIds: [me], hourLimits: { [me]: 10 } }) });
  });

  step('the Used bar: neutral at 7.75 of 10, amber at 8, red at 10 (TC 6)', async () => {
    await logHours(7.75);
    await reopen();
    assert.equal(await level(), 'neutral');
    await logHours(0.25);
    await reopen();
    assert.equal(await level(), 'amber');
    await logHours(2);
    await reopen();
    assert.equal(await level(), 'red');
    assert.match(await page.$eval('[data-testid=hours-total]', (el) => el.textContent), /Total10 h10 h0 h0 h/);
  });

  step('the lead edits the limit inline: Escape cancels, Enter saves; 8 h with 10.5 logged is "2.5 h over" (TC 5, TC 10)', async () => {
    await logHours(0.5);
    await reopen();
    await click(page, `[data-testid=hours-row][data-employee="${me}"] [data-testid=limit-edit]`);
    await page.$eval('[data-testid=limit-input]', (el) => el.select());
    await page.type('[data-testid=limit-input]', '7.3');
    await page.waitForFunction(() => document.querySelector('[data-testid=people-hours]')?.textContent.includes('Use steps of 0.25 h'));
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=limit-edit]');
    await waitForToastToClear(page);
    await click(page, `[data-testid=hours-row][data-employee="${me}"] [data-testid=limit-edit]`);
    await page.$eval('[data-testid=limit-input]', (el) => el.select());
    await page.type('[data-testid=limit-input]', '8');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=hours-remaining]')?.textContent === '2.5 h over');
    const color = await page.$eval('[data-testid=hours-remaining]', (el) => getComputedStyle(el).color);
    assert.equal(color, 'rgb(180, 35, 24)');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=change-row]')].some((r) => r.textContent.includes('Hour limit for Lina Limits: 10 h → 8 h')));
  });

  step('assigning someone asks for their limit; a wrong one stops it', async () => {
    await click(page, '[data-testid=add-assignee]');
    await page.waitForSelector(`[data-testid=assign-list] label[data-employee="${crew}"]`);
    await click(page, `[data-testid=assign-list] label[data-employee="${crew}"] input`);
    await page.waitForSelector('[data-testid=assign-limit]');
    await page.type('[data-testid=assign-limit]', '0.1');
    await page.waitForFunction(() => document.querySelector('[data-testid=assign-submit]')?.disabled);
    await page.$eval('[data-testid=assign-limit]', (el) => el.select());
    await page.type('[data-testid=assign-limit]', '6');
    await click(page, '[data-testid=assign-submit]');
    await page.waitForFunction((id) => document.querySelector(`[data-testid=hours-row][data-employee="${id}"]`)?.textContent.includes('6 h'), {}, crew);
    // Both have a limit: the task limit is their sum.
    await page.waitForFunction(() => document.querySelector('[data-testid=hours-total]')?.textContent.startsWith('Total14 h'));
  });
});
