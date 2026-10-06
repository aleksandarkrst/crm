// Organization levels and units (CD-226; departments and teams before, CD-138): an Admin names the
// levels Sector, Department and Team in Settings → Employees, creates a Sector, a Department in it
// and a Team in that from the Org page's Create menu (each lead reports to the lead above, the top
// one to the CEO), sets a lead in the Organization panel and sees the derived manager, drags a
// person onto another person (both charts) and onto a unit, and filters by unit. The chart branches
// from the company node; a level with units can't be removed; the panel fits a phone.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, confirmInApp, email, setValue, signIn, createWorkspace, steps, useBrowser } from '../lib/harness.mjs';

describe('org levels and units', () => {
  const browser = useBrowser();
  const step = steps(browser, 'org-units');
  let page;
  const id = {};
  const unit = {};

  // Invited in Settings → Team (the API), which creates their record (CD-226); then their names.
  const person = async (firstName, lastName) => {
    const { invitation } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email(`ou-${firstName}-${lastName}`.toLowerCase()), role: 'member' }) });
    await api(page, `/people/employees/${invitation.employeeId}`, { method: 'PATCH', body: JSON.stringify({ firstName, lastName, employmentStartDate: '2024-03-01' }) });
    return invitation.employeeId;
  };
  const employee = (employeeId) => api(page, `/people/employees/${employeeId}`);
  const unitId = async (name) => (await api(page, '/people/org-units')).find((u) => u.name === name).id;
  const openOrg = async (query = '') => {
    await page.goto(`${BASE_URL}/org${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /\d+ employees?$/.test(document.querySelector('[data-testid=org-count]')?.textContent ?? ''));
  };
  const levelNames = () => page.$$eval('[data-testid=org-level-row]', (els) => els.map((e) => e.dataset.name));
  /** HTML5 drag and drop, as the browser fires it, from one element onto another. */
  const drag = (from, to) =>
    page.evaluate(
      (from, to) => {
        const source = document.querySelector(from);
        const target = document.querySelector(to);
        if (!source || !target) throw new Error(`drag: ${source ? to : from} not found`);
        const dataTransfer = new DataTransfer();
        const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
        fire(source, 'dragstart');
        fire(target, 'dragenter');
        fire(target, 'dragover');
        fire(target, 'drop');
        fire(source, 'dragend');
      },
      from,
      to,
    );
  /** "New <level>" from the Org page's Create menu: name, the unit it is in, the lead. */
  const create = async (level, name, { parent = null, lead = null } = {}) => {
    await click(page, '[data-testid=org-create]');
    await click(page, `[data-testid="org-create-${level}"]`);
    await page.type('[data-testid=unit-create-name]', name);
    if (parent) {
      await page.waitForSelector(`[data-testid=unit-create-parent] option[value="${parent}"]`);
      await setValue(page, '[data-testid=unit-create-parent]', parent);
    }
    if (lead) {
      await page.waitForSelector(`[data-testid=unit-create-lead] option[value="${lead}"]`);
      await setValue(page, '[data-testid=unit-create-lead]', lead);
    }
    await click(page, '[data-testid=unit-create-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=unit-create-save]'));
    return unitId(name);
  };

  step('an Admin with six people', async () => {
    page = await browser.person('dora');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(page, email('ou-dora'), 'Dora Director');
    await createWorkspace(page, 'Units Co');
    id.dora = (await api(page, '/people/access')).employeeId;
    id.ceo = await person('Cira', 'Ceo');
    id.sara = await person('Sara', 'Sector');
    id.lena = await person('Lena', 'Lead');
    id.ivo = await person('Ivo', 'Team');
    id.bo = await person('Bo', 'Member');
    id.nina = await person('Nina', 'Member');
  });

  step('Settings → Employees: the levels become Sector, Department and Team', async () => {
    await page.goto(`${BASE_URL}/settings/employees`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=org-level-row]');
    assert.deepEqual(await levelNames(), ['Department', 'Team']);
    // Added at the bottom, then moved to the top.
    await page.type('[data-testid=org-level-new]', 'Sector');
    await click(page, '[data-testid=org-level-add]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=org-level-row]').length === 3);
    await click(page, '[data-testid=org-level-row][data-name=Sector] [data-testid=org-level-up]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=org-level-row]')[1]?.dataset.name === 'Sector');
    await click(page, '[data-testid=org-level-row][data-name=Sector] [data-testid=org-level-up]');
    await page.waitForFunction(() => document.querySelector('[data-testid=org-level-row]')?.dataset.name === 'Sector');
    // Renamed inline (Team → Squad), removed when it has no units, and back as Team at the bottom.
    const name = '[data-testid=org-level-row][data-name=Team] [data-testid=org-level-name]';
    await page.$eval(name, (el) => el.select());
    await page.type(name, 'Squad');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=org-level-row][data-name=Squad]');
    await click(page, '[data-testid=org-level-row][data-name=Squad] [data-testid=org-level-remove]');
    assert.equal(await confirmInApp(page), 'Remove the level Squad?');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=org-level-row]').length === 2);
    await page.type('[data-testid=org-level-new]', 'Team');
    await click(page, '[data-testid=org-level-add]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=org-level-row]').length === 3);
    assert.deepEqual(await levelNames(), ['Sector', 'Department', 'Team']);
    assert.deepEqual(
      (await api(page, '/people/org-levels')).map((l) => [l.name, l.position]),
      [
        ['Sector', 1],
        ['Department', 2],
        ['Team', 3],
      ],
    );
  });

  step('Create → New sector with a lead: in a CEO-only org the lead reports to the CEO', async () => {
    await api(page, '/workspace', { method: 'PATCH', body: JSON.stringify({ ceoEmployeeId: id.ceo }) });
    await openOrg();
    // The menu has one entry per level.
    await click(page, '[data-testid=org-create]');
    assert.deepEqual(await page.$$eval('.org-create-pop button', (els) => els.map((e) => e.textContent)), ['New sector', 'New department', 'New team']);
    await click(page, '[data-testid=org-create]');
    unit.commercial = await create('Sector', 'Commercial', { lead: id.sara });
    const sara = await employee(id.sara);
    assert.equal(sara.unitId, unit.commercial, 'the lead joins the unit');
    assert.equal(sara.managerId, id.ceo, 'and reports to the CEO');
    assert.deepEqual(sara.leadsUnit, { id: unit.commercial, name: 'Commercial' });
  });

  step('a Department inside it and a Team inside that: each lead reports to the lead above', async () => {
    unit.sales = await create('Department', 'Sales', { parent: unit.commercial, lead: id.lena });
    unit.north = await create('Team', 'North', { parent: unit.sales, lead: id.ivo });
    assert.equal((await employee(id.lena)).managerId, id.sara);
    const ivo = await employee(id.ivo);
    assert.deepEqual([ivo.unitId, ivo.managerId], [unit.north, id.lena]);
  });

  step('the chart branches from the company node: Sector → Department → Team, each lead once on top', async () => {
    await openOrg();
    await page.waitForSelector('[data-testid=org-chart-units]');
    const north = `.org-units-top > [data-testid=org-unit][data-unit="${unit.commercial}"] > .org-unit-children > [data-testid=org-unit][data-unit="${unit.sales}"] > .org-unit-children > [data-testid=org-unit][data-unit="${unit.north}"]`;
    await page.waitForSelector(north);
    assert.equal(await page.$eval(`${north} > .org-unit-box .org-unit-level`, (e) => e.textContent), 'Team');
    assert.equal(await page.$eval(`${north} > .org-unit-box .org-unit-lead [data-testid=org-person]`, (e) => e.dataset.id), id.ivo);
    assert.equal(await page.$eval(`${north} > .org-unit-box .org-unit-lead .org-badge`, (e) => e.textContent), 'Lead');
    assert.equal((await page.$$(`[data-testid=org-person][data-id="${id.ivo}"]`)).length, 1, 'Ivo once');
    // The units hang below the company node, which holds the CEO.
    const [company, top] = await page.evaluate(() => [document.querySelector('[data-testid=org-company]').getBoundingClientRect().bottom, document.querySelector('.org-units-top').getBoundingClientRect().top]);
    assert.ok(top > company, 'units below the company');
    await page.waitForSelector(`[data-testid=org-company] [data-testid=org-person][data-id="${id.ceo}"]`);
  });

  step('the chart: setting a lead shows who they will report to, and applies it', async () => {
    unit.service = (await api(page, '/people/org-units', { method: 'POST', body: JSON.stringify({ levelId: (await api(page, '/people/org-levels'))[1].id, name: 'Service' }) })).unit.id;
    // No separate Organization panel any more (CD-228): the units are set up on the chart.
    assert.equal(await page.$('[data-testid=org-units]'), null);
    const service = `[data-testid=org-unit][data-unit="${unit.service}"]`;
    await page.waitForSelector(`${service} [data-testid=unit-lead-select] option[value="${id.nina}"]`);
    await setValue(page, `${service} [data-testid=unit-lead-select]`, id.nina);
    await page.waitForSelector('[data-testid=unit-lead-preview]');
    assert.match(await page.$eval('[data-testid=unit-lead-preview]', (e) => e.textContent), /Nina Member will report to Cira Ceo\./);
    await click(page, '[data-testid=unit-lead-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=unit-lead-save]'));
    const nina = await employee(id.nina);
    assert.deepEqual([nina.unitId, nina.managerId], [unit.service, id.ceo]);
    await page.waitForSelector(`${service} .org-unit-lead [data-testid=org-person][data-id="${id.nina}"]`);
    assert.equal(await page.$eval(`${service} .org-unit-lead .org-badge`, (e) => e.textContent), 'Lead');
  });

  step('dragging a person onto a person makes them the manager; the dialog shows the unit change', async () => {
    await openOrg();
    await page.waitForSelector(`[data-testid=org-person][data-id="${id.bo}"]`);
    await drag(`[data-testid=org-person][data-id="${id.bo}"]`, `[data-testid=org-person][data-id="${id.ivo}"]`);
    await page.waitForSelector('[data-testid=org-boss-save]');
    const dialog = await page.$eval('.modal', (e) => e.textContent);
    assert.match(dialog, /Make Ivo Team the manager of Bo Member\?/);
    assert.match(dialog, /Bo Member moves to Commercial › Sales › North\./);
    await click(page, '[data-testid=org-boss-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=org-boss-save]'));
    const bo = await employee(id.bo);
    assert.deepEqual([bo.managerId, bo.unitId], [id.ivo, unit.north]);
    await page.waitForSelector(`[data-testid=org-unit][data-unit="${unit.north}"] [data-testid=org-person][data-id="${id.bo}"]`);
  });

  step('… and in Reporting lines: a lead stays in the unit they lead', async () => {
    await openOrg('?mode=reporting');
    await page.waitForSelector(`[data-testid=org-chart-reporting] [data-testid=org-person][data-id="${id.lena}"]`);
    await drag(`[data-testid=org-person][data-id="${id.nina}"]`, `[data-testid=org-person][data-id="${id.lena}"]`);
    await page.waitForSelector('[data-testid=org-boss-save]');
    assert.match(await page.$eval('.modal', (e) => e.textContent), /Nina Member stays in their unit\./);
    await click(page, '[data-testid=org-boss-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=org-boss-save]'));
    const nina = await employee(id.nina);
    assert.deepEqual([nina.managerId, nina.unitId], [id.lena, unit.service]);
  });

  step("dropping a person on a unit moves them; the unit's lead becomes their manager", async () => {
    await openOrg();
    await page.waitForSelector(`[data-testid=org-person][data-id="${id.dora}"]`);
    await drag(`[data-testid=org-person][data-id="${id.dora}"]`, `[data-testid=org-unit][data-unit="${unit.sales}"] > .org-unit-box`);
    await page.waitForSelector('[data-testid=org-move-save]');
    assert.match(await page.$eval('.modal', (e) => e.textContent), /to Commercial › Sales\. Lena Lead becomes their manager\./);
    await click(page, '[data-testid=org-move-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=org-move-save]'));
    const dora = await employee(id.dora);
    assert.deepEqual([dora.unitId, dora.managerId], [unit.sales, id.lena]);
  });

  step('the Unit filter, grouped by level: a unit counts the units inside it', async () => {
    await openOrg('?tab=list');
    await click(page, '[data-testid=org-filter-unit]');
    assert.deepEqual(await page.$$eval('.org-multi-group', (els) => els.map((e) => e.textContent)), ['Sector', 'Department', 'Team']);
    await click(page, '.org-multi-item::-p-text(Commercial › Sales)');
    await page.waitForFunction((sales) => new URLSearchParams(location.search).get('unit') === sales, {}, unit.sales);
    // Lena, Dora (Sales), Ivo and Bo (North).
    await page.waitForFunction(() => document.querySelector('[data-testid=org-count]').textContent === '4 employees');
    // The list's Unit column, with the path as a tooltip.
    assert.equal(await page.$eval(`[data-testid=org-row][data-id="${id.bo}"] .org-cell[data-col=unit] span`, (e) => e.title), 'Commercial › Sales › North');
  });

  step("the card's Unit shows the path; a level with units can't be removed", async () => {
    await page.goto(`${BASE_URL}/people/${id.bo}`, { waitUntil: 'networkidle0' });
    // An Admin edits it: one Unit select, each unit with its path.
    await page.waitForFunction(() => document.querySelector('[data-testid=emp-work] select[name=unitId]')?.selectedOptions[0]?.textContent === 'Commercial › Sales › North');
    await page.goto(`${BASE_URL}/settings/employees`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=org-level-row][data-name=Team]');
    assert.equal(await page.$eval('[data-testid=org-level-row][data-name=Team] [data-testid=org-level-remove]', (b) => b.disabled), true);
  });

  step('the units can be set up on a phone', async () => {
    await page.setViewport({ width: 375, height: 800 });
    await openOrg();
    await page.waitForSelector(`[data-testid=org-unit][data-unit="${unit.commercial}"] [data-testid=unit-menu]`);
    await click(page, `[data-testid=org-unit][data-unit="${unit.commercial}"] [data-testid=unit-menu]`);
    await page.waitForSelector('[data-testid=unit-menu-rename]');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scrolling at 375 px');
    await page.setViewport({ width: 1400, height: 1100 });
  });
});
