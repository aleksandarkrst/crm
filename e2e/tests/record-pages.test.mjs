// CD-80: company and contact pages like the deal page: the header names the screen, the record
// has its own header with owner, "+ Deal" (starting from this company or contact) and Delete in
// the menu, and sections for its details, deals, contacts, tasks and history. CD-209: the company's
// domain (a link) and notes, and the contact's LinkedIn, edit in place and show in the history.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, eventually, newUserWithWorkspace, setByLabel, steps, text, useBrowser } from '../lib/harness.mjs';

describe('company and contact pages', () => {
  const browser = useBrowser();
  const step = steps(browser, 'record-pages');
  let page;
  let company;
  let contact;
  let empty;
  let unowned;

  step('sets up a company with a contact and a deal, and an empty company', async () => {
    page = await browser.person('rhea');
    await newUserWithWorkspace(page, { label: 'records', name: 'Rhea Records', workspace: 'Records Co' });
    const funnels = await api(page, '/crm/funnels');
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Umbrella d.o.o.', industry: 'Pharmaceuticals', hq: 'Niš' }) });
    contact = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Alice Abernathy', companyId: company.id, email: 'alice@umbrella.test', jobTitle: 'COO' }) });
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Umbrella rollout', funnelId: funnels[0].id, companyId: company.id, primaryContactId: contact.id }) });
    empty = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Empty Shell d.o.o.' }) });
    unowned = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: 'Nobody Owns d.o.o.', ownerUserId: null }) });
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Unowned company deal', funnelId: funnels[0].id, companyId: unowned.id }) });
    await page.reload({ waitUntil: 'networkidle0' });
  });

  step('the company page: screen name in the header, the record below, its deals and contacts', async () => {
    await page.goto(`${BASE_URL}/companies/${company.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.value === 'Umbrella d.o.o.');
    assert.equal(await page.$eval('header h1', (el) => el.textContent), 'Company');
    assert.match(await page.$eval('[data-testid=record-deals]', (el) => el.innerText), /Open deals \(1\)[\s\S]*Umbrella rollout/);
    assert.match(await page.$eval('[data-testid=company-contacts]', (el) => el.innerText), /Alice Abernathy/);
    assert.ok(!(await text(page)).includes('Delete company'), 'Delete is in the menu');
    assert.ok(await setByLabel(page, 'HQ', 'Beograd'), 'HQ field found');
    assert.ok(await eventually(async () => (await api(page, '/crm/companies/' + company.id)).hq === 'Beograd'), 'HQ saved');
  });

  /** Types into a field checked when it is left (CD-224: Domain, LinkedIn) and leaves it with Tab. */
  const typeAndLeave = async (label, value) => {
    await page.click(`input[aria-label="${label}"]`);
    await page.$eval(`input[aria-label="${label}"]`, (el) => el.select());
    await page.keyboard.press('Backspace');
    await page.keyboard.type(value);
    await page.keyboard.press('Tab');
  };

  /** Opens the Changes view of the record's history and waits until it mentions `label`. */
  const changesInclude = async (label) => {
    await click(page, '[data-testid="history-changes"]');
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

  step('"+ Deal" starts the New deal dialog with this company', async () => {
    await click(page, '[data-testid=record-new-deal]');
    await page.waitForSelector('::-p-text(Create & start funnel)');
    const picked = await page.$eval('.modal select', (el) => el.value);
    assert.equal(picked, company.id);
    await clickButton(page, 'Cancel');
    await page.waitForFunction(() => !document.querySelector('.modal'));
  });

  step('the contact page: header, summary, company and deals', async () => {
    await page.goto(`${BASE_URL}/contacts/${contact.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.value === 'Alice Abernathy');
    assert.equal(await page.$eval('header h1', (el) => el.textContent), 'Contact');
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

  step('a company without an owner shows "No owner", not the owner of its deal', async () => {
    await page.goto(`${BASE_URL}/companies/${unowned.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=record-name]')?.value === 'Nobody Owns d.o.o.');
    assert.equal(await page.$eval('select[aria-label="Owner"]', (el) => el.value), '');
    assert.equal(await page.$eval('select[aria-label="Owner"]', (el) => el.selectedOptions[0].textContent), 'No owner');
  });

  step('"Add a contact" on a company without deals adds the contact to that company', async () => {
    await page.goto(`${BASE_URL}/companies/${empty.id}`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="Add a contact"]');
    await page.waitForSelector('.modal input[placeholder="e.g. Ana Marković"]');
    assert.equal(await page.$eval('.modal input[readonly]', (el) => el.value), 'Empty Shell d.o.o.');
    await page.type('.modal input[placeholder="e.g. Ana Marković"]', 'Nora Newhire');
    await clickButton(page, 'Add contact');
    await page.waitForFunction(() => !document.querySelector('.modal'));
    const added = await eventually(async () => (await api(page, '/crm/contacts')).find((c) => c.fullName === 'Nora Newhire'));
    assert.equal(added?.companyId, empty.id);
    await page.waitForFunction(() => document.querySelector('[data-testid=company-contacts]')?.innerText.includes('Nora Newhire'));
  });

  step('the owner deletes an empty company from the menu', async () => {
    await page.goto(`${BASE_URL}/companies/${empty.id}`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="More actions"]');
    await clickButton(page, 'Delete company');
    await page.waitForFunction(() => location.pathname === '/companies');
    assert.ok(await eventually(async () => !(await api(page, '/crm/companies')).some((c) => c.id === empty.id)), 'company deleted');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
