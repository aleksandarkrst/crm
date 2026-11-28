// Company status (CD-358): a lead says what it still misses, and becomes an opportunity by itself
// once its contact is complete; it can be set back by hand and handed back to the automation.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, eventually, newUserWithWorkspace, setValue, steps, testPib, text, useBrowser } from '../lib/harness.mjs';

describe('company status', () => {
  const browser = useBrowser();
  const step = steps(browser, 'company-status');
  let page;
  let companyId;
  let contactId;
  const statusText = () => page.$eval('[data-testid=company-status]', (el) => el.innerText);
  const metaText = () => page.$eval('[data-testid=company-meta]', (el) => el.innerText);
  /** Opens one of the company page's tabs (CD-534, 28 Nov boards). */
  const openTab = async (key) => {
    await click(page, `[data-testid=tab-${key}]`);
    await page.waitForFunction((key) => document.querySelector(`[data-testid=tab-${key}]`)?.getAttribute('aria-selected') === 'true', {}, key);
  };

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

  step('the company page says it is a lead and what is missing (the readiness banner, CD-534)', async () => {
    await page.goto(`${BASE_URL}/companies/${companyId}`, { waitUntil: 'networkidle0' });
    assert.equal(await statusText(), 'Lead, automatic');
    assert.match(await metaText(), /^6 of 7 ready, owner Stella Status$/);
    const banner = await page.$eval('[data-testid=company-blockers]', (el) => el.innerText);
    assert.match(banner, /6 of 7 ready\. Missing: A contact with a role in the decision\./);
    const checks = await page.$$eval('[data-testid=readiness-check]', (els) => els.map((el) => [el.textContent, el.dataset.done]));
    assert.deepEqual(checks, [['Name', 'true'], ['PIB', 'true'], ['MB', 'true'], ['Address', 'true'], ['Activity code', 'true'], ['Owner', 'true'], ['A contact with a role in the decision', 'false']]);
    // "New opportunity" is dimmed and says what is missing instead of opening the dialog.
    assert.ok((await text(page)).includes('Complete the company first'));
    await click(page, '[data-testid=record-new-deal]');
    await page.waitForFunction(() => document.body.innerText.includes('Complete the company first. Missing: A contact with a role in the decision.'));
    assert.equal(await page.$('[data-testid=new-deal-company]'), null, 'the New opportunity dialog did not open');
    // The Opportunities tab says why a lead has none.
    await openTab('opportunities');
    assert.match(await page.$eval('[data-testid=opportunities-empty]', (el) => el.innerText), /Leads cannot have opportunities yet\s+Complete the 1 missing item in the banner above\. Vega Logistika then becomes an opportunity by itself\./);
  });

  step('"Not involved" does not count; a role in the decision does, and the page says so with a toast (CD-534)', async () => {
    await openTab('contacts');
    await click(page, '[data-testid=contact-role]');
    await click(page, '[role=option]::-p-text(Not involved)');
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await api(page, `/crm/companies/${companyId}`)).status, 'lead', 'still a lead');
    await page.waitForFunction(() => /^Lead, automatic$/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
    await click(page, '[data-testid=contact-role]');
    await click(page, '[role=option]::-p-text(Signs off budget)');
    // The toast shows for five seconds once the status is read back: watch for it from the click on.
    const toast = page.waitForFunction(() => document.body.innerText.includes('Vega Logistika is now an opportunity. You can add it to the Pipeline.'), { timeout: 15_000 });
    assert.ok(await eventually(async () => (await api(page, `/crm/companies/${companyId}`)).status === 'opportunity'), 'the API moved it');
    await toast;
    await page.waitForFunction(() => /^Opportunity, automatic$/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
    assert.equal(await page.$('[data-testid=company-blockers]'), null);
    // The status change is a line of the company's History tab.
    await openTab('history');
    await page.waitForFunction(() => document.body.innerText.includes('Status: Opportunity, automatic (was Lead)'));
    // The role change is a line of the company's History too.
    await page.waitForFunction(() => document.body.innerText.includes("changed Nikola Ilić's role in the decision from Not involved to Signs off budget"));
  });

  step('a role picked on the contact page counts the same way', async () => {
    await page.goto(`${BASE_URL}/contacts/${contactId}`, { waitUntil: 'networkidle0' });
    await setValue(page, 'select[aria-label="Role in the decision"]', '');
    assert.ok(await eventually(async () => (await api(page, `/crm/companies/${companyId}`)).status === 'lead'), 'no role: a lead again');
    await setValue(page, 'select[aria-label="Role in the decision"]', 'Decision maker');
    assert.ok(await eventually(async () => (await api(page, `/crm/companies/${companyId}`)).status === 'opportunity'), 'the API moved it');
    await page.goto(`${BASE_URL}/companies/${companyId}`, { waitUntil: 'networkidle0' });
    assert.equal(await statusText(), 'Opportunity, automatic');
  });

  // There is no "Back to automatic" any more (CD-478): a status set by hand holds until the company's
  // opportunities, projects or details change, then the automation takes over again. (A lead set back
  // by hand can't get a new opportunity, so the change here is the contact's role.)
  step('sets it back by hand; a change to its details hands it back to the automation', async () => {
    await click(page, 'button[aria-label="More actions"]');
    await click(page, '[data-testid=status-set-back]');
    await click(page, '[data-testid=status-set-back-save]');
    await page.waitForFunction(() => /^Lead, set by hand$/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await statusText(), 'Lead, set by hand', 'it holds while nothing changes');
    // "Back to automatic" is offered now (CD-534); the lead's banner is back too.
    await click(page, 'button[aria-label="More actions"]');
    await page.waitForSelector('[data-testid=status-back-auto]');
    await page.keyboard.press('Escape');
    const companyNow = async () => api(page, `/crm/companies/${companyId}`);
    // The contact loses its role: the facts change, so the automation takes over (still a lead).
    await page.goto(`${BASE_URL}/contacts/${contactId}`, { waitUntil: 'networkidle0' });
    await setValue(page, 'select[aria-label="Role in the decision"]', '');
    assert.ok(await eventually(async () => (await companyNow()).statusSetManually === false), 'no longer held by hand');
    // ...and the role back makes it an opportunity by itself again.
    await setValue(page, 'select[aria-label="Role in the decision"]', 'Decision maker');
    assert.ok(await eventually(async () => (await companyNow()).status === 'opportunity'), 'the API moved it');
    await page.goto(`${BASE_URL}/companies/${companyId}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => /^Opportunity, automatic$/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
  });

  // CD-534 staging QA (case 7): an opportunity with no opportunities of its own goes back to Lead the
  // moment a check is emptied on the Details tab, and the banner names it, without a reload. It stays
  // a lead when a colleague's change elsewhere makes the page re-read other lists (on staging it went
  // back to "Opportunity, automatic": the last load still had the company as it was). A change that
  // names no opportunity (a project's task) asks the API for nothing (it asked for `dealIds=`, a 400).
  step('clearing MB on the Details tab makes it a lead at once, and a change by a colleague elsewhere keeps it one', async () => {
    const refused = [];
    let lastResponse = Date.now();
    const onResponse = (r) => {
      if (r.url().includes('/api/')) lastResponse = Date.now();
      if (r.url().includes('/api/') && r.status() >= 400) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}${new URL(r.url()).search} ${r.status()}`);
    };
    page.on('response', onResponse);
    // The page's API calls have gone quiet (the live stream stays open, so not waitForNetworkIdle).
    const quiet = () => eventually(() => Date.now() - lastResponse > 800, { timeout: 10_000, interval: 100 });
    const isLead = async () => {
      assert.equal(await statusText(), 'Lead, automatic');
      assert.match(await page.$eval('[data-testid=company-blockers]', (el) => el.innerText), /6 of 7 ready\. Missing: MB\./);
    };
    try {
      assert.equal(await statusText(), 'Opportunity, automatic');
      await openTab('details');
      await setValue(page, '[data-testid=company-field-mb]', '');
      await page.waitForFunction(() => /^Lead, automatic$/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
      await isLead();
      assert.equal((await api(page, `/crm/companies/${companyId}`)).status, 'lead', 'the API agrees');
      // A colleague adds a contact at another company (calls from the test carry no tab id, so the
      // page hears them as someone else's): the page re-reads the contacts, the company stays a lead.
      const other = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Colleague Co', pib: testPib() }) });
      const contactsRead = page.waitForResponse((r) => r.url().includes('/api/crm/contacts?ids='));
      await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ companyId: other.id, fullName: 'Colleague Contact' }) });
      await contactsRead;
      await quiet();
      await isLead();
      // ...and adds a task to a project: the hint names no opportunity, so no to-dos are read.
      const [type] = await api(page, '/project-types');
      const project = await api(page, '/projects', { method: 'POST', body: JSON.stringify({ name: 'Colleague project', projectTypeId: type.id, companyId: other.id }) });
      await api(page, '/tasks', { method: 'POST', body: JSON.stringify({ projectId: project.id, name: 'Colleague task' }) });
      await new Promise((r) => setTimeout(r, 300)); // the hint is debounced 300 ms before anything is read
      await quiet();
      await isLead();
      // MB filled in again: an opportunity at once, and still one after the next change elsewhere.
      await setValue(page, '[data-testid=company-field-mb]', '20084693');
      await page.waitForFunction(() => /^Opportunity, automatic$/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
      assert.equal(await page.$('[data-testid=company-blockers]'), null, 'no banner once it is an opportunity');
      const contactsAgain = page.waitForResponse((r) => r.url().includes('/api/crm/contacts?ids='));
      await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ companyId: other.id, fullName: 'Second Colleague Contact' }) });
      await contactsAgain;
      await quiet();
      assert.equal(await statusText(), 'Opportunity, automatic');
      assert.deepEqual(refused, [], 'no request was refused');
    } finally {
      page.off('response', onResponse);
    }
  });

  step('a lead is marked not interested with the board\'s dialog, and comes back with "Back to automatic"', async () => {
    const lead = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Quiet Lead', pib: testPib() }) });
    await page.goto(`${BASE_URL}/companies/${lead.id}`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="More actions"]');
    await click(page, '[data-testid=status-set-back]');
    const dialog = await page.waitForSelector('[data-testid=set-status-dialog]');
    assert.equal(await dialog.evaluate((el) => el.querySelector('h2').textContent), 'Mark Quiet Lead as not interested?');
    assert.ok((await dialog.evaluate((el) => el.innerText)).includes('It leaves the lead list. Pultly will not raise it again by itself until you choose Back to automatic.'));
    await clickButton(page, 'Mark not interested');
    await page.waitForFunction(() => /^Not interested, set by hand$/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
    assert.equal(await page.$('[data-testid=company-blockers]'), null, 'no banner once it is not a lead');
    await click(page, 'button[aria-label="More actions"]');
    await click(page, '[data-testid=status-back-auto]');
    await page.waitForFunction(() => /^Lead, automatic$/.test(document.querySelector('[data-testid=company-status]')?.innerText ?? ''));
    assert.ok(await eventually(async () => (await api(page, `/crm/companies/${lead.id}`)).statusSetManually === false), 'automatic again');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
