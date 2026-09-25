// CD-20: the live-update stream closes when the page is left. Before, each full page load left a
// stream open, and after six loads the browser's connections to the server were used up: the next
// request (e.g. Overview's stage history) waited forever.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { BASE_URL, newUserWithWorkspace, steps, useBrowser } from '../lib/harness.mjs';

describe('live updates across page loads', () => {
  const browser = useBrowser();
  const step = steps(browser, 'live-reloads');
  let page;

  step('ten full page loads in a row all finish, Overview last', async () => {
    page = await browser.person('lou');
    await newUserWithWorkspace(page, { label: 'reloads', name: 'Lou Loader', workspace: 'Reload Co' });
    const paths = ['/pipeline', '/today', '/companies', '/contacts', '/products', '/pipeline', '/today', '/companies', '/contacts', '/overview'];
    for (const path of paths) {
      await page.goto(BASE_URL + path, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.screen-header');
    }
    await page.waitForFunction(() => document.body.innerText.includes('Nothing to measure yet'));
    assert.equal(new URL(page.url()).pathname, '/overview');
  });
});
