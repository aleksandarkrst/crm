// Company identity (CD-357): New company is a dialog that needs the name and a valid PIB, a PIB the
// workspace already has offers the existing company, and the list and page show the Company ID.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, newUserWithWorkspace, steps, testPib, useBrowser } from '../lib/harness.mjs';

describe('company identity', () => {
  const browser = useBrowser();
  const step = steps(browser, 'company identity');
  let page;
  const pib = testPib();

  step('sets up a workspace', async () => {
    page = await browser.person('ida');
    await newUserWithWorkspace(page, { label: 'company-identity', name: 'Ida Identity', workspace: 'Identity Co' });
  });

  step('New company asks for a valid PIB, then creates a lead with its Company ID', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    await click(page, '.filter-actions .btn-primary');
    await page.type('[data-testid=new-company-name]', 'Vega Logistika d.o.o.');
    await page.type('[data-testid=new-company-pib]', '10405213');
    await click(page, '[data-testid=new-company-create]');
    assert.match(await page.$eval('[role=alert]', (el) => el.textContent), /9 digits; this one has 8/);
    await page.$eval('[data-testid=new-company-pib]', (el) => el.select());
    await page.type('[data-testid=new-company-pib]', pib);
    await page.select('[data-testid=new-company-ownership]', 'private');
    await click(page, '[data-testid=new-company-create]');
    await page.waitForFunction(() => /^\/companies\/[0-9a-f-]+$/.test(location.pathname));
    await page.waitForSelector('[data-testid=company-identity]');
    assert.equal(await page.$eval('[data-testid=company-identity] input[aria-label="Company ID (PIB)"]', (el) => el.value), pib);
  });

  step('the list shows the Company ID and the ownership', async () => {
    await page.goto(BASE_URL + '/companies', { waitUntil: 'networkidle0' });
    const row = await page.$eval('.table-row', (el) => el.innerText);
    assert.match(row, new RegExp(`Vega Logistika d.o.o.\\s+${pib}\\s+Private`));
  });

  step('the same PIB again offers the existing company instead', async () => {
    await click(page, '.filter-actions .btn-primary');
    await page.type('[data-testid=new-company-name]', 'Vega Copy');
    await page.type('[data-testid=new-company-pib]', pib);
    await click(page, '[data-testid=new-company-create]');
    await page.waitForSelector('[data-testid=new-company-error]');
    assert.match(await page.$eval('[data-testid=new-company-error]', (el) => el.textContent), /already exists: Vega Logistika d\.o\.o\./);
    await click(page, '[data-testid=new-company-error] button');
    await page.waitForFunction(() => /^\/companies\/[0-9a-f-]+$/.test(location.pathname));
    assert.equal((await api(page, '/crm/companies')).length, 1, 'no second company');
  });
});
