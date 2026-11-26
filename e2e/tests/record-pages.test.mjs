// CD-80: company and contact pages like the deal page: the header names the screen, the record
// has its own header with owner, "+ Deal" (starting from this company or contact) and Delete in
// the menu, and sections for its details, deals, contacts, tasks and history. CD-209: the company's
// domain (a link) and notes, and the contact's LinkedIn, edit in place and show in the history.
// CD-534: the company page is the glass board C-Company (breadcrumb, status tag, Company
// information, Contacts with their own dialog, Details with owner and source dropdowns, one History).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, confirmInApp, createNew, createReadyCompany, eventually, newUserWithWorkspace, READY_IDENTITY, setByLabel, steps, text, useBrowser, testPib } from '../lib/harness.mjs';

/** Presses the red button of a glass confirm on the company page (CD-534) and resolves to its title. */
async function confirmCompanyGlass(page, testId) {
  const dialog = await page.waitForSelector(`[data-testid=${testId}]`);
  const title = await dialog.evaluate((el) => el.querySelector('h2').textContent);
  await click(page, `[data-testid=${testId}] [data-testid=gs-confirm]`);
  await page.waitForFunction((id) => !document.querySelector(`[data-testid=${id}]`), {}, testId);
  return title;
}

describe('company and contact pages', () => {
  const browser = useBrowser();
  const step = steps(browser, 'record-pages');
  let page;
  let company;
  let contact;
  let empty;
  let unowned;
  let deal;

  step('sets up a company with a contact and an opportunity, and an empty company', async () => {
    page = await browser.person('rhea');
    await newUserWithWorkspace(page, { label: 'records', name: 'Rhea Records', workspace: 'Records Co' });
    const funnels = await api(page, '/crm/funnels');
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Umbrella d.o.o.', industry: 'Pharmaceuticals', hq: 'Niš', ...READY_IDENTITY }) });
    contact = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Alice Abernathy', companyId: company.id, email: 'alice@umbrella.test', jobTitle: 'COO', buyerRole: 'Decision maker' }) });
    deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Umbrella rollout', funnelId: funnels[0].id, companyId: company.id, primaryContactId: contact.id }) });
    empty = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ pib: testPib(), name: 'Empty Shell d.o.o.' }) });
    unowned = { id: await createReadyCompany(page, 'Nobody Owns d.o.o.', 'Petar Nikolić', { ownerUserId: null }) };
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Unowned company opportunity', funnelId: funnels[0].id, companyId: unowned.id }) });
    await page.reload({ waitUntil: 'networkidle0' });
  });

  step('the company page: screen name in the header, the record below, its opportunities and contacts', async () => {
    await page.goto(`${BASE_URL}/companies/${company.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.textContent === 'Umbrella d.o.o.');
    assert.equal(await page.$eval('header.crm-topbar h1', (el) => el.textContent), 'Companies');
    // The glass header (CD-534): breadcrumb, status tag and the meta line.
    assert.equal(await page.$eval('[data-testid=company-status]', (el) => el.textContent), 'Opportunity, automatic');
    assert.match(await page.$eval('[data-testid=company-meta]', (el) => el.textContent), /^Ready for the Pipeline, owner Rhea Records$/);
    assert.equal(await page.$('[data-testid=company-blockers]'), null, 'no readiness banner on an opportunity');
    assert.match(await page.$eval('[data-testid=record-deals]', (el) => el.innerText), /Open opportunities \(1\)[\s\S]*Umbrella rollout/);
    assert.match(await page.$eval('[data-testid=company-contacts]', (el) => el.innerText), /Alice Abernathy[\s\S]*COO, alice@umbrella.test/);
    assert.equal(await page.$eval('[data-testid=company-opportunities]', (el) => el.textContent), '1 opportunity');
    assert.ok(!(await text(page)).includes('Delete company'), 'Delete is in the menu');
    assert.ok(await setByLabel(page, 'HQ', 'Beograd'), 'HQ field found');
    assert.ok(await eventually(async () => (await api(page, '/crm/companies/' + company.id)).hq === 'Beograd'), 'HQ saved');
  });

  /** Types into a field checked when it is left (CD-224: Domain, LinkedIn) and leaves it with Tab. */
  const typeAndLeave = async (label, value) => {
    // At its right end: the value itself is a link (CD-516), the end of the field edits it.
    const box = await (await page.$(`input[aria-label="${label}"]`)).boundingBox();
    await page.mouse.click(box.x + box.width - 10, box.y + box.height / 2);
    await page.$eval(`input[aria-label="${label}"]`, (el) => el.select());
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value);
    await page.keyboard.press('Tab');
  };

  /** Waits until the record's history (one list now: the Changes tab is gone) mentions `label`. */
  const changesInclude = async (label) => {
    await page.waitForFunction((label) => document.querySelector('[data-testid="change-history"]')?.innerText.includes(label), { timeout: 10_000 }, label);
    return page.$eval('[data-testid="change-history"]', (el) => el.innerText);
  };

  step('the company page edits the domain (shown as a link) and multi-line notes (CD-209)', async () => {
    // CD-224: an invalid domain shows an error and is not saved; a pasted address keeps its host.
    await typeAndLeave('Domain', 'not a domain!!');
    await page.waitForFunction(() => document.querySelector('[data-testid=field-error]')?.textContent.includes('acme.com'));
    assert.ok(!(await api(page, '/crm/companies/' + company.id)).domain, 'an invalid domain is not saved');
    await typeAndLeave('Domain', 'https://Umbrella.test/about');
    await page.waitForFunction(() => document.querySelector('[data-testid=field-hint]')?.textContent === 'Saved as umbrella.test');
    assert.equal(await page.$eval('input[aria-label="Domain"]', (el) => el.value), 'umbrella.test');
    assert.ok(await setByLabel(page, 'Notes', 'Two plants.\nBuys through the Niš office.', 'textarea'), 'Notes field found');
    const saved = await eventually(async () => {
      const c = await api(page, '/crm/companies/' + company.id);
      return c.domain === 'umbrella.test' && c.notes === 'Two plants.\nBuys through the Niš office.' && c;
    });
    assert.ok(saved, 'domain and notes saved');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('input[aria-label="Domain"]')?.value === 'umbrella.test');
    assert.equal(await page.$eval('textarea[aria-label="Notes"]', (el) => el.value), 'Two plants.\nBuys through the Niš office.');
    assert.equal(await page.$eval('a[aria-label="Open umbrella.test"]', (el) => el.getAttribute('href')), 'https://umbrella.test');
    const changes = await changesInclude('Domain');
    assert.ok(changes.includes('umbrella.test') && changes.includes('Notes'), changes);
  });

  step('"+ Opportunity" starts the New opportunity dialog with this company', async () => {
    await click(page, '[data-testid=record-new-deal]');
    await page.waitForSelector('::-p-text(Create & start funnel)');
    const picked = await page.$eval('[data-testid=new-deal-company]', (el) => el.value);
    assert.equal(picked, company.id);
    await clickButton(page, 'Cancel');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  });

  step('Escape closes New opportunity from the + menu, a labelled dialog (CD-490)', async () => {
    await createNew(page, 'deal');
    await page.waitForSelector('.modal[role=dialog][aria-modal=true]');
    assert.equal(await page.$eval('.modal[role=dialog]', (el) => document.getElementById(el.getAttribute('aria-labelledby'))?.textContent), 'New opportunity');
    assert.ok(await page.$eval('.modal[role=dialog]', (el) => el.contains(document.activeElement)), 'focus moved into the dialog');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    // Focus goes back to what opened it, the + button (CD-490 QA).
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'new-menu');
  });

  step('Escape on a modal with typed input asks to discard it first (CD-490 QA)', async () => {
    await createNew(page, 'company');
    await page.waitForSelector('[data-testid=new-company-name]');
    await page.type('[data-testid=new-company-name]', 'TEST-CD490-esc');
    await page.keyboard.press('Escape');
    // Cancel keeps the dialog and what was typed.
    assert.equal(await confirmInApp(page, { ok: false }), 'Discard your changes?');
    assert.equal(await page.$eval('[data-testid=new-company-name]', (el) => el.value), 'TEST-CD490-esc');
    await page.keyboard.press('Escape');
    assert.equal(await confirmInApp(page), 'Discard your changes?');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'new-menu');
  });

  step("Escape closes the opportunity's ⋯ menu and gives the focus back to ⋯ (CD-490)", async () => {
    await page.goto(`${BASE_URL}/deals/${deal.id}`, { waitUntil: 'networkidle0' });
    await click(page, '.deal-header button[aria-label="More actions"]');
    await page.waitForSelector('[data-testid=delete-deal]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=delete-deal]'));
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'More actions');
  });

  step('the contact page: header, summary, company and opportunities', async () => {
    await page.goto(`${BASE_URL}/contacts/${contact.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.value === 'Alice Abernathy');
    assert.equal(await page.$eval('header.crm-topbar h1', (el) => el.textContent), 'Contacts');
    assert.match(await page.$eval('[data-testid=contact-company]', (el) => el.innerText), /Umbrella d\.o\.o\./);
    assert.match(await page.$eval('[data-testid=record-deals]', (el) => el.innerText), /Umbrella rollout/);
    assert.ok(await setByLabel(page, 'Role', 'Chief Operating Officer'), 'Role field found');
    assert.ok(await eventually(async () => (await api(page, '/crm/contacts/' + contact.id)).jobTitle === 'Chief Operating Officer'), 'role saved');
  });

  step('the contact page edits LinkedIn, a link when it is a web address (CD-209)', async () => {
    // Alice is the deal's primary contact, so this goes through the deal's copy of her too.
    // A profile path is saved as a linkedin.com address (CD-224).
    await typeAndLeave('LinkedIn', 'in/alice-abernathy');
    assert.ok(await eventually(async () => (await api(page, '/crm/contacts/' + contact.id)).linkedin === 'linkedin.com/in/alice-abernathy'), 'LinkedIn saved');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('input[aria-label="LinkedIn"]')?.value === 'linkedin.com/in/alice-abernathy');
    assert.equal(await page.$eval('a[aria-label="Open Alice Abernathy on LinkedIn"]', (el) => el.getAttribute('href')), 'https://linkedin.com/in/alice-abernathy');
    assert.ok((await changesInclude('LinkedIn')).includes('alice-abernathy'));

    // Anything else shows an error when the field is left and is not saved (CD-224).
    await typeAndLeave('LinkedIn', 'not a url');
    await page.waitForFunction(() => document.querySelector('[data-testid=field-error]')?.textContent.includes('linkedin.com/in/name'));
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await api(page, '/crm/contacts/' + contact.id)).linkedin, 'linkedin.com/in/alice-abernathy');
  });

  step('the new fields fit a 375 px phone', async () => {
    await page.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true });
    for (const path of [`/companies/${company.id}`, `/contacts/${contact.id}`]) {
      await page.goto(BASE_URL + path, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid=record-name]');
      const sideways = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
      assert.ok(sideways <= 0, `${path} scrolls sideways by ${sideways}px`);
      const field = path.startsWith('/companies') ? 'Domain' : 'LinkedIn';
      const box = await page.$eval(`input[aria-label="${field}"]`, (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      });
      assert.ok(box.left >= 0 && box.right <= 375 && box.width > 60, `${field} fits: ${JSON.stringify(box)}`);
    }
    await page.setViewport({ width: 1400, height: 1100 });
  });

  step('a company without an owner shows "No owner", not the owner of its opportunity', async () => {
    await page.goto(`${BASE_URL}/companies/${unowned.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.textContent === 'Nobody Owns d.o.o.');
    assert.equal(await page.$eval('[data-testid=company-owner]', (el) => el.dataset.value), '');
    assert.equal(await page.$eval('[data-testid=company-owner]', (el) => el.textContent), 'No owner');
    // Without an owner it is a lead (CD-533): the banner names the missing check.
    assert.equal(await page.$eval('[data-testid=company-status]', (el) => el.textContent), 'Lead, automatic');
    assert.match(await page.$eval('[data-testid=company-blockers]', (el) => el.innerText), /6 of 7 ready\. Missing: Owner\./);
  });

  step('"+ Contact" on a company without opportunities adds the contact to that company (CD-534)', async () => {
    await page.goto(`${BASE_URL}/companies/${empty.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=company-contacts]')?.innerText.includes('No contacts yet'));
    await click(page, '[data-testid=company-add-contact]');
    await page.waitForSelector('[data-testid=company-contact-dialog]');
    assert.equal(await page.$eval('[data-testid=company-contact-dialog] h2', (el) => el.textContent), 'New contact at Empty Shell d.o.o.');
    // The name is required: pressed empty, the dialog says so and stays.
    await click(page, '[data-testid=contact-dialog-save]');
    await page.waitForFunction(() => document.body.innerText.includes("Enter the contact's name."));
    await page.type('[data-testid=contact-dialog-name]', 'Nora Newhire');
    await page.type('[data-testid=contact-dialog-title]', 'Office manager');
    await click(page, '[data-testid=contact-dialog-roles] button::-p-text(User)');
    await click(page, '[data-testid=contact-dialog-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=company-contact-dialog]'));
    const added = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Nora Newhire'));
    assert.equal(added?.companyId, empty.id);
    assert.equal(added?.buyerRole, 'User');
    await page.waitForFunction(() => document.querySelector('[data-testid=company-contacts]')?.innerText.includes('Nora Newhire'));
    assert.equal(await page.$eval('[data-testid=contact-role]', (el) => el.dataset.value), 'User');
    assert.equal(await page.$('[data-testid=no-role-badge]'), null, 'a contact with a role has no Missing role tag');
    // The toast and the history line come at once.
    await page.waitForFunction(() => document.body.innerText.includes('Nora Newhire added to Empty Shell d.o.o.'));
    assert.ok((await changesInclude('added Nora Newhire as a contact')).includes('Rhea Records added Nora Newhire as a contact'));
  });

  step('"Edit contact" changes the contact from the same dialog; "Remove from" unlinks them and keeps them in Contacts', async () => {
    await click(page, '[data-testid=contact-menu]');
    await click(page, '[data-testid=contact-edit]');
    await page.waitForSelector('[data-testid=company-contact-dialog]');
    assert.equal(await page.$eval('[data-testid=company-contact-dialog] h2', (el) => el.textContent), 'Edit Nora Newhire');
    assert.equal(await page.$eval('[data-testid=contact-dialog-title]', (el) => el.value), 'Office manager');
    await page.$eval('[data-testid=contact-dialog-title]', (el) => el.select());
    await page.keyboard.type('Head of office');
    await clickButton(page, 'Save');
    await page.waitForFunction(() => !document.querySelector('[data-testid=company-contact-dialog]'));
    const nora = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Nora Newhire'));
    assert.equal(nora?.jobTitle, 'Head of office');
    await page.waitForFunction(() => document.querySelector('[data-testid=company-contacts]')?.innerText.includes('Head of office'));

    await click(page, '[data-testid=contact-menu]');
    await click(page, '[data-testid=contact-remove]');
    assert.equal(await confirmCompanyGlass(page, 'remove-contact-confirm'), 'Remove Nora Newhire from Empty Shell d.o.o.?');
    await page.waitForFunction(() => document.querySelector('[data-testid=company-contacts]')?.innerText.includes('No contacts yet'));
    const kept = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Nora Newhire'));
    assert.equal(kept?.companyId, null, 'the contact stays, without a company');
    assert.ok((await changesInclude('removed Nora Newhire as a contact')).includes('removed Nora Newhire as a contact'));
  });

  step('a company with only a City (as imports fill it) still links to the map (CD-516)', async () => {
    await api(page, `/crm/companies/${empty.id}`, { method: 'PATCH', body: JSON.stringify({ city: 'Novi Sad' }) });
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('input[aria-label="HQ"]', (el) => el.value.replace('—', '')), '', 'no HQ');
    const link = await page.waitForSelector('a[aria-label="Open in Maps"]');
    assert.deepEqual(await link.evaluate((a) => ({ text: a.innerText.trim(), href: a.getAttribute('href'), target: a.target })), {
      text: 'Open in Maps',
      href: 'https://www.google.com/maps/search/?api=1&query=Empty%20Shell%20d.o.o.%2C%20Novi%20Sad',
      target: '_blank',
    });
  });

  step('a wrong PIB turns the field red and is not saved; the source dropdown saves with a toast', async () => {
    await page.$eval('[data-testid=company-field-pib]', (el) => el.select());
    await page.keyboard.type('1234');
    await page.waitForFunction(() => document.body.innerText.includes('A PIB has 9 digits.'));
    assert.equal(await page.$eval('[data-testid=company-field-pib]', (el) => el.getAttribute('aria-invalid')), 'true');
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((await api(page, '/crm/companies/' + empty.id)).pib, empty.pib, 'the wrong PIB was not sent');
    await page.keyboard.press('Tab');
    await page.waitForFunction((pib) => document.querySelector('[data-testid=company-field-pib]')?.value === pib, {}, empty.pib);
    await click(page, '[data-testid=company-source]');
    await click(page, '[role=option]::-p-text(Trade fair)');
    await page.waitForFunction(() => document.body.innerText.includes('Source changed to Trade fair'));
    assert.ok(await eventually(async () => (await api(page, '/crm/companies/' + empty.id)).source === 'Trade fair'), 'source saved');
    assert.ok((await changesInclude('changed Source')).includes('changed Source from empty to Trade fair'));
  });

  step('the owner deletes an empty company from the menu', async () => {
    await page.goto(`${BASE_URL}/companies/${empty.id}`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="More actions"]');
    await clickButton(page, 'Delete company');
    assert.equal(await confirmCompanyGlass(page, 'delete-company-confirm'), `Delete ${empty.name}?`);
    await page.waitForFunction(() => location.pathname === '/companies');
    assert.ok(await eventually(async () => !(await api(page, '/crm/companies')).some((c) => c.id === empty.id)), 'company deleted');
  });

  step('a company with an opportunity cannot be deleted: the menu item is off and says why', async () => {
    await page.goto(`${BASE_URL}/companies/${company.id}`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="More actions"]');
    const item = await page.waitForSelector('[data-testid=delete-company]');
    assert.deepEqual(await item.evaluate((el) => ({ disabled: el.disabled, title: el.title })), { disabled: true, title: 'Umbrella d.o.o. has an opportunity: delete them or move them to another company first' });
    await page.keyboard.press('Escape');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
