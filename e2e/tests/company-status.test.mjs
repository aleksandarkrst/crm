// Company status (CD-358): a lead says what it still misses, and becomes an opportunity by itself
// once its contact is complete; it can be set back by hand and handed back to the automation.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, setValue, steps, testPib, useBrowser } from '../lib/harness.mjs';

describe('company status', () => {
  const browser = useBrowser();
  const step = steps(browser, 'company-status');
  let page;
  let companyId;
  let contactId;
  const statusText = () => page.$eval('[data-testid=company-status]', (el) => el.innerText);

  step('sets up a lead with its identity and a contact without a role in the decision', async () => {
    page = await browser.person('stella');
    await newUserWithWorkspace(page, { label: 'company-status', name: 'Stella Status', workspace: 'Status Co' });
    const me = (await api(page, '/profile')).userId;
    companyId = (
      await api(page, '/crm/companies', {
        method: 'POST',
        body: JSON.stringify({ name: 'Vega Logistika', pib: testPib(), mb: '20084693', activityCode: '4941', address: 'Bulevar 10', city: 'Novi Sad', postalCode: '21000' }),
      })
    ).id;
    contactId = (await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ companyId, fullName: 'Nikola Ilić', jobTitle: 'Managing director', ownerUserId: me }) })).id;
  });

  step('the company page says it is a lead and what is missing', async () => {
    await page.goto(`${BASE_URL}/companies/${companyId}`, { waitUntil: 'networkidle0' });
    assert.match(await statusText(), /Lead\s+automatic · 6 of 7 ready/);
    assert.match(await page.$eval('[data-testid=company-blockers]', (el) => el.innerText), /Nikola Ilić has no role in the decision yet/);
  });

  step('completing the contact makes it an opportunity, without a click on the company', async () => {
    await page.goto(`${BASE_URL}/contacts/${contactId}`, { waitUntil: 'networkidle0' });
    await setValue(page, 'select[aria-label="Role in the decision"]', 'Decision maker');
    assert.ok(await eventually(async () => (await api(page, `/crm/companies/${companyId}`)).status === 'opportunity'), 'the API moved it');
    await page.goto(`${BASE_URL}/companies/${companyId}`, { waitUntil: 'networkidle0' });
    assert.match(await statusText(), /Opportunity\s+automatic/);
    assert.equal(await page.$('[data-testid=company-blockers]'), null);
    await page.waitForFunction(() => document.body.innerText.includes('Status: Opportunity · automatic'));
  });

  step('sets it back by hand, then hands it back to the automation', async () => {
    await click(page, 'button[aria-label="More actions"]');
    await click(page, '[data-testid=status-set-back]');
    await click(page, '[data-testid=status-set-back-save]');
    await page.waitForFunction(() => /Lead\s+set by hand/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
    await click(page, 'button[aria-label="More actions"]');
    await click(page, '[data-testid=status-automatic]');
    await page.waitForFunction(() => /Opportunity\s+automatic/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
