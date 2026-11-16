// Workspace settings page (CD-280, rebuilt in CD-524): its own area with six pages in a sidebar
// (no module sidebar), each page on its own URL, old section links landing on the page that has
// them now, and on a narrow window the nav sits above the content.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { BASE_URL, click, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

const POP = '[data-testid=module-switcher-pop]';
const LOGO = '[data-testid=module-switcher]';

describe('settings page', () => {
  const browser = useBrowser();
  const step = steps(browser, 'settings-page');
  let page;

  const navItems = () => page.$$eval('[data-testid=settings-nav] .gs-nav-row', (els) => els.map((el) => [el.dataset.section, el.querySelector('.label').textContent]));
  const active = () => page.$$eval('[data-testid=settings-nav] .gs-nav-row[aria-current=page]', (els) => els.map((el) => el.dataset.section));

  step('sets up a workspace', async () => {
    page = await browser.person('stella');
    await newUserWithWorkspace(page, { label: 'settingspage', name: 'Stella Settings', workspace: 'Settings Co' });
  });

  step('from Projects, the switcher opens Workspace settings: six pages, no module sidebar (TC 1)', async () => {
    await page.goto(BASE_URL + '/projects', { waitUntil: 'networkidle0' });
    await click(page, LOGO);
    await click(page, `${POP} [data-module=settings]`);
    await page.waitForFunction(() => location.pathname === '/settings/general');
    await page.waitForSelector('[data-testid=settings-nav] .gs-nav-row');
    assert.deepEqual(await navItems(), [
      ['general', 'General'],
      ['crm', 'CRM'],
      ['projects', 'Projects'],
      ['employees', 'Employees'],
      ['timesheet', 'Timesheet'],
      ['timeoff', 'Time off'],
    ]);
    assert.deepEqual(await active(), ['general']);
    assert.equal(await page.$eval('.gs-topbar h1', (el) => el.textContent), 'General');
    assert.equal(await page.$('.app-sidebar'), null, 'no module sidebar on settings pages');
  });

  step('each page has its own URL, kept on reload; old section links land on their page (TC 2)', async () => {
    await click(page, '[data-testid=settings-nav] [data-section=projects]');
    await page.waitForFunction(() => location.pathname === '/settings/projects');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=project-type]');
    assert.deepEqual(await active(), ['projects']);
    assert.equal(await page.$eval('.gs-topbar h1', (el) => el.textContent), 'Projects');
    for (const [old, now] of [
      ['project-types', 'projects'],
      ['funnel', 'crm'],
      ['holidays', 'timeoff'],
      ['org-levels', 'employees'],
      ['approvals', 'timesheet'],
      ['workspace', 'general'],
    ]) {
      await page.goto(`${BASE_URL}/settings/${old}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction((now) => location.pathname === `/settings/${now}`, {}, now);
    }
  });

  step('moving a stage up in the project type editor reorders the stages at once (TC 3)', async () => {
    // The stage preview is gone (CD-524): the editor's stage list itself shows the new order.
    await page.goto(BASE_URL + '/settings/projects', { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=project-type] [data-testid=project-type-menu]');
    await click(page, '[data-testid=project-type-edit]');
    await page.waitForSelector('[data-testid=project-type-card] [data-testid=project-stage]');
    const names = () => page.$$eval('[data-testid=project-type-card] [data-testid=project-stage] input', (els) => els.map((el) => el.value).join());
    const before = (await names()).split(',');
    const rows = await page.$$('[data-testid=project-type-card] [data-testid=project-stage]');
    await (await rows[1].$('button[aria-label="Move up"]')).click();
    await page.waitForFunction((want) => [...document.querySelectorAll('[data-testid=project-type-card] [data-testid=project-stage] input')].map((el) => el.value).join() === want, {}, [before[1], before[0], ...before.slice(2)].join());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=project-type-card]'));
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
