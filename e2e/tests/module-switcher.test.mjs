// The module and workspace switcher behind the Pultly mark (CD-214): it opens from the logo and
// with Ctrl+J, marks the current module, navigates on a pick, ignores locked modules, closes on
// Escape and an outside click, switches and creates workspaces, and is a bottom sheet on phones.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, newUserWithWorkspace, RUN, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

const POP = '[data-testid=module-switcher-pop]';
const LOGO = '[data-testid=module-switcher]';
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };

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
  const closed = () => page.waitForFunction((sel) => !document.querySelector(sel), {}, POP);
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

  step('the logo opens it with CRM marked as the current module', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    await waitForToastToClear(page);
    await click(page, LOGO);
    await page.waitForSelector(POP);
    const rows = await modules();
    assert.deepEqual(
      rows.map((m) => m.id),
      ['overview', 'crm', 'planning', 'projects', 'workforce', 'reporting'],
    );
    assert.deepEqual(rows.find((m) => m.current)?.id, 'crm');
    // One workspace: no workspace row, its name next to "Modules".
    assert.equal(await page.$(`${POP} .mod-ws-row`), null);
    assert.ok((await page.$eval(`${POP} .mod-label-ws`, (el) => el.textContent)).includes(firstWorkspace));
    // An owner opens Reporting; modules that aren't built yet are locked.
    assert.deepEqual(
      rows.filter((m) => m.locked).map((m) => [m.id, m.sub]),
      [
        ['planning', 'Coming soon'],
        ['projects', 'Coming soon'],
      ],
    );
  });

  step('picking a module navigates and closes it', async () => {
    await click(page, `${POP} [data-module=overview]`);
    await page.waitForFunction(() => location.pathname === '/overview');
    await closed();
    await click(page, LOGO);
    assert.equal((await modules()).find((m) => m.current)?.id, 'overview');
    // Workforce opens the Org structure page (CD-137) and is the current module there.
    await click(page, `${POP} [data-module=workforce]`);
    await page.waitForFunction(() => location.pathname === '/org');
    await closed();
    await click(page, LOGO);
    assert.equal((await modules()).find((m) => m.current)?.id, 'workforce');
    await click(page, `${POP} [data-module=reporting]`);
    await page.waitForFunction(() => location.pathname.startsWith('/reports/'));
    await closed();
  });

  step('locked modules are not clickable', async () => {
    await click(page, LOGO);
    await click(page, `${POP} [data-module=planning]`);
    await click(page, `${POP} [data-module=projects]`);
    assert.ok(await page.$(POP), 'still open');
    assert.ok(new URL(page.url()).pathname.startsWith('/reports/'), 'still on Reports');
  });

  step('Escape closes it and gives focus back to the logo; an outside click closes it', async () => {
    await page.keyboard.press('Escape');
    await closed();
    assert.equal(await focused(), 'module-switcher');
    await click(page, LOGO);
    await page.waitForSelector(POP);
    // The popover covers the header's title: click the empty part of the sidebar instead.
    await page.mouse.click(48, 1050);
    await closed();
  });

  step('Ctrl+J opens it; arrow keys move between the modules', async () => {
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await page.click('h1');
    await ctrlJ();
    await page.waitForSelector(POP);
    assert.equal(await focused(), 'overview', 'the current module has focus');
    await page.keyboard.press('ArrowRight');
    assert.equal(await focused(), 'crm');
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(), 'projects');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await focused(), 'planning');
    await page.keyboard.press('Enter');
    assert.ok(await page.$(POP), 'a locked module does nothing on Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.pathname === '/overview');
    await closed();
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
    await page.waitForFunction((name) => document.querySelector('[data-testid=module-switcher]')?.title.includes(name), {}, firstWorkspace);
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
    await click(page, `${POP} [data-module=overview]`);
    await page.waitForFunction(() => location.pathname === '/overview');
    await closed();
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
