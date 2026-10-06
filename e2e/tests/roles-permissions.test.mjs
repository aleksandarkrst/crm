// Roles and permissions (CD-142) and employee settings (CD-215): the owner sees the workspace roles
// (the functional matrix and "Who has which role" went with Administration and Payroll, CD-225) and
// invites someone from the Team tab without functional roles to tick; Settings → Employees saves
// its three settings and is for Admins only; "Org changes" is a notification toggle; a manager
// makes visit plans only for their direct report and sees Reports, a member neither.
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

  step('the owner sees the workspace roles; no functional matrix or "Who has which role" (CD-225)', async () => {
    await olga.goto(`${BASE_URL}/settings/roles`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=workspace-roles]');
    const body = await text(olga);
    assert.ok(body.includes('Workspace roles') && body.includes('Make someone an owner or remove an owner'), 'workspace roles kept');
    assert.equal(await olga.$('[data-testid=functional-roles]'), null);
    assert.equal(await olga.$('[data-testid=role-holders]'), null);
    // The server still defines the matrix: Employee, Manager and Admin, without open spec questions in its labels (B16).
    const matrix = await api(olga, '/people/permissions');
    assert.deepEqual(matrix.roles.map((r) => r.id), ['employee', 'manager', 'admin']);
    const labels = matrix.modules.flatMap((m) => m.rows.flatMap((r) => Object.values(r.cells).map((c) => c.label)));
    assert.ok(!labels.some((l) => /\(Q\d+\)/.test(l)), labels.filter((l) => /\(Q/.test(l)).join(', '));
  });

  step('the Team tab invites without functional roles; the new member is an Employee', async () => {
    const hana = await browser.person('hana');
    await olga.goto(`${BASE_URL}/settings/team`, { waitUntil: 'networkidle0' });
    await clickButton(olga, 'Invite member');
    await olga.type('input[placeholder="name@company.com"]', email('roles-hana'));
    assert.equal(await olga.$('[data-testid=invite-roles]'), null, 'no Administration / Payroll checkboxes');
    await clickButton(olga, 'Send invitation');
    const link = await (await olga.waitForSelector('input[readonly]')).evaluate((el) => el.value);
    await clickButton(olga, 'Done');
    const invitation = (await api(olga, '/team')).invitations.find((i) => i.email === email('roles-hana'));
    assert.equal(invitation.assignedRoles, undefined);

    await hana.goto(link, { waitUntil: 'networkidle0' });
    await signIn(hana, email('roles-hana'), 'Hana Member');
    await clickButton(hana, 'Accept and join');
    await finishOnboarding(hana);
    const access = await api(hana, '/people/access');
    assert.deepEqual(access.roles, ['employee']);
    ids.hana = access.employeeId;
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
