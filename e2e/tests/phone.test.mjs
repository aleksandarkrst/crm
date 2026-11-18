// Tablets and phones (CD-70): no sideways page scroll at 390×844 or 768×1024, navigation stays
// reachable (the CRM's glass sidebar as a row of icons, CD-530), a deal's to-do can be ticked, and a contact can be called or
// emailed with one tap.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const TABLET = { width: 768, height: 1024, isMobile: true, hasTouch: true };

describe('phones and tablets', () => {
  const browser = useBrowser();
  const step = steps(browser, 'phone');
  let page;
  let deal;
  let screens;

  /** How far the page itself scrolls sideways (0 when everything fits). */
  const sideways = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);

  step('sets up a workspace with sample data', async () => {
    page = await browser.person('pia');
    await newUserWithWorkspace(page, { label: 'phone', name: 'Pia Phone', workspace: 'Pocket Co' });
    await api(page, '/onboarding/sample-data', { method: 'POST' });
    const deals = await api(page, '/crm/deals');
    deal = deals.find((d) => d.deal.title.startsWith('Kestrel')).deal;
    screens = ['/overview', '/pipeline', '/today', '/companies', '/contacts', '/products', '/settings/general', '/settings/crm', '/settings/timeoff', '/profile', '/profile/preferences', '/profile/notifications', `/deals/${deal.id}`, `/contacts/${deal.primaryContactId}`, `/companies/${deal.companyId}`];
  });

  for (const [label, viewport] of [
    ['phone', PHONE],
    ['tablet', TABLET],
  ]) {
    step(`no screen scrolls sideways on a ${label}`, async () => {
      await page.setViewport(viewport);
      for (const path of screens) {
        await page.goto(BASE_URL + path, { waitUntil: 'networkidle0' });
        // Workspace and Profile settings (CD-524, CD-525) and the CRM (CD-530) have the glass top bar.
        await page.waitForSelector('.gs-topbar');
        assert.ok((await sideways()) <= 0, `${label} ${path} scrolls sideways by ${await sideways()}px`);
      }
    });
  }

  step('the CRM sidebar, a row of icons above the page on a phone, reaches every screen', async () => {
    await page.setViewport(PHONE);
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    // The CRM's glass sidebar (CD-530) is a row above the page on a phone, not a bottom bar.
    const row = await page.$eval('[data-testid=crm-sidebar]', (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right };
    });
    assert.ok(row.top < 100 && row.left >= 0 && row.right <= 390, JSON.stringify(row));
    assert.equal(await page.$('[data-testid=nav-more]'), null, 'no bottom bar "More" in the CRM');
    // Every CRM page, Meetings (the Calendar) included; the current one is marked.
    for (const path of ['/calendar', '/today', '/overview', '/companies', '/contacts', '/products', '/pipeline']) {
      await click(page, `[data-testid=crm-sidebar] a.gs-nav-row[href="${path}"]`);
      await page.waitForFunction((p) => location.pathname === p, {}, path);
      await page.waitForSelector(`[data-testid=crm-sidebar] a.gs-nav-row.on[href="${path}"]`);
    }
    // The CRM sidebar has no Settings link: its mark goes Home, whose tile opens Workspace settings.
    await click(page, '[data-testid=crm-sidebar] a.gs-home');
    await click(page, '[data-testid=home-modules] [data-module=settings]');
    await page.waitForFunction(() => location.pathname.startsWith('/settings'));
    // The header's search, "+" menu, notifications and account menu stay on screen.
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.crm-topbar .new-menu-btn');
    const header = await page.evaluate(() => ['.search-trigger', '.new-menu-btn', '[data-testid=notifications]', '[data-testid=account-menu]'].map((sel) => document.querySelector(sel).getBoundingClientRect().right <= window.innerWidth));
    assert.deepEqual(header, [true, true, true, true]);
  });

  step("an opportunity's to-do can be ticked on a phone", async () => {
    await page.goto(`${BASE_URL}/deals/${deal.id}`, { waitUntil: 'networkidle0' });
    const box = await page.waitForSelector('.lead-main button[title="Mark done"]');
    // To-dos come before the deal's details on a phone.
    const above = await page.evaluate(() => document.querySelector('.lead-main').getBoundingClientRect().top < document.querySelector('.lead-side').getBoundingClientRect().top);
    assert.ok(above, 'to-dos first');
    await box.tap();
    const done = await (async () => {
      for (let i = 0; i < 40; i++) {
        const tasks = await api(page, '/crm/deal-tasks');
        const t = tasks.find((x) => x.dealId === deal.id && x.done);
        if (t) return t;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    })();
    assert.ok(done, 'a to-do was saved as done');
  });

  step('a contact can be emailed with one tap on the address (there is no calling, CD-516)', async () => {
    await page.goto(`${BASE_URL}/contacts/${deal.primaryContactId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=contact-summary] .linked-field-face a');
    const links = await page.$$eval('[data-testid=contact-summary] a[href^="mailto:"], [data-testid=contact-summary] a[href^="tel:"]', (as) => as.map((a) => a.getAttribute('href')));
    assert.deepEqual(links, ['mailto:stefan@kestrel.example.com']);
  });
});
