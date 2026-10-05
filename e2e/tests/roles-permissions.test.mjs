// Roles and permissions (CD-142) and employee settings (CD-215): the owner sees the workspace and
// functional roles' matrices (the server's definition, later modules marked) and who has which role,
// gives a member Administration through "Add person" and takes it away; the member sees the tab
// read-only; Settings → Employees saves its three settings and is for Admins only; "Org changes"
// is a notification toggle; a manager makes visit plans only for their direct report and sees
// Reports, a member neither.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, createWorkspace, email, eventually, finishOnboarding, setValue, signIn, steps, text, useBrowser } from '../lib/harness.mjs';

describe('roles and permissions', () => {
  const browser = useBrowser();
  const step = steps(browser, 'roles');
  let olga;
  let mia;
  let max;
  const ids = {};

  async function join(page, label, name) {
    const { token } = await api(olga, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email(label), role: 'member' }) });
    await page.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(page, email(label), name);
    await clickButton(page, 'Accept and join');
    await finishOnboarding(page);
    return (await api(page, '/people/access')).employeeId;
  }
  const holderNames = (page, testId) => page.$$eval(`[data-testid=${testId}] [data-testid=role-holder]`, (rows) => rows.map((r) => r.textContent));

  step('an owner, a manager and their report share a workspace', async () => {
    olga = await browser.person('olga');
    await olga.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(olga, email('roles-olga'), 'Olga Owner');
    await createWorkspace(olga, 'Roles Co');
    max = await browser.person('max');
    ids.max = await join(max, 'roles-max', 'Max Manager');
    mia = await browser.person('mia');
    ids.mia = await join(mia, 'roles-mia', 'Mia Member');
    await api(olga, `/people/employees/${ids.mia}`, { method: 'PATCH', body: JSON.stringify({ managerId: ids.max }) });
  });

  step('the owner sees both matrices and who has which role', async () => {
    await olga.goto(`${BASE_URL}/settings/roles`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=perm-row]');
    const body = await text(olga);
    assert.ok(body.includes('Workspace roles') && body.includes('Make someone an owner or remove an owner'), 'workspace roles kept');
    assert.ok(body.includes('Functional roles') && body.includes('Assign Administration and Payroll'), 'functional matrix');
    // The same rows as the server's definition, later modules marked.
    const matrix = await api(olga, '/people/permissions');
    const rows = await olga.$$eval('[data-testid=perm-row]', (els) => els.map((e) => e.dataset.row));
    assert.deepEqual(rows, matrix.modules.flatMap((m) => m.rows.map((r) => r.id)));
    const coming = await olga.$$eval('[data-testid=perm-coming]', (els) => els.map((e) => e.textContent));
    assert.ok(coming.includes('Coming with Timesheet') && !coming.some((c) => c.includes('CRM')), coming.join(', '));
    const cell = await olga.$eval('[data-row="crm.visit_plans.manage"] [data-role=manager]', (el) => el.textContent);
    assert.equal(cell, 'Direct');
    await olga.waitForFunction(() => document.querySelector('[data-testid=holders-manager]')?.textContent.includes('Max Manager'));
    assert.ok((await holderNames(olga, 'holders-manager')).some((r) => r.includes('Max Manager') && r.includes('1 report')));
    assert.ok((await holderNames(olga, 'holders-admin')).some((r) => r.includes('Olga Owner')));
  });

  step('the owner gives the member Administration with "Add person"; it applies at once', async () => {
    await click(olga, '[data-testid=add-administration]');
    await click(olga, '[data-testid=add-administration-picker] .picker-search');
    await olga.type('[data-testid=add-administration-picker] .picker-search', 'Mia');
    await click(olga, '.picker-item::-p-text(Mia Member)');
    await olga.waitForFunction(() => document.querySelector('[data-testid=holders-administration]')?.textContent.includes('Mia Member'));
    const access = await eventually(async () => {
      const a = await api(mia, '/people/access');
      return a.roles.includes('administration') && a;
    });
    assert.deepEqual(access.roles, ['employee', 'administration']);
  });

  step('the member sees the tab read-only, with herself under Administration', async () => {
    await mia.goto(`${BASE_URL}/settings/roles`, { waitUntil: 'networkidle0' });
    await mia.waitForFunction(() => document.querySelector('[data-testid=holders-administration]')?.textContent.includes('Mia Member'));
    assert.equal(await mia.$$eval('[data-testid^=add-]', (els) => els.length), 0, 'no Add person');
    assert.equal(await mia.$$eval('[data-testid=role-holders] button[title^=Remove]', (els) => els.length), 0, 'no remove');
  });

  step('the owner removes the role again; the member’s list follows live', async () => {
    await click(olga, '[data-testid=holders-administration] button[title="Remove Mia Member"]');
    await olga.waitForFunction(() => !document.querySelector('[data-testid=holders-administration]')?.textContent.includes('Mia Member'));
    await mia.waitForFunction(() => !document.querySelector('[data-testid=holders-administration]')?.textContent.includes('Mia Member'), { timeout: 15_000 });
    assert.deepEqual((await api(mia, '/people/access')).roles, ['employee']);
  });

  step('Settings → Employees saves its settings; members have no such tab', async () => {
    await olga.goto(`${BASE_URL}/settings/employees`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=employee-default-hours]');
    await setValue(olga, '[data-testid=employee-default-hours]', '38');
    await click(olga, '[data-setting=number-required] [role=switch]');
    await olga.waitForSelector('[data-setting=number-required] [role=switch][aria-checked=true]');
    await click(olga, '[data-setting=self-edit-bank] [role=switch]');
    await olga.waitForSelector('[data-setting=self-edit-bank] [role=switch][aria-checked=false]');
    const saved = await eventually(async () => {
      const ws = await api(olga, '/workspace');
      return ws.employeeDefaultWeeklyHours === 38 && ws.employeeNumberRequired === true && ws.employeeSelfEditBank === false && ws;
    });
    assert.ok(saved, `saved: ${JSON.stringify(await api(olga, '/workspace'))}`);
    // Out of range is not saved.
    await setValue(olga, '[data-testid=employee-default-hours]', '0');
    assert.ok((await text(olga)).includes('Between 1 and 60 hours.'));
    await olga.reload({ waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=employee-default-hours]');
    assert.equal(await olga.$eval('[data-testid=employee-default-hours]', (el) => el.value), '38');
    assert.equal(await olga.$eval('[data-setting=number-required] [role=switch]', (el) => el.getAttribute('aria-checked')), 'true');

    await mia.goto(`${BASE_URL}/settings/employees`, { waitUntil: 'networkidle0' });
    await mia.waitForFunction(() => location.pathname === '/settings/workspace');
    const tabs = await mia.$$eval('button', (els) => els.map((b) => b.textContent.trim()));
    assert.ok(tabs.includes('Roles & permissions') && !tabs.includes('Employees'), tabs.join(', '));
  });

  step('"Org changes" is a notification toggle', async () => {
    await mia.goto(`${BASE_URL}/settings/notifications`, { waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-notification=org-changes] [role=switch]');
    assert.equal(await mia.$eval('[data-notification=org-changes] [role=switch]', (el) => el.getAttribute('aria-checked')), 'true');
    await click(mia, '[data-notification=org-changes] [role=switch]');
    assert.ok(await eventually(async () => (await api(mia, '/profile')).notifyOrgChanges === false), 'saved off');
  });

  step('a manager makes plans only for their direct report and sees Reports; the member neither', async () => {
    await max.goto(`${BASE_URL}/visit-plans`, { waitUntil: 'networkidle0' });
    await clickButton(max, 'New plan');
    await max.waitForSelector('[data-testid=plan-salesperson]');
    const options = await max.$$eval('[data-testid=plan-salesperson] option', (els) => els.map((o) => o.textContent).filter((t) => t && !/pick|choose|salesperson/i.test(t)));
    assert.deepEqual(options, ['Mia Member']);
    await clickButton(max, 'Cancel');
    assert.ok((await text(max)).includes('Reports'), 'Reports in the sidebar');

    await mia.goto(`${BASE_URL}/visit-plans`, { waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-testid=visit-plans-empty]');
    assert.ok(!(await text(mia)).includes('New plan'), 'no New plan for the member');
  });
});
