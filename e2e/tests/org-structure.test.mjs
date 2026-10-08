// Org structure (CD-137): an owner's org of four levels in both chart modes and in the list, the
// company node with the CEO the owner sets (CD-225), sorting, filters as dropdowns (unit with the
// units inside it and old department/team links, manager direct and including indirect, status,
// data issues) that the URL restores, the
// list header as wide as its columns, the accent-free search ("petrovic" finds Petrović), the bulk
// actions with the loop refused, Ctrl K opening an employee's card, a member's narrower columns,
// and a phone without sideways scrolling. People join by invitation (CD-226): the page has no Add
// employee, Import or "Invite selected".
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, email, finishOnboarding, newUserWithWorkspace, setValue, signIn, steps, text, useBrowser } from '../lib/harness.mjs';

describe('org structure', () => {
  const browser = useBrowser();
  const step = steps(browser, 'org-structure');
  let page;
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
    // Units of the default levels Department and Team (CD-226), without leads.
    const [department, team] = await api(page, '/people/org-levels');
    const unit = async (levelId, name, parentId = null) => (await api(page, '/people/org-units', { method: 'POST', body: JSON.stringify({ levelId, name, parentId }) })).unit.id;
    dept.sales = await unit(department.id, 'Sales');
    dept.service = await unit(department.id, 'Service');
    dept.north = await unit(team.id, 'North', dept.sales);
    dept.south = await unit(team.id, 'South', dept.sales);
    // Invited in Settings → Team (the API), which creates their record (CD-226); then their details.
    let n = 0;
    const create = async (key, firstName, lastName, extra) => {
      const { invitation } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email(`org-person-${++n}`), role: 'member' }) });
      id[key] = invitation.employeeId;
      await api(page, `/people/employees/${id[key]}`, { method: 'PATCH', body: JSON.stringify({ firstName, lastName, employmentStartDate: '2024-03-01', ...extra }) });
    };
    // Ana → Marko → Ivan → Mila and Sara; Petar without a manager in Service. Unit and manager in
    // one change: both stay as given (the org rules only fill in what a change leaves out).
    await create('ana', 'Ana', 'Petrović', { jobTitle: 'CEO', unitId: dept.sales });
    await create('marko', 'Marko', 'Ilić', { jobTitle: 'Sales director', unitId: dept.north, managerId: id.ana });
    await create('ivan', 'Ivan', 'Jović', { jobTitle: 'Team lead', unitId: dept.north, managerId: id.marko });
    await create('mila', 'Mila', 'Kostić', { jobTitle: 'Sales rep', unitId: dept.north, managerId: id.ivan });
    await create('sara', 'Sara', 'Nikolić', { jobTitle: 'Sales rep', unitId: dept.south, managerId: id.ivan });
    await create('petar', 'Petar', 'Lukić', { jobTitle: 'Technician', unitId: dept.service });
    id.olga = (await api(page, '/people/access')).employeeId;
  });

  step('Workforce opens "Org structure", its sidebar page; the chart shows everyone by unit', async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    // Each module has its own sidebar (CD-223): Org structure is in Workforce's.
    assert.equal(await page.$('.app-sidebar a[href="/org"]'), null, 'not in the CRM sidebar');
    await click(page, '[data-testid=module-switcher]');
    await click(page, '[data-testid=module-switcher-pop] [data-module=workforce]');
    await page.waitForFunction(() => location.pathname === '/org');
    await page.waitForSelector('.app-sidebar a[href="/org"].active');
    await page.waitForSelector('[data-testid=org-chart-units]');
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]')?.textContent === '7 employees');
    // Each unit with its own people, then the units inside it (CD-226); "No unit" last.
    const boxes = await page.$$eval('[data-testid=org-unit]', (els) =>
      els.map((e) => [e.querySelector(':scope > .org-unit-box .org-unit-name').textContent, [...e.querySelectorAll(':scope > .org-unit-box [data-testid=org-person]')].map((p) => p.querySelector('.org-person-name').firstChild.textContent)]),
    );
    assert.deepEqual(boxes, [
      ['Sales', ['Ana Petrović']],
      ['North', ['Marko Ilić', 'Ivan Jović', 'Mila Kostić']],
      ['South', ['Sara Nikolić']],
      ['Service', ['Petar Lukić']],
      ['No unit', ['Olga Owner']],
    ]);
    // North and South hang inside Sales.
    assert.ok(await page.$(`[data-testid=org-unit][data-unit="${dept.sales}"] > .org-unit-children > [data-testid=org-unit][data-unit="${dept.north}"]`));
    // Data issues for Admins: Petar and Ana have no manager.
    assert.ok((await page.$$('[data-testid=org-person][data-id="' + id.petar + '"] [data-testid=org-issue]')).length === 1);
  });

  step('the company node shows the workspace; the owner sets the CEO, who sits there and not in a department', async () => {
    await page.waitForSelector('[data-testid=org-company]');
    assert.equal(await page.$eval('[data-testid=org-company-name]', (e) => e.textContent), 'Org Co');
    assert.match(await page.$eval('[data-testid=org-company]', (e) => e.textContent), /No CEO set/);
    // The units branch from the company node.
    const [company, firstUnit] = await page.evaluate(() => [document.querySelector('[data-testid=org-company]').getBoundingClientRect().bottom, document.querySelector('[data-testid=org-unit]').getBoundingClientRect().top]);
    assert.ok(firstUnit > company, 'units below the company');

    await click(page, '[data-testid=org-set-ceo]');
    await page.type('[data-testid=org-ceo-picker]', 'Ana');
    await click(page, '[data-testid=org-picker-item]');
    await page.waitForSelector(`[data-testid=org-company] [data-testid=org-person][data-id="${id.ana}"]`);
    assert.match(await page.$eval('[data-testid=org-company]', (e) => e.textContent), /CEO/);
    const sales = await page.$$eval(`[data-testid=org-unit][data-unit="${dept.sales}"] [data-testid=org-person]`, (els) => els.map((p) => p.dataset.id));
    assert.ok(!sales.includes(id.ana), 'the CEO is not repeated in Sales');
    // Saved as a workspace setting: still there after a reload, and the CEO is no "No manager" issue.
    let saved = null;
    for (let i = 0; i < 40 && !saved; i++) {
      saved = (await api(page, '/workspace')).ceoEmployeeId === id.ana;
      if (!saved) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(saved, 'ceoEmployeeId saved');
    // Setting the CEO fills in missing managers (CD-228): Petar, alone in Service (no lead), now reports to the CEO.
    assert.equal((await card(id.petar)).managerId, id.ana);
    assert.ok(!(await card(id.ana)).hr.dataIssues.includes('no_manager'));
    await openOrg();
    await page.waitForSelector(`[data-testid=org-company] [data-testid=org-person][data-id="${id.ana}"]`);
    // Reporting lines: the CEO is the first root.
    await openOrg('?mode=reporting');
    await page.waitForSelector('[data-testid=org-chart-reporting]');
    assert.equal(await page.$eval('[data-testid=org-chart-reporting] [data-testid=org-node]', (e) => e.dataset.id), id.ana);
  });

  step('reporting lines: two levels open, expand and collapse, search opens the path', async () => {
    await openOrg();
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
    assert.deepEqual(headers, ['Name', 'Job title', 'Unit', 'Reports to', 'Work email', 'Work phone', 'Start date', 'Employment type', 'Status', 'Account', 'Roles']);
    // The header's background spans every column, however wide the list scrolls (CD-225).
    for (const width of [1400, 1000]) {
      await page.setViewport({ width, height: 1100 });
      await page.waitForSelector('.org-list-head');
      const [head, scroll] = await page.evaluate(() => [document.querySelector('.org-list-head').getBoundingClientRect().width, document.querySelector('.org-list-scroll').scrollWidth]);
      assert.ok(head >= scroll - 1, `header ${head}px, list ${scroll}px at ${width}px`);
    }
    await page.setViewport({ width: 1400, height: 1100 });
  });

  step('filters: unit (with the units inside it), old department links, manager direct and including indirect', async () => {
    await openOrg(`?tab=list&unit=${dept.sales}`);
    assert.equal(await count(), '5 employees');
    // The Unit filter: grouped by level, each unit with its path.
    await click(page, '[data-testid=org-filter-unit]');
    assert.deepEqual(await page.$$eval('.org-multi-group', (els) => els.map((e) => e.textContent)), ['Department', 'Team']);
    await click(page, '.org-multi-item::-p-text(Sales › South)');
    await page.waitForFunction((south) => new URLSearchParams(location.search).get('unit')?.includes(south), {}, dept.south);
    assert.equal(await count(), '5 employees');
    await click(page, '[data-testid=org-filter-clear]');
    // Links from before CD-226 still work: departments and teams became units.
    await openOrg(`?tab=list&dept=${dept.sales}&team=${dept.north}`);
    assert.deepEqual(await listNames(), ['Marko Ilić', 'Ivan Jović', 'Mila Kostić']);
    await openOrg(`?tab=list&manager=${id.marko}`);
    assert.deepEqual(await listNames(), ['Ivan Jović']);
    // The scope is a dropdown once a manager is chosen (CD-225).
    await setValue(page, '[data-testid=org-filter-scope]', 'indirect');
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]').textContent === '3 employees');
    assert.deepEqual(await listNames(), ['Ivan Jović', 'Mila Kostić', 'Sara Nikolić']);
    // The same filter on the chart.
    await click(page, '[data-testid=org-tab-chart]');
    await page.waitForSelector('[data-testid=org-chart-units]');
    assert.equal(await count(), '3 employees');
    // Data issues and Status are dropdowns too (CD-225); the URL restores them.
    await openOrg('?tab=list');
    await click(page, '[data-testid=org-filter-issues]');
    await click(page, '.org-multi-item::-p-text(No manager)');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('issues') === 'no_manager');
    // The CEO (Ana) is not "No manager", and Petar got the CEO when she was set (CD-228); Olga has no unit, so she keeps none.
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]').textContent === '1 employee');
    assert.deepEqual(await listNames(), ['Olga Owner']);
    await click(page, '[data-testid=org-filter-status]');
    await click(page, '.org-multi-item::-p-text(Inactive)');
    await page.waitForFunction(() => new URLSearchParams(location.search).get('status') === 'active,leaving,inactive');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]')?.textContent === '1 employee');
    assert.equal(await page.$eval('[data-testid=org-filter-issues]', (e) => e.textContent), 'Data issues: No manager');
    assert.equal(await page.$eval('[data-testid=org-filter-status]', (e) => e.textContent), 'Status: Active +2');
    // No pill buttons left for these filters.
    assert.equal(await page.$('[data-testid^=org-status-]'), null);
    assert.equal(await page.$('[data-testid^=org-issue-]'), null);
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

  step('bulk: set unit, set manager; a loop is refused and nothing changes', async () => {
    await openOrg('?tab=list');
    const tick = (who) => click(page, `[data-testid=org-row][data-id="${who}"] [data-testid=org-select]`);
    await tick(id.mila);
    await tick(id.sara);
    await page.waitForFunction(() => document.querySelector('.org-bulk-count')?.textContent === '2 selected');
    // People join by invitation (CD-226): no "Invite selected", Add employee or Import.
    for (const gone of ['org-bulk-invite', 'org-add-employee', 'employee-import']) assert.equal(await page.$(`[data-testid=${gone}]`), null, gone);
    await click(page, '[data-testid=org-bulk-unit]');
    await setValue(page, '[data-testid=org-set-unit]', dept.service);
    await click(page, '[data-testid=org-set-unit-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=org-set-unit-save]'));
    // Service has no lead: the CEO (Ana) becomes their manager (CD-226).
    for (const who of [id.mila, id.sara]) assert.deepEqual([(await card(who)).unitName, (await card(who)).managerId], ['Service', id.ana]);

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
    assert.deepEqual(headers, ['Name', 'Job title', 'Unit', 'Reports to', 'Work email', 'Work phone']);
    assert.equal(await mia.$('[data-testid=org-select]'), null);
    assert.equal(await mia.$('[data-testid=org-export]'), null);
    assert.equal(await mia.$('[data-testid=org-filter-issues]'), null);
    await click(mia, '[data-testid=org-filter-status]');
    const statuses = await mia.$$eval('.org-multi-item', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(statuses, ['Active', 'Leaving']);
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
