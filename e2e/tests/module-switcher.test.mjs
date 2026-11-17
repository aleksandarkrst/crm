// The module and workspace switcher (CD-214) and modules as separate apps (CD-223): the button under
// the Pultly mark shows the module you're in and opens the switcher (also with Ctrl+J); each module
// has its own sidebar (Workspace settings has none since CD-524, Profile settings since CD-525);
// picking navigates, locked modules do nothing;
// Escape and an outside click close it; it switches and creates workspaces; pages that don't fit a
// short window go under "More"; on phones it is a bottom sheet. CD-279: Workspace settings is a
// tile (owners and admins; members don't see it, CD-523), modules turned off for a workspace say "Not in this workspace", and
// switching workspace lands on Home (CD-288).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Visit plans and Reports are switched off for now (CD-522); these steps come back with the flag.
import { VISIT_PLANS_ENABLED } from '../../frontend/src/lib/features.ts';
import { api, BASE_URL, click, clickButton, email, finishOnboarding, newUserWithWorkspace, RUN, signIn, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

const POP = '[data-testid=module-switcher-pop]';
const LOGO = '[data-testid=module-switcher]';
const MORE = '[data-testid=sidebar-more]';
const MORE_POP = '[data-testid=sidebar-more-pop]';
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };
// Home is the rail's first item in every module (CD-288).
const CRM_PAGES = ['Home', 'Overview', 'Companies', 'Pipeline', 'Today', 'Calendar', ...(VISIT_PLANS_ENABLED ? ['Visit plans'] : []), 'Contacts', 'Products', ...(VISIT_PLANS_ENABLED ? ['Reports'] : [])];
/** The sidebar's last CRM page, and where it goes. */
const LAST_PAGE = VISIT_PLANS_ENABLED ? { label: 'Reports', path: '/reports/' } : { label: 'Products', path: '/products' };
// Workforce split into Employees, Timesheet and Time off (CD-521). The owner also sees Team and Today's status (CD-162).
const EMPLOYEES_PAGES = ['Home', 'Team', 'Org structure', "Today's status"];

describe('module and workspace switcher', () => {
  const browser = useBrowser();
  const step = steps(browser, 'module-switcher');
  const firstWorkspace = `Switch Studio ${RUN}`;
  const secondWorkspace = `Second Switch ${RUN}`;
  let page;

  /** The modules as { id, current, locked, sub } in grid order. */
  const modules = () =>
    page.$$eval(`${POP} [data-module]`, (els) =>
      els.map((el) => ({
        id: el.getAttribute('data-module'),
        current: el.getAttribute('aria-current') === 'true',
        locked: el.getAttribute('aria-disabled') === 'true',
        sub: el.querySelector('.mod-desc').textContent.trim(),
      })),
    );
  /** The module the sidebar's switcher button shows, and the sidebar's pages on screen. */
  const sidebar = () =>
    page.evaluate(() => ({
      module: document.querySelector('[data-testid=module-switcher]')?.getAttribute('data-current-module') ?? null,
      pages: [...document.querySelectorAll('.app-sidebar nav .nav-item')].filter((el) => el.getClientRects().length > 0).map((el) => el.querySelector('.nav-label').textContent),
    }));
  const inModule = (id) => page.waitForFunction((id) => document.querySelector('[data-testid=module-switcher]')?.getAttribute('data-current-module') === id, {}, id);
  const closed = () => page.waitForFunction((sel) => !document.querySelector(sel), {}, POP);
  /** In this workspace: the sidebar's switcher says so, or Home's workspace switcher (Home has no sidebar, CD-288). */
  const inWorkspace = (name) =>
    page.waitForFunction((name) => (document.querySelector('[data-testid=module-switcher]')?.title ?? document.querySelector('[data-testid=home-workspace]')?.textContent ?? '').includes(name), {}, name);
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute('data-module') ?? document.activeElement?.getAttribute('data-testid'));
  const ctrlJ = async () => {
    await page.keyboard.down('Control');
    await page.keyboard.press('j');
    await page.keyboard.up('Control');
  };

  step('sets up a workspace', async () => {
    page = await browser.person('maja');
    await newUserWithWorkspace(page, { label: 'modsw', name: 'Maja Modules', workspace: firstWorkspace });
  });

  step('the button under the logo shows CRM and its pages; it opens the switcher with CRM marked', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    await waitForToastToClear(page);
    assert.deepEqual(await sidebar(), { module: 'crm', pages: CRM_PAGES });
    assert.equal((await page.$eval(LOGO, (el) => el.textContent)).trim(), 'CRM');
    assert.ok(await page.$('.app-sidebar a[href="/settings"]'), 'Settings at the bottom');
    await click(page, LOGO);
    await page.waitForSelector(POP);
    const rows = await modules();
    assert.deepEqual(
      rows.map((m) => m.id),
      ['crm', 'projects', 'employees', 'timesheet', 'timeoff', 'settings', 'planning', 'finance', 'reporting'],
    );
    assert.deepEqual(rows.find((m) => m.current)?.id, 'crm');
    // One workspace: no workspace row, its name next to "Modules".
    assert.equal(await page.$(`${POP} .mod-ws-row`), null);
    assert.ok((await page.$eval(`${POP} .mod-label-ws`, (el) => el.textContent)).includes(firstWorkspace));
    // Modules that aren't built yet are locked; an owner opens Workspace settings.
    assert.deepEqual(
      rows.filter((m) => m.locked).map((m) => [m.id, m.sub]),
      [
        ['planning', 'Coming soon'],
        ['finance', 'Coming soon'],
        ['reporting', 'Coming soon'],
      ],
    );
  });

  step('picking Employees opens Org structure with only its own pages in the sidebar', async () => {
    await click(page, `${POP} [data-module=employees]`);
    await page.waitForFunction(() => location.pathname === '/org');
    await closed();
    await inModule('employees');
    assert.deepEqual(await sidebar(), { module: 'employees', pages: EMPLOYEES_PAGES });
    assert.equal((await page.$eval(LOGO, (el) => el.textContent)).trim(), 'Employees');
    await click(page, LOGO);
    assert.equal((await modules()).find((m) => m.current)?.id, 'employees');
    await click(page, `${POP} [data-module=crm]`);
    await page.waitForFunction(() => location.pathname === '/pipeline');
    // The URL changes first; the sidebar follows once the screen has loaded (a transition).
    await inModule('crm');
    await closed();
    assert.deepEqual(await sidebar(), { module: 'crm', pages: CRM_PAGES });
  });

  step('an employee card is Employees; Workspace and Profile settings have no module sidebar', async () => {
    const { employeeId } = await api(page, '/people/access');
    assert.ok(employeeId, 'the owner has an employee card');
    await page.goto(`${BASE_URL}/people/${employeeId}`, { waitUntil: 'networkidle0' });
    await inModule('employees');
    await click(page, '.app-sidebar a[href="/settings"]');
    await page.waitForFunction(() => location.pathname.startsWith('/settings/'));
    // Workspace settings is an area of its own, without a module sidebar (CD-524).
    await page.waitForSelector('[data-testid=settings-nav]');
    assert.equal(await page.$('.app-sidebar'), null, 'no module sidebar on Settings');
    // So is Profile settings, in the same glass shell (CD-525).
    await page.goto(BASE_URL + '/profile', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=account-nav]');
    assert.equal(await page.$('.app-sidebar'), null, 'no module sidebar on Profile settings');
    await page.goto(BASE_URL + '/today', { waitUntil: 'networkidle0' });
    await inModule('crm');
    assert.deepEqual((await sidebar()).pages, CRM_PAGES);
  });

  step('locked modules are not clickable', async () => {
    await click(page, LOGO);
    await click(page, `${POP} [data-module=planning]`);
    assert.ok(await page.$(POP), 'still open');
    assert.equal(new URL(page.url()).pathname, '/today', 'still on Today');
  });

  step('Escape closes it and gives focus back to the switcher button; an outside click closes it', async () => {
    await page.keyboard.press('Escape');
    await closed();
    assert.equal(await focused(), 'module-switcher');
    await click(page, LOGO);
    await page.waitForSelector(POP);
    // The popover covers the header's title: click the empty part of the sidebar, below its pages.
    await page.mouse.click(48, 950);
    await closed();
    assert.equal(new URL(page.url()).pathname, '/today');
  });

  step('Ctrl+J opens it; arrow keys move between the modules', async () => {
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await page.click('h1');
    await ctrlJ();
    await page.waitForSelector(POP);
    assert.equal(await focused(), 'crm', 'the current module has focus');
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(), 'projects');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'timesheet');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'settings');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'finance');
    await page.keyboard.press('Enter');
    assert.ok(await page.$(POP), 'a locked module does nothing on Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focused(), 'timeoff');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname === '/timeoff');
    await closed();
  });

  step('in a short window the pages that do not fit are under "More", which works with the keyboard', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    assert.equal(await page.$(MORE), null, 'everything fits at 1400×1100');
    await page.setViewport({ width: 1280, height: 600 });
    await page.waitForSelector(MORE, { visible: true });
    const shown = (await sidebar()).pages;
    assert.ok(shown.length > 0 && shown.length < CRM_PAGES.length, `${shown.length} pages shown`);
    // Nothing is cut off: the last page shown and "More" sit above Settings.
    const fits = await page.evaluate(() => {
      const more = document.querySelector('[data-testid=sidebar-more]').getBoundingClientRect();
      const settings = document.querySelector('.app-sidebar a[href="/settings"]').getBoundingClientRect();
      return more.bottom <= settings.top && settings.bottom <= window.innerHeight;
    });
    assert.ok(fits, '"More" and Settings fit');
    await click(page, MORE);
    await page.waitForSelector(MORE_POP);
    const rest = await page.$$eval(`${MORE_POP} [role=menuitem]`, (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual([...shown, ...rest], CRM_PAGES);
    // The first page has focus; arrows move; Escape closes and gives focus back to "More".
    assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), rest[0]);
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), LAST_PAGE.label);
    await page.keyboard.press('Escape');
    await page.waitForFunction((sel) => !document.querySelector(sel), {}, MORE_POP);
    assert.equal(await focused(), 'sidebar-more');
    // Enter opens it again; End and Enter go to the last page.
    await page.keyboard.press('Enter');
    await page.waitForSelector(MORE_POP);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForFunction((path) => location.pathname.startsWith(path), {}, LAST_PAGE.path);
    await page.waitForFunction((sel) => !document.querySelector(sel), {}, MORE_POP);
    await page.setViewport({ width: 1400, height: 1100 });
    await page.waitForFunction((sel) => !document.querySelector(sel), {}, MORE);
    assert.deepEqual((await sidebar()).pages, CRM_PAGES);
  });

  step('creates a second workspace from the switcher', async () => {
    await click(page, LOGO);
    await click(page, `${POP} [data-testid=workspace-row]`);
    await page.waitForSelector(`${POP} [data-testid=workspace-list]`);
    const items = await page.$$eval(`${POP} [data-workspace]`, (els) => els.map((el) => ({ name: el.getAttribute('data-workspace'), current: el.getAttribute('aria-current') === 'true', sub: el.querySelector('.mod-desc')?.textContent })));
    assert.deepEqual(items, [{ name: firstWorkspace, current: true, sub: '1 member' }]);
    await clickButton(page, 'New workspace');
    await page.type('input[placeholder="Workspace name"]', secondWorkspace);
    await clickButton(page, 'Create workspace');
    await page.waitForFunction((name) => document.querySelector('[data-testid=module-switcher]')?.title.includes(name), {}, secondWorkspace);
    const me = await api(page, '/me');
    assert.equal(me.tenants.length, 2);
  });

  step('with two workspaces the row shows the current one and switches back', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(page, LOGO);
    const row = await page.waitForSelector(`${POP} .mod-ws-row`);
    assert.match(await row.evaluate((el) => el.textContent), new RegExp(`Workspace${secondWorkspace}Switch ›`));
    await row.click();
    const items = await page.$$eval(`${POP} [data-workspace]`, (els) => els.map((el) => ({ name: el.getAttribute('data-workspace'), current: el.getAttribute('aria-current') === 'true' })));
    assert.deepEqual(
      items,
      [
        { name: firstWorkspace, current: false },
        { name: secondWorkspace, current: true },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
    // Back to the modules, then over again.
    await clickButton(page, '‹ Modules');
    await page.waitForSelector(`${POP} [data-module]`);
    await click(page, `${POP} .mod-ws-row`);
    await click(page, `${POP} [data-workspace="${firstWorkspace}"]`);
    await inWorkspace(firstWorkspace);
  });

  /** Sets a workspace's modules through the API, as its owner (whichever workspace is open). */
  const setModules = (tenantName, modules) =>
    page.evaluate(
      async (tenantName, modules) => {
        const auth = { Authorization: 'Bearer ' + localStorage.getItem('crm.devToken') };
        const me = await (await fetch('/api/me', { headers: auth })).json();
        const t = me.tenants.find((x) => x.name === tenantName);
        const res = await fetch('/api/workspace', { method: 'PATCH', headers: { ...auth, 'X-Tenant-Id': t.id, 'Content-Type': 'application/json' }, body: JSON.stringify({ modules }) });
        if (!res.ok) throw new Error('PATCH /workspace ' + res.status);
      },
      tenantName,
      modules,
    );

  step('switching workspace lands on its Home, whatever module you were in (CD-288)', async () => {
    await setModules(secondWorkspace, ['crm']);
    await page.goto(BASE_URL + '/projects', { waitUntil: 'networkidle0' });
    await inModule('projects');
    await click(page, LOGO);
    await click(page, `${POP} .mod-ws-row`);
    await click(page, `${POP} [data-workspace="${secondWorkspace}"]`);
    await inWorkspace(secondWorkspace);
    await page.waitForSelector('[data-testid=home-modules]');
    assert.equal(new URL(page.url()).pathname, '/');
    assert.deepEqual(await page.$$eval('[data-testid=home-modules] [data-module]', (els) => els.map((el) => el.dataset.module)), ['crm', 'settings']);
  });

  step('modules turned off show "Not in this workspace"; Settings → Modules turns them on (CD-318)', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(page, LOGO);
    const rows = await modules();
    assert.deepEqual(
      rows.filter((m) => m.locked && m.sub === 'Not in this workspace').map((m) => m.id),
      ['projects', 'employees', 'timesheet', 'timeoff', 'planning', 'finance', 'reporting'],
    );
    await click(page, `${POP} [data-module=settings]`);
    await page.waitForFunction(() => location.pathname.startsWith('/settings'));
    // Modules is a section of General (CD-524); turning one on needs no confirm.
    await click(page, '[data-testid=settings-nav] [data-section=general]');
    await page.waitForSelector('[data-testid=workspace-modules]');
    await click(page, '[data-testid=workspace-modules] [data-module=projects] [role=switch]');
    await page.waitForFunction(async () => (await (await fetch('/api/workspace', { headers: { Authorization: 'Bearer ' + localStorage.getItem('crm.devToken'), 'X-Tenant-Id': localStorage.getItem('crm.tenantId') } })).json()).modules.includes('projects'));
    // Settings has no sidebar, so no switcher button (CD-524): its "current" tile can't be checked there.
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(page, LOGO);
    assert.equal((await modules()).find((m) => m.id === 'projects').locked, false, 'Projects opens now');
    await page.keyboard.press('Escape');
    await closed();
  });

  step("a workspace with no module that opens: its Home says so; Home's own switcher goes back (CD-288)", async () => {
    await setModules(firstWorkspace, ['planning', 'finance']);
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(page, LOGO);
    await click(page, `${POP} .mod-ws-row`);
    await click(page, `${POP} [data-workspace="${firstWorkspace}"]`);
    await inWorkspace(firstWorkspace);
    await page.waitForSelector('[data-testid=home-empty]');
    assert.equal(new URL(page.url()).pathname, '/');
    assert.match(await page.$eval('[data-testid=home-empty]', (el) => el.textContent), /No modules are on yet\.Turn on modules/);
    await setModules(firstWorkspace, ['planning', 'crm', 'projects', 'employees', 'timesheet', 'timeoff', 'finance', 'reporting']);
    // Home's workspace switcher: the workspaces, the current one ticked; picking one opens its Home.
    await click(page, '[data-testid=home-workspace]');
    const rows = await page.$$eval('.home-menu [role=menuitemradio]', (els) => els.map((el) => [el.querySelector('.home-menu-text span').textContent, el.getAttribute('aria-checked')]));
    assert.deepEqual(rows, [[firstWorkspace, 'true'], [secondWorkspace, 'false']].sort((a, b) => a[0].localeCompare(b[0])));
    await click(page, `.home-menu [role=menuitemradio]::-p-text(${secondWorkspace})`);
    await page.waitForFunction((name) => document.querySelector('[data-testid=home-workspace]')?.textContent.includes(name), {}, secondWorkspace);
    await page.waitForSelector('[data-testid=home-modules]');
  });

  step("a member doesn't see Workspace settings in the switcher or the sidebar (CD-523)", async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('modsw-member'), role: 'member' }) });
    const member = await browser.person('modsw-member');
    await member.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(member, email('modsw-member'), 'Mo Member');
    await clickButton(member, 'Accept and join');
    await finishOnboarding(member);
    await member.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(member, LOGO);
    await member.waitForSelector(`${POP} [data-module=crm]`);
    assert.equal(await member.$(`${POP} [data-module=settings]`), null, 'no Workspace settings tile');
    assert.equal(await member.$('.app-sidebar a[href="/settings"]'), null, 'no Settings in the sidebar');
    // Every module back on for the steps after.
    await setModules(secondWorkspace, ['planning', 'crm', 'projects', 'employees', 'timesheet', 'timeoff', 'finance', 'reporting']);
    await page.reload({ waitUntil: 'networkidle0' });
  });

  step('on a phone it opens from "More" as a bottom sheet without sideways scroll', async () => {
    await page.setViewport(PHONE);
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=nav-more]');
    await click(page, '[data-testid=more-modules]');
    await page.waitForSelector(POP);
    // Once its slide-in animation is done.
    await page.waitForFunction((sel) => document.querySelector(sel)?.getAnimations().every((a) => a.playState === 'finished'), {}, POP);
    const box = await page.$eval(POP, (el) => {
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    });
    assert.deepEqual(box, { left: 0, right: 390, bottom: 844 });
    const sideways = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    assert.ok(sideways <= 0, `scrolls sideways by ${sideways}px`);
    await click(page, `${POP} [data-module=timesheet]`);
    await page.waitForFunction(() => location.pathname === '/timesheet');
    await closed();
    // Timesheet's bottom bar (CD-521): Timesheet and "More" (Approvals is under it).
    await inModule('timesheet');
    assert.deepEqual((await sidebar()).pages, ['Timesheet']);
    assert.ok(await page.$eval('[data-testid=nav-more]', (el) => el.getClientRects().length > 0), '"More" in the bar');
    // The backdrop closes it, too.
    await click(page, '[data-testid=nav-more]');
    await click(page, '[data-testid=more-modules]');
    await page.waitForSelector(POP);
    await page.mouse.click(195, 60);
    await closed();
    await page.setViewport({ width: 1400, height: 1100 });
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
