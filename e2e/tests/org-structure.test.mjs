// Org structure (CD-137): an owner's org of four levels in both chart modes and in the list,
// sorting, filters (department, team, manager direct and including indirect), the accent-free
// search ("petrovic" finds Petrović), the bulk actions with the loop refused, Ctrl K opening an
// employee's card, a member's narrower columns, and a phone without sideways scrolling.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, email, finishOnboarding, newUserWithWorkspace, setValue, signIn, steps, text, useBrowser } from '../lib/harness.mjs';

/**
 * Departments and teams have no API yet (CD-138 adds it), so they are made in SQL as the admin
 * role, like the backend's people tests do (CI sets PGHOST and PGPASSWORD for psql).
 */
function sql(query) {
  const user = process.env.POSTGRES_USER || 'app_admin';
  const db = process.env.POSTGRES_DB || 'app';
  return execFileSync('psql', ['-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-qtA', '-c', query], { encoding: 'utf8' }).trim();
}

describe('org structure', () => {
  const browser = useBrowser();
  const step = steps(browser, 'org-structure');
  let page;
  let tenant;
  const id = {};
  const dept = {};

  /** Names in the list, top to bottom. */
  const listNames = () => page.$$eval('[data-testid=org-row] .org-cell[data-col=name] .org-cell-ellipsis', (els) => els.map((e) => e.textContent.trim()));
  const count = () => page.$eval('[data-testid=org-count]', (e) => e.textContent);
  const openOrg = async (query = '') => {
    await page.goto(`${BASE_URL}/org${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /\d+ employees?$/.test(document.querySelector('[data-testid=org-count]')?.textContent ?? ''));
  };
  const card = (who) => api(page, `/people/employees/${who}`);

  step('an owner sets up a four-level org', async () => {
    page = await browser.person('olga');
    await newUserWithWorkspace(page, { label: 'org-olga', name: 'Olga Owner', workspace: 'Org Co' });
    tenant = await page.evaluate(() => localStorage.getItem('crm.tenantId'));
    const ins = (table, cols, vals) => sql(`insert into ${table} (tenant_id, ${cols}) values ('${tenant}', ${vals}) returning id`);
    dept.sales = ins('departments', 'name', `'Sales'`);
    dept.service = ins('departments', 'name', `'Service'`);
    dept.north = ins('teams', 'department_id, name', `'${dept.sales}', 'North'`);
    dept.south = ins('teams', 'department_id, name', `'${dept.sales}', 'South'`);
    const create = async (key, firstName, lastName, extra) =>
      (id[key] = (await api(page, '/people/employees', { method: 'POST', body: JSON.stringify({ firstName, lastName, employmentStartDate: '2024-03-01', ...extra }) })).id);
    // Ana → Marko → Ivan → Mila and Sara; Petar without a manager in Service.
    await create('ana', 'Ana', 'Petrović', { jobTitle: 'CEO', departmentId: dept.sales });
    await create('marko', 'Marko', 'Ilić', { jobTitle: 'Sales director', teamId: dept.north, managerId: id.ana });
    await create('ivan', 'Ivan', 'Jović', { jobTitle: 'Team lead', teamId: dept.north, managerId: id.marko });
    await create('mila', 'Mila', 'Kostić', { jobTitle: 'Sales rep', teamId: dept.north, managerId: id.ivan });
    await create('sara', 'Sara', 'Nikolić', { jobTitle: 'Sales rep', teamId: dept.south, managerId: id.ivan });
    await create('petar', 'Petar', 'Lukić', { jobTitle: 'Technician', departmentId: dept.service });
    id.olga = (await api(page, '/people/access')).employeeId;
  });

  step('Workforce opens "Org structure", its sidebar page; the chart shows everyone by department', async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    // Each module has its own sidebar (CD-223): Org structure is in Workforce's.
    assert.equal(await page.$('.app-sidebar a[href="/org"]'), null, 'not in the CRM sidebar');
    await click(page, '[data-testid=module-switcher]');
    await click(page, '[data-testid=module-switcher-pop] [data-module=workforce]');
    await page.waitForFunction(() => location.pathname === '/org');
    await page.waitForSelector('.app-sidebar a[href="/org"].active');
    await page.waitForSelector('[data-testid=org-chart-department]');
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]')?.textContent === '7 employees');
    const columns = await page.$$eval('[data-testid=org-dept]', (els) => els.map((e) => [e.querySelector('.org-dept-name').textContent, [...e.querySelectorAll('[data-testid=org-person]')].map((p) => p.querySelector('.org-person-name').firstChild.textContent)]));
    assert.deepEqual(columns, [
      ['Sales', ['Marko Ilić', 'Ivan Jović', 'Mila Kostić', 'Sara Nikolić', 'Ana Petrović']],
      ['Service', ['Petar Lukić']],
      ['No department', ['Olga Owner']],
    ]);
    const teams = await page.$$eval('[data-testid=org-dept]:first-child [data-testid=org-team] .org-team-name', (els) => els.map((e) => e.textContent));
    assert.deepEqual(teams, ['North', 'South', 'No team']);
    // Data issues for Admins: Petar and Ana have no manager.
    assert.ok((await page.$$('[data-testid=org-person][data-id="' + id.petar + '"] [data-testid=org-issue]')).length === 1);
  });

  step('reporting lines: two levels open, expand and collapse, search opens the path', async () => {
    await click(page, '[data-testid=org-mode-reporting]');
    await page.waitForSelector('[data-testid=org-chart-reporting]');
    assert.match(page.url(), /mode=reporting/);
    const shown = () => page.$$eval('[data-testid=org-chart-reporting] [data-testid=org-person]', (els) => els.map((e) => e.dataset.id));
    let ids = await shown();
    assert.ok(ids.includes(id.ana) && ids.includes(id.marko) && ids.includes(id.ivan), 'three levels visible');
    assert.ok(!ids.includes(id.mila), 'the fourth level starts closed');
    await click(page, `[data-testid=org-node][data-id="${id.ivan}"] > .org-node [data-testid=org-node-toggle]`);
    await page.waitForSelector(`[data-testid=org-person][data-id="${id.mila}"]`);
    await click(page, `[data-testid=org-node][data-id="${id.marko}"] > .org-node [data-testid=org-node-toggle]`);
    await page.waitForFunction((ivan) => !document.querySelector(`[data-testid=org-person][data-id="${ivan}"]`), {}, id.ivan);

    // The search opens the way to Mila and highlights her; the others are dimmed.
    await page.type('[data-testid=org-search]', 'kostic');
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]').textContent === '1 employee');
    await page.waitForSelector(`[data-testid=org-person][data-id="${id.mila}"].is-hit`);
    assert.ok(await page.$(`[data-testid=org-person][data-id="${id.ana}"].is-dim`), 'Ana is dimmed, not hidden');
    ids = await shown();
    assert.ok(ids.includes(id.marko) && ids.includes(id.ivan));
  });

  step('the list sorts by last name, and by any column', async () => {
    await openOrg('?tab=list');
    assert.deepEqual(await listNames(), ['Marko Ilić', 'Ivan Jović', 'Mila Kostić', 'Petar Lukić', 'Sara Nikolić', 'Olga Owner', 'Ana Petrović']);
    await click(page, '[data-testid=org-sort-name]');
    // The URL changes first; the rows follow in the same navigation (a transition): wait for them.
    await page.waitForFunction(() => document.querySelector('[data-testid=org-row] .org-cell[data-col=name] .org-cell-ellipsis')?.textContent === 'Ana Petrović');
    await click(page, '[data-testid=org-sort-jobTitle]');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('sort') === 'jobTitle');
    // By job title (the owner's title comes from onboarding): wait until the rows are in that order.
    await page.waitForFunction(() => {
      const titles = [...document.querySelectorAll('[data-testid=org-row] .org-cell[data-col=jobTitle]')].map((e) => e.textContent.trim()).filter(Boolean);
      return titles.length >= 6 && titles.every((t, i) => i === 0 || titles[i - 1].localeCompare(t, undefined, { sensitivity: 'base' }) <= 0);
    });
    assert.equal((await listNames())[0], 'Ana Petrović');
    // Owners see the HR columns; there is no Roles value for an owner but Admin.
    const headers = await page.$$eval('.org-list-head .sort-btn span:first-child, .org-list-head .th', (els) => els.map((e) => e.textContent));
    assert.deepEqual(headers, ['Name', 'Job title', 'Department', 'Team', 'Reports to', 'Work email', 'Work phone', 'Start date', 'Employment type', 'Status', 'Account', 'Roles']);
  });

  step('filters: department, team, manager direct and including indirect', async () => {
    await openOrg(`?tab=list&dept=${dept.sales}`);
    assert.equal(await count(), '5 employees');
    await openOrg(`?tab=list&dept=${dept.sales}&team=${dept.north}`);
    assert.deepEqual(await listNames(), ['Marko Ilić', 'Ivan Jović', 'Mila Kostić']);
    await openOrg(`?tab=list&manager=${id.marko}`);
    assert.deepEqual(await listNames(), ['Ivan Jović']);
    await click(page, '[data-testid=org-scope-indirect]');
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]').textContent === '3 employees');
    assert.deepEqual(await listNames(), ['Ivan Jović', 'Mila Kostić', 'Sara Nikolić']);
    // The same filter on the chart.
    await click(page, '[data-testid=org-tab-chart]');
    await page.waitForSelector('[data-testid=org-chart-department]');
    assert.equal(await count(), '3 employees');
    // Data issues: no manager.
    await openOrg('?tab=list&issues=no_manager');
    assert.deepEqual(await listNames(), ['Petar Lukić', 'Olga Owner', 'Ana Petrović']);
    await click(page, '[data-testid=org-filter-clear]');
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]').textContent === '7 employees');
  });

  step('search ignores accents: "petrovic" finds Petrović', async () => {
    await openOrg('?tab=list');
    await page.type('[data-testid=org-search]', 'petrovic');
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]').textContent === '1 employee');
    assert.deepEqual(await listNames(), ['Ana Petrović']);
    assert.match(page.url(), /q=petrovic/);
  });

  step('bulk: set department and team, set manager; a loop is refused and nothing changes', async () => {
    await openOrg('?tab=list');
    const tick = (who) => click(page, `[data-testid=org-row][data-id="${who}"] [data-testid=org-select]`);
    await tick(id.mila);
    await tick(id.sara);
    await page.waitForFunction(() => document.querySelector('.org-bulk-count')?.textContent === '2 selected');
    await click(page, '[data-testid=org-bulk-org]');
    await setValue(page, '[data-testid=org-set-department]', dept.service);
    await click(page, '[data-testid=org-set-org-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=org-set-org-save]'));
    for (const who of [id.mila, id.sara]) assert.deepEqual([(await card(who)).departmentName, (await card(who)).teamName], ['Service', null]);

    await click(page, '[data-testid=org-bulk-manager]');
    await page.type('[data-testid=org-set-manager]', 'Petar');
    await click(page, '[data-testid=org-picker-item]');
    await click(page, '[data-testid=org-set-manager-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=org-set-manager-save]'));
    assert.equal((await card(id.mila)).managerId, id.petar);
    assert.equal((await card(id.sara)).managerId, id.petar);

    // Ana under Ivan would close Ana → Marko → Ivan → Ana.
    await click(page, '.org-bulk-clear');
    await tick(id.ana);
    await click(page, '[data-testid=org-bulk-manager]');
    await page.type('[data-testid=org-set-manager]', 'Ivan');
    await click(page, '[data-testid=org-picker-item]');
    await click(page, '[data-testid=org-set-manager-save]');
    await page.waitForSelector('[data-testid=org-dialog-error]');
    assert.match(await page.$eval('[data-testid=org-dialog-error]', (e) => e.textContent), /This would create a loop: Ana Petrović → Ivan Jović → Marko Ilić → Ana Petrović/);
    await clickButton(page, 'Cancel');
    assert.equal((await card(id.ana)).managerId, null);
  });

  step('Ctrl K finds an employee without accents and opens their card', async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await page.waitForSelector('[data-testid=palette-input]');
    await page.type('[data-testid=palette-input]', 'petrovic');
    await page.waitForSelector('[data-kind=employee]');
    assert.match(await page.$eval('[data-kind=employee]', (e) => e.textContent), /Ana Petrović/);
    await page.keyboard.press('Enter');
    await page.waitForFunction((ana) => location.pathname === `/people/${ana}`, {}, id.ana);
  });

  step('a member sees the directory without HR columns, checkboxes or export', async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('org-mia'), role: 'member' }) });
    const mia = await browser.person('mia');
    await mia.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(mia, email('org-mia'), 'Mia Member');
    await clickButton(mia, 'Accept and join');
    await finishOnboarding(mia);
    await mia.goto(`${BASE_URL}/org?tab=list`, { waitUntil: 'networkidle0' });
    await mia.waitForFunction(() => document.querySelector('[data-testid=org-count]')?.textContent === '8 employees');
    const headers = await mia.$$eval('.org-list-head .sort-btn span:first-child, .org-list-head .th', (els) => els.map((e) => e.textContent));
    assert.deepEqual(headers, ['Name', 'Job title', 'Department', 'Team', 'Reports to', 'Work email', 'Work phone']);
    assert.equal(await mia.$('[data-testid=org-select]'), null);
    assert.equal(await mia.$('[data-testid=org-export]'), null);
    assert.equal(await mia.$('[data-testid=org-issue-no_manager]'), null);
    assert.equal(await mia.$('[data-testid=org-status-inactive]'), null);
    assert.doesNotMatch(await text(mia), /Mar 2024|2024-03-01/, 'no start dates of others');
  });

  step('a phone gets the indented list and no sideways scrolling', async () => {
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    const sideways = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    for (const query of ['', '?mode=reporting', '?tab=list']) {
      await openOrg(query);
      await page.waitForSelector(query === '?tab=list' ? '[data-testid=org-row]' : '.org-outline');
      assert.ok((await sideways()) <= 0, `/org${query} scrolls sideways by ${await sideways()}px`);
    }
    assert.match(await page.$eval('[data-testid=org-row]', (e) => e.textContent), /Marko Ilić/);
    await page.setViewport({ width: 1400, height: 1100 });
  });
});
