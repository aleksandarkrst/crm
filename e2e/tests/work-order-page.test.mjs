// The work order page (CD-266, design v2 §6): opened from the list; header with the meta line, Put
// on hold (reason), Mark completed and Reopen; Details; Schedule with technicians (Service and Both
// only, one lead); the shared checklist; Report and sign-off (needs the customer's name); history.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

describe('work order page', () => {
  const browser = useBrowser();
  const step = steps(browser, 'work-order-page');
  let page;
  let me;
  let crew;
  let order;

  step('sets up a scheduled work order', async () => {
    page = await browser.person('willa');
    await newUserWithWorkspace(page, { label: 'wo-page', name: 'Willa Works', workspace: 'Works Co' });
    me = (await api(page, '/people/access')).employeeId;
    await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: `crew-${Date.now()}@example.test`, role: 'member' }) });
    crew = (await api(page, '/people/employees')).employees.find((e) => e.id !== me).id;
    for (const id of [me, crew]) await api(page, '/people/employees/' + id, { method: 'PATCH', body: JSON.stringify({ workType: 'service' }) });
    const company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Northwind Logistics' }) });
    order = await api(page, '/work-orders', {
      method: 'POST',
      body: JSON.stringify({ title: 'Install 3 split AC units', companyId: company.id, technicianIds: [me], scheduledDate: '2026-11-04', scheduledStart: '08:00', durationHours: 8 }),
    });
  });

  step('opens from the list: crumb, meta line and the status bar', async () => {
    await page.goto(BASE_URL + '/work-orders', { waitUntil: 'networkidle0' });
    await click(page, `[data-work-order="WO-${order.number}"] a`);
    await page.waitForSelector('[data-testid=work-order-page]');
    assert.match(await page.$eval('.deal-crumb', (el) => el.textContent), new RegExp(`Work orders→WO-${order.number}`));
    assert.match(await page.$eval('[data-testid=work-order-meta]', (el) => el.textContent), /Northwind Logistics · Willa Works · Wed 4 Nov, 08:00–16:00/);
    assert.equal(await page.$eval('[data-testid=work-order-status-bar] .current', (el) => el.textContent), 'Scheduled');
  });

  step('Put on hold asks why; Mark completed, then Reopen', async () => {
    await click(page, '[data-testid=hold-work-order]');
    await click(page, '[data-testid=hold-reasons] button::-p-text(Waiting for parts)');
    await click(page, '[data-testid=confirm-hold]');
    await page.waitForSelector('[data-testid=hold-box]');
    await waitForToastToClear(page);
    await click(page, '[data-testid=complete-work-order]');
    await page.waitForSelector('[data-testid=reopen-work-order]');
    assert.equal((await api(page, '/work-orders/' + order.id)).status, 'completed');
    await click(page, '[data-testid=reopen-work-order]');
    await page.waitForFunction(() => document.querySelector('[data-testid=work-order-status-bar] .current')?.textContent === 'In progress');
  });

  step('Details: where, equipment', async () => {
    await setValue(page, '[data-testid=work-order-place]', 'workshop');
    await page.$eval('[data-testid=work-order-equipment]', (el) => el.focus());
    await page.type('[data-testid=work-order-equipment]', '3 × split unit 3.5 kW');
    await page.keyboard.press('Enter');
    assert.ok(await eventually(async () => {
      const w = await api(page, '/work-orders/' + order.id);
      return w.workPlace === 'workshop' && w.equipment === '3 × split unit 3.5 kW';
    }));
  });

  step('Schedule: add a technician (Service people only) and make them the lead', async () => {
    await waitForToastToClear(page);
    await click(page, '[data-testid=add-technician]');
    await page.waitForSelector(`[data-testid=assign-list] label[data-employee="${crew}"]`);
    await click(page, `[data-testid=assign-list] label[data-employee="${crew}"] input`);
    await click(page, '[data-testid=add-technician-submit]');
    await page.waitForSelector(`[data-testid=work-order-technicians] [data-employee="${crew}"]`);
    await click(page, `[data-testid=work-order-technicians] [data-employee="${crew}"] .chip-action`);
    assert.ok(await eventually(async () => (await api(page, '/work-orders/' + order.id)).technicians.find((t) => t.isLead)?.employeeId === crew));
  });

  step('the checklist works as on tasks', async () => {
    await page.type('[data-testid=checklist-input]', 'Check the refrigerant');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid=checklist-count]')?.textContent === '0 of 1');
    await click(page, '[data-testid=checklist-item] [role=checkbox]');
    await page.waitForFunction(() => document.querySelector('[data-testid=checklist-count]')?.textContent === '1 of 1');
  });

  step("Report and sign-off: the customer's name first, then sign off and undo", async () => {
    assert.ok(await page.$eval('[data-testid=sign-off]', (el) => el.disabled), 'no name, no sign-off');
    await page.$eval('[data-testid=work-order-customer]', (el) => el.focus());
    await page.type('[data-testid=work-order-customer]', 'Petra Customer');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[data-testid=sign-off]')?.disabled);
    await click(page, '[data-testid=sign-off]');
    await page.waitForSelector('[data-testid=signed-off]');
    assert.match(await page.$eval('[data-testid=signed-off]', (el) => el.textContent), /Signed off by Petra Customer/);
    await click(page, '[data-testid=signed-off] button');
    await page.waitForSelector('[data-testid=sign-off]');
  });

  step('the history names the changes', async () => {
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('[data-testid=change-row]')].map((r) => r.textContent);
      return rows.some((t) => t.includes('Where: At the customer → In the workshop')) && rows.some((t) => t.includes('leads the work order now'));
    });
  });
});
