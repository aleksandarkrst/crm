// The employee card (CD-140; one Save for the whole card since CD-225): a member opens their own
// card from Profile, changes their work phone and address inline and saves once, enters a Serbian
// account number that is saved as its IBAN, shown masked and revealed with "Show"; leaving with
// unsaved changes asks first; they don't see a colleague's personal details or bank account; the
// owner edits several sections of someone's card with one Save; the card has no App access,
// History, Roles or "Timesheet required"; the owner deactivates someone with a direct report from
// the "⋯" menu, who moves to the chosen manager, and Delete appears only then; on a phone the card
// fits the screen.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, createWorkspace, email, eventually, finishOnboarding, setValue, signIn, steps, text, useBrowser } from '../lib/harness.mjs';

const PHONE = { width: 375, height: 812, isMobile: true, hasTouch: true };
const DOMESTIC = '260-0056010016113-79';
const IBAN_GROUPED = 'RS35 2600 0560 1001 6113 79';

describe('employee card', () => {
  const browser = useBrowser();
  const step = steps(browser, 'employee-card');
  let olga;
  let mia;
  let olgaEmployee;
  let miaEmployee;
  let leaver;
  let report;
  let nova;
  /** Messages of the browser dialogs each page showed (the harness accepts them all). */
  const dialogs = { olga: [], mia: [] };

  /** The text of an element. */
  const textOf = (page, selector) => page.$eval(selector, (el) => el.textContent);
  /** How far the page scrolls sideways (0 when everything fits). */
  const sideways = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  /** The value of a card input. */
  const valueOf = (page, selector) => page.$eval(selector, (el) => el.value);
  /** Clicks the card's one Save (highlighted when there are changes) and waits until it is clean again. */
  async function save(page) {
    await page.waitForSelector('[data-testid=emp-save][data-dirty]:not([disabled])');
    await click(page, '[data-testid=emp-save]');
    await page.waitForSelector('[data-testid=emp-save]:not([data-dirty])');
  }
  /** Opens the header's "⋯" menu and picks an item. */
  async function menu(page, item) {
    await click(page, '[data-testid=emp-menu]');
    await click(page, `.emp-menu button::-p-text(${item})`);
  }
  const menuItems = async (page) => {
    await click(page, '[data-testid=emp-menu]');
    const items = await page.$$eval('.emp-menu button', (els) => els.map((b) => b.textContent.trim()));
    await click(page, '[data-testid=emp-menu]');
    return items;
  };

  step('an owner and a member share a workspace', async () => {
    olga = await browser.person('olga');
    olga.on('dialog', (d) => dialogs.olga.push(d.message()));
    await olga.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(olga, email('card-olga'), 'Olga Owner');
    await createWorkspace(olga, 'Card Co');
    const { token } = await api(olga, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('card-mia'), role: 'member' }) });
    mia = await browser.person('mia');
    mia.on('dialog', (d) => dialogs.mia.push(d.message()));
    await mia.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(mia, email('card-mia'), 'Mia Member');
    await click(mia, 'button::-p-text(Accept and join)');
    await finishOnboarding(mia);
    olgaEmployee = (await api(olga, '/people/access')).employeeId;
    miaEmployee = (await api(mia, '/people/access')).employeeId;
    assert.ok(olgaEmployee && miaEmployee, 'both are employees');
  });

  step('the member opens their own card from Profile', async () => {
    await mia.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle0' });
    await click(mia, '[data-testid=my-employee-card]');
    await mia.waitForFunction((id) => location.pathname === `/people/${id}`, {}, miaEmployee);
    await mia.waitForSelector('[data-testid=emp-name]');
    assert.equal(await textOf(mia, '[data-testid=emp-name]'), 'Mia Member');
    assert.equal(await textOf(mia, '[data-testid=emp-account]'), 'Has account');
    // Their own personal details and bank account are there.
    await mia.waitForSelector('[data-testid=emp-personal]');
    await mia.waitForSelector('[data-testid=emp-bank]');
    // Nothing to save yet.
    await mia.waitForSelector('[data-testid=emp-save][disabled]');
  });

  step('they change their work phone and address inline, then one Save', async () => {
    // Only the phone is theirs to change; the job title isn't an input.
    await mia.waitForSelector('[data-testid=emp-work] input[name=workPhone]');
    assert.equal(await mia.$('[data-testid=emp-work] input[name=jobTitle]'), null, 'job title is read-only');
    await setValue(mia, '[data-testid=emp-work] input[name=workPhone]', '+381 64 123 4567');
    await setValue(mia, '[data-testid=emp-personal] input[name=addressStreet]', 'Knez Mihailova 1');
    await setValue(mia, '[data-testid=emp-personal] input[name=addressPostalCode]', '11000');
    await setValue(mia, '[data-testid=emp-personal] input[name=addressCity]', 'Beograd');
    await save(mia);
    const card = await api(mia, `/people/employees/${miaEmployee}`);
    assert.equal(card.workPhone, '+381 64 123 4567');
    assert.equal(card.personal.addressCity, 'Beograd');
    assert.equal(card.personal.addressStreet, 'Knez Mihailova 1');
    // Still there after a reload.
    await mia.reload({ waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-testid=emp-work] input[name=workPhone]');
    assert.equal(await valueOf(mia, '[data-testid=emp-work] input[name=workPhone]'), '+381 64 123 4567');
    assert.equal(await valueOf(mia, '[data-testid=emp-personal] input[name=addressCity]'), 'Beograd');
  });

  step('a domestic account number is saved as its IBAN, masked until "Show"', async () => {
    await mia.type('[data-testid=emp-bank] input[name=iban]', DOMESTIC);
    await mia.waitForSelector('[data-testid=emp-iban-preview]');
    assert.match(await textOf(mia, '[data-testid=emp-iban-preview]'), new RegExp(IBAN_GROUPED));
    await save(mia);
    await mia.waitForSelector('[data-testid=emp-iban]');
    const masked = await textOf(mia, '[data-testid=emp-iban]');
    assert.match(masked, /^RS35 .*•/, `masked: ${masked}`);
    assert.ok(!masked.includes('2600 0560'), 'the middle is hidden');
    // The input is empty again: an empty input keeps the stored number.
    assert.equal(await valueOf(mia, '[data-testid=emp-bank] input[name=iban]'), '');
    await click(mia, '[data-testid=emp-bank] button::-p-text(Show)');
    await mia.waitForFunction((full) => document.querySelector('[data-testid=emp-iban]')?.textContent === full, {}, IBAN_GROUPED);
    assert.match(await text(mia), new RegExp(DOMESTIC), 'the domestic form below');
  });

  step('leaving the card with unsaved changes asks "Discard your changes?"', async () => {
    await setValue(mia, '[data-testid=emp-work] input[name=workPhone]', '+381 64 000 0000');
    await mia.waitForSelector('[data-testid=emp-save][data-dirty]');
    const before = dialogs.mia.length;
    await click(mia, 'a.header-parent');
    await mia.waitForFunction(() => location.pathname === '/org');
    assert.deepEqual(dialogs.mia.slice(before), ['Discard your changes?']);
    // Discarded: nothing was saved.
    assert.equal((await api(mia, `/people/employees/${miaEmployee}`)).workPhone, '+381 64 123 4567');
  });

  step("the member doesn't see a colleague's personal details or bank account, and can't edit them", async () => {
    await mia.goto(`${BASE_URL}/people/${olgaEmployee}`, { waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-testid=emp-work]');
    assert.equal(await textOf(mia, '[data-testid=emp-name]'), 'Olga Owner');
    assert.equal(await mia.$('[data-testid=emp-personal]'), null, 'no personal details section');
    assert.equal(await mia.$('[data-testid=emp-bank]'), null, 'no bank account section');
    assert.equal(await mia.$('[data-testid=emp-work] input'), null, "can't edit a colleague");
    assert.equal(await mia.$('[data-testid=emp-save]'), null, 'no Save');
    const card = await api(mia, `/people/employees/${olgaEmployee}`);
    assert.equal(card.personal, undefined);
    assert.equal(card.bank, undefined);
  });

  step('"Add employee" opens the new card; the owner edits several sections with one Save', async () => {
    await olga.goto(`${BASE_URL}/org?tab=list`, { waitUntil: 'networkidle0' });
    await click(olga, '[data-testid=org-add-employee]');
    await olga.waitForSelector('.modal input[name=firstName]');
    await olga.type('.modal input[name=firstName]', 'Nova');
    await olga.type('.modal input[name=lastName]', 'Zaposlena');
    await olga.type('.modal input[name=workEmail]', email('card-nova'));
    await click(olga, '[data-testid=add-employee-save]');
    await olga.waitForFunction(() => /^\/people\/[0-9a-f-]{36}$/.test(location.pathname));
    await olga.waitForFunction(() => document.querySelector('[data-testid=emp-name]')?.textContent === 'Nova Zaposlena');
    nova = await olga.evaluate(() => location.pathname.split('/').pop());
    assert.equal(await textOf(olga, '[data-testid=emp-account]'), 'No account');

    // Work, Reporting and Personal details at once.
    await olga.waitForSelector('[data-testid=emp-work] input[name=jobTitle]');
    await setValue(olga, '[data-testid=emp-work] input[name=jobTitle]', 'Office manager');
    await setValue(olga, '[data-testid=emp-work] input[name=weeklyHours]', '32');
    await olga.waitForFunction((id) => !!document.querySelector(`[data-testid=emp-reporting] select[name=managerId] option[value="${id}"]`), {}, olgaEmployee);
    await setValue(olga, '[data-testid=emp-reporting] select[name=managerId]', olgaEmployee);
    await setValue(olga, '[data-testid=emp-personal] input[name=addressCity]', 'Novi Sad');
    await save(olga);
    await olga.reload({ waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=emp-work] input[name=jobTitle]');
    assert.equal(await valueOf(olga, '[data-testid=emp-work] input[name=jobTitle]'), 'Office manager');
    assert.equal(await valueOf(olga, '[data-testid=emp-work] input[name=weeklyHours]'), '32');
    assert.equal(await valueOf(olga, '[data-testid=emp-reporting] select[name=managerId]'), olgaEmployee);
    assert.equal(await valueOf(olga, '[data-testid=emp-personal] input[name=addressCity]'), 'Novi Sad');
    const card = await api(olga, `/people/employees/${nova}`);
    assert.equal(card.jobTitle, 'Office manager');
    assert.equal(card.managerId, olgaEmployee);
  });

  step('the card has no App access, History, Roles or "Timesheet required"', async () => {
    for (const section of ['emp-access', 'emp-history', 'emp-roles']) assert.equal(await olga.$(`[data-testid=${section}]`), null, `${section} hidden`);
    const body = await text(olga);
    assert.ok(!/Timesheet required/.test(body), 'no Timesheet required row');
    assert.ok(!/Sign-in email|Workspace role/.test(body), 'no sign-in email or workspace role');
    // App access actions are in the menu: Invite (a work email is set) and Link to member.
    const items = await menuItems(olga);
    assert.ok(items.includes('Invite to Pultly') && items.includes('Link to member') && items.includes('Deactivate'), items.join(', '));
    assert.ok(!items.includes('Delete'), 'no Delete while active');
  });

  step('the owner deactivates someone with a direct report from the menu; Delete appears only then', async () => {
    const start = '2024-03-01';
    leaver = (await api(olga, '/people/employees', { method: 'POST', body: JSON.stringify({ firstName: 'Rade', lastName: 'Odlazić', employmentStartDate: start }) })).id;
    report = (await api(olga, '/people/employees', { method: 'POST', body: JSON.stringify({ firstName: 'Petar', lastName: 'Ostaje', employmentStartDate: start, managerId: leaver }) })).id;
    await olga.goto(`${BASE_URL}/people/${leaver}`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=emp-status]');
    assert.equal(await textOf(olga, '[data-testid=emp-status]'), 'Active');
    assert.ok(!(await menuItems(olga)).includes('Delete'), 'no Delete while active');
    await menu(olga, 'Deactivate');
    await olga.waitForSelector('.modal select[name=reportsManagerId]');
    // The pickers load: Olga is offered as the new manager.
    await olga.waitForFunction((id) => !!document.querySelector(`.modal select[name=reportsManagerId] option[value="${id}"]`), {}, olgaEmployee);
    await setValue(olga, '.modal select[name=reportsManagerId]', olgaEmployee);
    await setValue(olga, '.modal select[name=reason]', 'resigned');
    await click(olga, '.modal .modal-actions button::-p-text(Deactivate)');
    await olga.waitForFunction(() => /Inactive since/.test(document.querySelector('[data-testid=emp-status]')?.textContent ?? ''));
    const moved = await eventually(async () => (await api(olga, `/people/employees/${report}`)).managerId === olgaEmployee);
    assert.ok(moved, 'the report now reports to Olga');

    // Now Delete is offered, and works.
    const items = await menuItems(olga);
    assert.ok(items.includes('Delete') && items.includes('Reactivate') && !items.includes('Deactivate'), items.join(', '));
    await menu(olga, 'Delete');
    await olga.waitForFunction(() => location.pathname === '/org');
    assert.ok(dialogs.olga.some((m) => m.startsWith('Delete Rade Odlazić?')), dialogs.olga.join(' | '));
    await assert.rejects(api(olga, `/people/employees/${leaver}`), /404/, 'the record is gone');
    const list = await api(olga, '/people/employees?status=active,leaving,inactive');
    assert.ok(!list.employees.some((e) => e.id === leaver), 'not in the directory');
  });

  step('on a phone the card fits and its actions are in the menu', async () => {
    await mia.setViewport(PHONE);
    await mia.goto(`${BASE_URL}/people/${miaEmployee}`, { waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-testid=emp-bank]');
    assert.ok((await sideways(mia)) <= 0, `the card scrolls sideways by ${await sideways(mia)}px`);

    await olga.setViewport(PHONE);
    await olga.goto(`${BASE_URL}/people/${report}`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=emp-header]');
    assert.ok((await sideways(olga)) <= 0, `the owner's view scrolls sideways by ${await sideways(olga)}px`);
    await olga.waitForSelector('[data-testid=emp-save]', { visible: true });
    await click(olga, '[data-testid=emp-menu]');
    await olga.waitForSelector('.emp-menu button::-p-text(Deactivate)', { visible: true });
  });
});
