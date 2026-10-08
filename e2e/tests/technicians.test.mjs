// Work type per person (CD-268, design v2 §8): Settings → Technicians changes it inline, the
// employee card shows the same field, and task pickers leave out Service people (Office and Both
// only).
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('technicians', () => {
  const browser = useBrowser();
  const step = steps(browser, 'technicians');
  let page;
  let crew;
  let project;

  step('sets up a colleague and a project', async () => {
    page = await browser.person('tess');
    await newUserWithWorkspace(page, { label: 'techs', name: 'Tess Techs', workspace: 'Techs Co' });
    await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: `crew-${Date.now()}@example.test`, role: 'member' }) });
    const me = (await api(page, '/people/access')).employeeId;
    crew = (await api(page, '/people/employees')).employees.find((e) => e.id !== me).id;
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) });
    const [type] = await api(page, '/project-types');
    project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Fit-out', projectTypeId: type.id, companyId: company.id }) });
  });

  step('Settings → Technicians: everyone starts as Office; the work type changes inline', async () => {
    await page.goto(BASE_URL + '/settings/technicians', { waitUntil: 'networkidle0' });
    await page.waitForSelector(`[data-testid=technician-row][data-employee="${crew}"]`);
    assert.match(await page.$eval('[data-testid=technicians]', (el) => el.textContent), /Work type decides what someone can be given/);
    assert.equal(await page.$eval(`[data-testid=technician-row][data-employee="${crew}"] [data-testid=work-type]`, (el) => el.value), 'office');
    await setValue(page, `[data-testid=technician-row][data-employee="${crew}"] [data-testid=work-type]`, 'service');
    await page.waitForFunction(() => document.body.innerText.includes('is Service now'));
    assert.equal((await api(page, '/people/employees/' + crew)).workType, 'service');
  });

  step('the employee card has the same field, and saves it', async () => {
    await page.goto(BASE_URL + '/people/' + crew, { waitUntil: 'networkidle0' });
    // An owner's card opens in edit mode.
    await page.waitForSelector('[data-testid=emp-work] select[name=workType]');
    assert.equal(await page.$eval('[data-testid=emp-work] select[name=workType]', (el) => el.value), 'service');
    await setValue(page, '[data-testid=emp-work] select[name=workType]', 'office');
    await click(page, 'button::-p-text(Save)');
    assert.ok(await eventually(async () => (await api(page, '/people/employees/' + crew)).workType === 'office'), 'saved from the card');
    await api(page, '/people/employees/' + crew, { method: 'PATCH', body: JSON.stringify({ workType: 'service' }) });
  });

  step('task pickers leave out Service people, and list them again as Both', async () => {
    const pickerHas = async () => {
      await page.goto(BASE_URL + '/tasks', { waitUntil: 'networkidle0' });
      await click(page, 'button::-p-text(New task)');
      await page.waitForSelector(`[data-testid=task-project] option[value="${project.id}"]`);
      await setValue(page, '[data-testid=task-project]', project.id);
      await page.waitForSelector('[data-testid=assign-list] label');
      const has = !!(await page.$(`[data-testid=assign-list] label[data-employee="${crew}"]`));
      await click(page, 'button::-p-text(Cancel)');
      return has;
    };
    assert.equal(await pickerHas(), false, 'Service: not for tasks');
    await api(page, '/people/employees/' + crew, { method: 'PATCH', body: JSON.stringify({ workType: 'both' }) });
    await waitForToastToClear(page);
    assert.equal(await pickerHas(), true, 'Both: tasks too');
  });
});
