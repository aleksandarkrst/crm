// Departments and teams (CD-138, CD-139): an Admin opens "Departments & teams" from the Org
// structure header, adds a department and a team, renames the team inline, adds people (the
// manager is prefilled with the department head), sets a team lead with "Make team members report
// to <lead>", moves the team, and deletes with confirmations that name the members. A change made
// elsewhere shows up without a reload, and the panel works on a phone. CD-225: a head or lead is put
// in their department or team; a department added in the panel is offered on a card at once; the
// head shows once on the chart; moving the head elsewhere asks first.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, createWorkspace, email, eventually, setValue, signIn, steps, text, useBrowser } from '../lib/harness.mjs';

describe('departments and teams', () => {
  const browser = useBrowser();
  const step = steps(browser, 'departments-teams');
  let page;
  const id = {};
  /** Messages of the browser dialogs (the harness accepts them all). */
  const dialogs = [];

  // Invited in Settings → Team (the API), which creates their record (CD-226); then their names.
  const person = async (firstName, lastName) => {
    const { invitation } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email(`dt-${firstName}-${lastName}`.toLowerCase()), role: 'member' }) });
    await api(page, `/people/employees/${invitation.employeeId}`, { method: 'PATCH', body: JSON.stringify({ firstName, lastName, employmentStartDate: '2024-03-01' }) });
    return invitation.employeeId;
  };
  const employee = (employeeId) => api(page, `/people/employees/${employeeId}`);
  const openPanel = async () => {
    await page.goto(`${BASE_URL}/org`, { waitUntil: 'networkidle0' });
    await clickButton(page, 'Departments & teams');
    await page.waitForSelector('[data-testid=departments-list]');
  };
  const inRow = (testId, label) => click(page, `[data-testid="${testId}"] > .dtp-row button::-p-text(${label})`);

  step('an Admin with four employees opens the panel from the Org structure page', async () => {
    page = await browser.person('dora');
    page.on('dialog', (d) => dialogs.push(d.message()));
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(page, email('dtp-dora'), 'Dora Director');
    await createWorkspace(page, 'Org Co');
    id.head = await person('Hana', 'Head');
    id.lead = await person('Luka', 'Lead');
    id.ana = await person('Ana', 'Tech');
    id.bojan = await person('Bojan', 'Tech');
    await openPanel();
    assert.match(await text(page), /No departments yet/);
  });

  step('adds a department with a head and a team, and renames the team inline', async () => {
    await clickButton(page, 'Add department');
    await page.type('input[aria-label="Department name"]', 'Service');
    await page.type('input[aria-label="Code"]', 'SRV');
    await setValue(page, 'select[aria-label="Department head"]', id.head);
    await click(page, 'button[type=submit]::-p-text(Add department)');
    await page.waitForSelector('[data-testid="department-Service"]');
    // The head is put in the department (CD-225).
    assert.match(await page.$eval('[data-testid="department-Service"]', (el) => el.textContent), /SRV.*Head: Hana Head · 1 person · 0 teams/);
    assert.equal((await employee(id.head)).departmentName, 'Service');

    await inRow('department-Service', 'Add team');
    await page.type('input[aria-label="Team name"]', 'Service Belgrade');
    await click(page, 'button[type=submit]::-p-text(Add team)');
    await page.waitForSelector('[data-testid="team-Service Belgrade"]');

    await click(page, '.dtp-name::-p-text(Service Belgrade)');
    await page.waitForSelector('input[aria-label="Team name"]');
    await page.$eval('input[aria-label="Team name"]', (el) => el.select());
    await page.type('input[aria-label="Team name"]', 'Service BG');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="team-Service BG"]');
    const teams = await api(page, '/people/teams');
    assert.deepEqual(teams.map((t) => t.name), ['Service BG']);
    id.team = teams[0].id;
  });

  step('adds people to the team; Reports to is prefilled with the department head', async () => {
    await click(page, '[data-testid="team-Service BG"] button::-p-text(Add people)');
    await page.waitForSelector('input[aria-label="Search people"]');
    await page.type('input[aria-label="Search people"]', 'tech');
    await click(page, 'label.dtp-candidate::-p-text(Ana Tech)');
    await click(page, 'label.dtp-candidate::-p-text(Bojan Tech)');
    await page.waitForSelector('select[aria-label="Reports to for Ana Tech"]');
    await page.waitForSelector('select[aria-label="Reports to for Bojan Tech"]');
    assert.equal(await page.$eval('select[aria-label="Reports to for Ana Tech"]', (s) => s.value), id.head, 'prefilled: the team has no lead, so the head');
    // The user changes one before saving.
    await setValue(page, 'select[aria-label="Reports to for Bojan Tech"]', '');
    await clickButton(page, 'Add 2 people');
    await page.waitForFunction(() => document.querySelectorAll('.modal').length === 1);
    const ana = await employee(id.ana);
    assert.equal(ana.teamId, id.team);
    assert.equal(ana.manager?.id, id.head);
    const bojan = await employee(id.bojan);
    assert.equal(bojan.teamId, id.team);
    assert.equal(bojan.manager, null);
    await page.waitForFunction(() => /2 people/.test(document.querySelector('[data-testid="team-Service BG"]')?.textContent ?? ''));
  });

  step('sets a team lead and makes the members report to them', async () => {
    await click(page, '[data-testid="team-Service BG"] button::-p-text(Set lead)');
    await page.waitForSelector('select[aria-label="Team lead"]');
    await setValue(page, 'select[aria-label="Team lead"]', id.lead);
    await page.waitForSelector('label.dtp-check::-p-text(Make team members report to Luka Lead)');
    assert.equal(await page.$eval('label.dtp-check input', (c) => c.checked), true, 'ticked by default');
    assert.match(await page.$eval('label.dtp-check', (el) => el.textContent), /Bojan Tech has no manager or reported to the previous lead/);
    await clickButton(page, 'Save');
    await page.waitForFunction(() => document.querySelectorAll('.modal').length === 1);
    assert.equal((await employee(id.bojan)).manager?.id, id.lead, 'Bojan had no manager: now the lead');
    assert.equal((await employee(id.ana)).manager?.id, id.head, 'Ana reported to someone else: unchanged');
    // The lead is put in the team (CD-225).
    await page.waitForFunction(() => /Lead: Luka Lead · 3 people/.test(document.querySelector('[data-testid="team-Service BG"]')?.textContent ?? ''));
    assert.equal((await employee(id.lead)).teamId, id.team);
  });

  step('a department added elsewhere shows up without a reload; the team moves there with its members', async () => {
    await api(page, '/people/departments', { method: 'POST', body: JSON.stringify({ name: 'Sales' }) });
    await page.waitForSelector('[data-testid="department-Sales"]');

    await click(page, '[data-testid="team-Service BG"] button::-p-text(Move)');
    await page.waitForSelector('.dtp-note');
    assert.equal(await page.$eval('.dtp-note', (el) => el.textContent), '3 employees move to Sales: Luka Lead, Ana Tech and Bojan Tech.');
    await clickButton(page, 'Move to Sales');
    await page.waitForFunction(() => document.querySelectorAll('.modal').length === 1);
    const departments = await api(page, '/people/departments');
    const sales = departments.find((d) => d.name === 'Sales');
    assert.equal((await employee(id.ana)).departmentId, sales.id);
    assert.ok(await eventually(async () => /3 people · 1 team/.test(await page.$eval('[data-testid="department-Sales"]', (el) => el.textContent))));
  });

  step('deleting: a department with teams says so; a team names its members, who stay in the department', async () => {
    await inRow('department-Sales', 'Delete');
    await page.waitForSelector('.modal-sub::-p-text(Delete them or move them)');
    assert.match(await text(page), /Sales has 1 team \(Service BG\)\. Delete them or move them to another department first\./);
    assert.equal(await page.$('button::-p-text(Delete department)'), null, 'no way to delete it');
    await click(page, '.modal-actions button::-p-text(Close)');

    await inRow('department-Sales', 'Add team'); // expands it
    await click(page, '[data-testid="team-Service BG"] button::-p-text(Delete)');
    await page.waitForSelector('.modal-sub::-p-text(stay in Sales without a team)');
    assert.match(await text(page), /Its 3 members stay in Sales without a team: Luka Lead, Ana Tech and Bojan Tech\./);
    await clickButton(page, 'Delete team');
    await page.waitForFunction(() => !document.querySelector('[data-testid="team-Service BG"]'));
    const ana = await employee(id.ana);
    assert.equal(ana.teamId, null);
    assert.equal(ana.departmentName, 'Sales');

    await inRow('department-Service', 'Delete');
    await page.waitForSelector('.modal-sub::-p-text(will have no department)');
    assert.match(await text(page), /Its 1 member will have no department: Hana Head\./);
    await clickButton(page, 'Delete department');
    await page.waitForFunction(() => !document.querySelector('[data-testid="department-Service"]'));
  });

  step("a department added in the panel is offered in a card's Department field at once", async () => {
    await page.goto(`${BASE_URL}/org`, { waitUntil: 'networkidle0' });
    // Open a card first (its pickers load), then come back without reloading the app.
    await click(page, `[data-testid=org-person][data-id="${id.ana}"]`);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=emp-work] select[name=departmentId] option')].some((o) => o.textContent === 'Sales'));
    await click(page, 'a.header-parent');
    await page.waitForFunction(() => location.pathname === '/org');
    await clickButton(page, 'Departments & teams');
    await clickButton(page, 'Add department');
    await page.type('input[aria-label="Department name"]', 'Field');
    await setValue(page, 'select[aria-label="Department head"]', id.head);
    await click(page, 'button[type=submit]::-p-text(Add department)');
    await page.waitForSelector('[data-testid="department-Field"]');
    await click(page, '.dtp-panel-head button::-p-text(Close)');
    await click(page, `[data-testid=org-person][data-id="${id.ana}"]`);
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=emp-work] select[name=departmentId] option')].some((o) => o.textContent === 'Field'));
    id.field = (await api(page, '/people/departments')).find((d) => d.name === 'Field').id;
  });

  step('the head shows once, at the top of their department on the chart', async () => {
    await click(page, 'a.header-parent');
    await page.waitForSelector('[data-testid=org-chart-department]');
    const field = `[data-testid=org-dept][data-dept="${id.field}"]`;
    await page.waitForSelector(`${field} [data-testid=org-person][data-id="${id.head}"]`);
    assert.equal((await page.$$(`${field} [data-testid=org-person][data-id="${id.head}"]`)).length, 1, 'Hana once');
    assert.equal(await page.$eval(`${field} .org-dept-headperson .org-badge`, (e) => e.textContent), 'Head');
    assert.equal(await page.$(`${field} [data-testid=org-team]`), null, 'no "No team" box just for the head');
  });

  step('moving the head to another department asks first, then removes them as head', async () => {
    await click(page, `[data-testid=org-person][data-id="${id.head}"]`);
    await page.waitForSelector('[data-testid=emp-work] select[name=departmentId]');
    const sales = (await api(page, '/people/departments')).find((d) => d.name === 'Sales').id;
    await page.waitForFunction((sales) => !!document.querySelector(`[data-testid=emp-work] select[name=departmentId] option[value="${sales}"]`), {}, sales);
    await setValue(page, '[data-testid=emp-work] select[name=departmentId]', sales);
    const before = dialogs.length;
    await click(page, '[data-testid=emp-save]');
    await page.waitForSelector('[data-testid=emp-save]:not([data-dirty])');
    assert.deepEqual(dialogs.slice(before), ['Hana Head is head of Field. Moving them to Sales removes them as head of Field. Continue?']);
    assert.equal((await employee(id.head)).departmentName, 'Sales');
    assert.equal((await api(page, '/people/departments')).find((d) => d.name === 'Field').headEmployeeId, null);
  });

  step('the panel fits a phone', async () => {
    await page.setViewport({ width: 375, height: 800 });
    await openPanel();
    await page.waitForSelector('[data-testid="department-Sales"]');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 375 px');
    const box = await page.$eval('[data-testid="department-Sales"] .dtp-actions', (el) => el.getBoundingClientRect().right);
    assert.ok(box <= 376, 'the actions wrap inside the screen');
    await page.setViewport({ width: 1400, height: 1100 });
  });
});
