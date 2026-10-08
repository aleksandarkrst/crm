// Work orders (CD-265, design v2 §5): the New work order dialog lists only Service and Both people,
// a work order with a technician, a date and a start lands in Scheduled, and the table changes the
// status (On hold asks why).
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, useBrowser } from '../lib/harness.mjs';

describe('work orders', () => {
  const browser = useBrowser();
  const step = steps(browser, 'work-orders');
  let page;
  let crew;
  let me;
  let company;

  step('sets up a service colleague and a company', async () => {
    page = await browser.person('wanda');
    await newUserWithWorkspace(page, { label: 'orders', name: 'Wanda Orders', workspace: 'Orders Co' });
    await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: `tech-${Date.now()}@example.test`, role: 'member' }) });
    me = (await api(page, '/people/access')).employeeId;
    crew = (await api(page, '/people/employees')).employees.find((e) => e.id !== me).id;
    await api(page, '/people/employees/' + crew, { method: 'PATCH', body: JSON.stringify({ workType: 'service' }) });
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Northwind' }) });
  });

  step('New work order: only service people are listed; with a time it is Scheduled', async () => {
    await page.goto(BASE_URL + '/work-orders', { waitUntil: 'networkidle0' });
    await click(page, 'button::-p-text(New work order)');
    await page.waitForSelector('[data-testid=technician-list] label');
    assert.ok(await page.$(`[data-testid=technician-list] label[data-employee="${crew}"]`), 'Service person listed');
    assert.equal(await page.$(`[data-testid=technician-list] label[data-employee="${me}"]`), null, 'Office person left out');
    await setValue(page, '[data-testid=work-order-title]', 'Replace the compressor');
    await setValue(page, '[data-testid=work-order-company]', company.id);
    await setValue(page, '[data-testid=work-order-priority]', 'urgent');
    await setValue(page, '[data-testid=work-order-date]', '2026-10-12');
    await setValue(page, '[data-testid=work-order-start]', '08:30');
    await click(page, `[data-testid=technician-list] label[data-employee="${crew}"] input`);
    await click(page, '[data-testid=create-work-order-submit]');
    await page.waitForSelector('[data-testid=work-order-card]');
    const where = await page.$eval('[data-testid=work-order-card]', (el) => ({ column: el.closest('[data-testid=work-order-column]').dataset.column, text: el.textContent }));
    assert.equal(where.column, 'Scheduled');
    assert.match(where.text, /WO-1001/);
    assert.match(where.text, /Urgent/);
    assert.match(where.text, /Northwind/);
  });

  step('without technicians it is Unscheduled', async () => {
    await api(page, '/work-orders', { method: 'POST', body: JSON.stringify({ title: 'Inspect the boiler', companyId: company.id, type: 'inspection' }) });
    assert.ok(
      await eventually(async () => {
        await page.goto(BASE_URL + '/work-orders', { waitUntil: 'networkidle0' });
        return (await page.$$eval('[data-column="Unscheduled"] [data-testid=work-order-card]', (els) => els.length)) === 1;
      }),
      'in the Unscheduled column',
    );
  });

  step('the table changes the status; On hold asks why', async () => {
    await click(page, '[data-testid=work-orders-view-table]');
    const row = '[data-testid=work-orders-row][data-work-order="WO-1001"]';
    await page.waitForSelector(row);
    await setValue(page, `${row} [data-testid=work-order-status-select]`, 'on_hold');
    await click(page, 'button::-p-text(Waiting for parts)');
    await click(page, '[data-testid=confirm-hold]');
    assert.ok(await eventually(async () => (await api(page, '/work-orders')).find((w) => w.number === 1001).holdReason === 'Waiting for parts'), 'on hold with the reason');
    await setValue(page, `${row} [data-testid=work-order-status-select]`, 'completed');
    assert.ok(await eventually(async () => (await api(page, '/work-orders')).find((w) => w.number === 1001).status === 'completed'), 'completed');
  });
});
