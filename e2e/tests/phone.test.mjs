// Tablets and phones (CD-70): no sideways page scroll at 390×844 or 768×1024, navigation stays
// reachable (bottom bar and "More"), a deal's to-do can be ticked, and a contact can be called or
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
    screens = ['/overview', '/pipeline', '/today', '/companies', '/contacts', '/products', '/settings/workspace', '/settings/funnel', '/profile', `/deals/${deal.id}`, `/contacts/${deal.primaryContactId}`, `/companies/${deal.companyId}`];
  });

  for (const [label, viewport] of [
    ['phone', PHONE],
    ['tablet', TABLET],
  ]) {
    step(`no screen scrolls sideways on a ${label}`, async () => {
      await page.setViewport(viewport);
      for (const path of screens) {
        await page.goto(BASE_URL + path, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.screen-header');
        assert.ok((await sideways()) <= 0, `${label} ${path} scrolls sideways by ${await sideways()}px`);
      }
    });
  }

  step('the bottom bar and "More" reach every screen on a phone', async () => {
    await page.setViewport(PHONE);
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    const bar = await page.$eval('.app-sidebar', (el) => {
      const r = el.getBoundingClientRect();
      return { bottom: Math.round(r.bottom), width: Math.round(r.width) };
    });
    assert.deepEqual(bar, { bottom: 844, width: 390 });
    await click(page, '.app-sidebar a[href="/today"]');
    await page.waitForFunction(() => location.pathname === '/today');
    for (const [label, path] of [
      ['Overview', '/overview'],
      ['Products', '/products'],
      ['Settings', '/settings'],
    ]) {
      await click(page, '[data-testid=nav-more]');
      await page.waitForSelector('[data-testid=more-sheet]');
      await click(page, `[data-testid=more-sheet] a[href="${path}"]`);
      await page.waitForFunction((p) => location.pathname.startsWith(p), {}, path);
      assert.equal(await page.$('[data-testid=more-sheet]'), null, `sheet closes after ${label}`);
    }
    // The header's search and "New" menu stay on screen.
    await page.goto(BASE_URL + '/contacts', { waitUntil: 'networkidle0' });
    await page.waitForSelector('.screen-header .new-menu-btn');
    const header = await page.evaluate(() => [...document.querySelectorAll('.search-box, .new-menu-btn')].map((el) => el.getBoundingClientRect().right <= window.innerWidth));
    assert.deepEqual(header, [true, true]);
  });

  step("a deal's to-do can be ticked on a phone", async () => {
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

  step('a contact can be called or emailed with one tap', async () => {
    await page.goto(`${BASE_URL}/contacts/${deal.primaryContactId}`, { waitUntil: 'networkidle0' });
    const links = await page.$$eval('a.contact-action', (as) => as.map((a) => a.getAttribute('href')));
    assert.deepEqual(links, ['mailto:stefan@kestrel.example.com', 'tel:+381115550187']);
  });
});
