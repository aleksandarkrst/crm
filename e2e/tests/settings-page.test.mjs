// Workspace settings page (CD-280): the left nav grouped by module, each section on its own URL,
// Settings keeps the sidebar of the module it was opened from, and on a narrow window the nav sits
// above the content.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { BASE_URL, click, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

const POP = '[data-testid=module-switcher-pop]';
const LOGO = '[data-testid=module-switcher]';

describe('settings page', () => {
  const browser = useBrowser();
  const step = steps(browser, 'settings-page');
  let page;

  const navGroups = () =>
    page.$$eval('[data-testid=settings-nav] .settings-nav-group', (els) =>
      els.map((el) => [el.getAttribute('data-group'), [...el.querySelectorAll('.settings-nav-item')].map((b) => b.textContent)]),
    );
  const active = () => page.$$eval('[data-testid=settings-nav] .settings-nav-item.on', (els) => els.map((el) => el.textContent));
  const sidebarModule = () => page.$eval(LOGO, (el) => el.getAttribute('data-current-module'));

  step('sets up a workspace', async () => {
    page = await browser.person('stella');
    await newUserWithWorkspace(page, { label: 'settingspage', name: 'Stella Settings', workspace: 'Settings Co' });
  });

  step('from Projects, the switcher opens Workspace settings and the Projects sidebar stays (TC 1)', async () => {
    await page.goto(BASE_URL + '/projects', { waitUntil: 'networkidle0' });
    await click(page, LOGO);
    await click(page, `${POP} [data-module=settings]`);
    await page.waitForFunction(() => location.pathname === '/settings/workspace');
    await page.waitForSelector('[data-testid=settings-nav] .settings-nav-item');
    assert.equal(await sidebarModule(), 'projects');
    assert.deepEqual(await navGroups(), [
      ['Workspace', ['General', 'Members', 'Roles & permissions', 'Notifications']],
      ['CRM', ['Funnels', 'Document templates', 'Customize fields', 'Sales bonuses']],
      ['Projects', ['Project types', 'Technicians']],
      ['Workforce', ['Employees', 'Approvals', 'Holidays']],
    ]);
    assert.deepEqual(await active(), ['General']);
    assert.equal(await page.$eval('.settings-title', (el) => el.textContent), 'General');
  });

  step('each section has its own URL, kept on reload (TC 2)', async () => {
    await click(page, '[data-testid=settings-nav] [data-section=project-types]');
    await page.waitForFunction(() => location.pathname === '/settings/project-types');
    await page.waitForFunction(() => document.querySelector('.settings-nav-item.on')?.textContent === 'Project types');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=project-type]');
    assert.deepEqual(await active(), ['Project types']);
    assert.equal(await sidebarModule(), 'projects', 'still the Projects sidebar');
    // From the CRM, Settings keeps the CRM sidebar.
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await click(page, '.app-sidebar a[href="/settings"]');
    await page.waitForFunction(() => location.pathname.startsWith('/settings/'));
    assert.equal(await sidebarModule(), 'crm');
  });

  step('moving a stage up updates the preview at once (TC 3)', async () => {
    await page.goto(BASE_URL + '/settings/project-types', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=project-stage]');
    const rows = await page.$$('[data-testid=project-stage]');
    await (await rows[1].$('button[aria-label="Move up"]')).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=project-type-preview] .stage-chev')].map((el) => el.textContent).join() === 'In progress,Planning,Review');
  });

  step('at 700 px the nav sits above the content (TC 5)', async () => {
    await page.setViewport({ width: 700, height: 900 });
    await page.waitForFunction(() => {
      const nav = document.querySelector('[data-testid=settings-nav]').getBoundingClientRect();
      const content = document.querySelector('[data-testid=settings-content]').getBoundingClientRect();
      return nav.bottom <= content.top;
    });
    const sideways = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    assert.ok(sideways <= 0, `scrolls sideways by ${sideways}px`);
    await page.setViewport({ width: 1400, height: 1100 });
  });
});
