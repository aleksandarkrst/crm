// The employee card (CD-140): a member opens their own card from Profile, edits their work phone
// and address, enters a Serbian account number that is saved as its IBAN, shown masked and
// revealed with "Show"; they don't see a colleague's personal details or bank account; an owner
// deactivates someone who has a direct report, who moves to the chosen manager; on a phone the
// card fits the screen and its actions are in the menu.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, createWorkspace, email, eventually, finishOnboarding, setValue, signIn, steps, text, useBrowser } from '../lib/harness.mjs';

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

  /** The text of an element. */
  const textOf = (page, selector) => page.$eval(selector, (el) => el.textContent);
  /** How far the page scrolls sideways (0 when everything fits). */
  const sideways = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  /** Opens a section's editor. */
  const edit = (page, section) => click(page, `[data-testid=${section}] .emp-edit`);
  /** Saves a section and waits until it shows its values again. */
  async function save(page, section) {
    await click(page, `[data-testid=${section}] button::-p-text(Save)`);
    await page.waitForFunction((section) => !document.querySelector(`[data-testid=${section}] .emp-section-actions`), {}, section);
  }

  step('an owner and a member share a workspace', async () => {
    olga = await browser.person('olga');
    await olga.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(olga, email('card-olga'), 'Olga Owner');
    await createWorkspace(olga, 'Card Co');
    const { token } = await api(olga, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('card-mia'), role: 'member' }) });
    mia = await browser.person('mia');
    await mia.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(mia, email('card-mia'), 'Mia Member');
    await clickButton(mia, 'Accept and join');
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
  });

  step('they change their work phone and address', async () => {
    await edit(mia, 'emp-work');
    // Only the phone is theirs to change; the job title isn't an input.
    assert.equal(await mia.$('[data-testid=emp-work] input[name=jobTitle]'), null, 'job title is read-only');
    await setValue(mia, '[data-testid=emp-work] input[name=workPhone]', '+381 64 123 4567');
    await save(mia, 'emp-work');
    assert.match(await textOf(mia, '[data-testid=emp-work-phone]'), /\+381 64 123 4567/);

    await edit(mia, 'emp-personal');
    await setValue(mia, '[data-testid=emp-personal] input[name=addressStreet]', 'Knez Mihailova 1');
    await setValue(mia, '[data-testid=emp-personal] input[name=addressPostalCode]', '11000');
    await setValue(mia, '[data-testid=emp-personal] input[name=addressCity]', 'Beograd');
    await save(mia, 'emp-personal');
    assert.match(await textOf(mia, '[data-testid=emp-address]'), /Knez Mihailova 1, 11000 Beograd, Serbia/);
    const card = await api(mia, `/people/employees/${miaEmployee}`);
    assert.equal(card.workPhone, '+381 64 123 4567');
    assert.equal(card.personal.addressCity, 'Beograd');
  });

  step('a domestic account number is saved as its IBAN, masked until "Show"', async () => {
    await edit(mia, 'emp-bank');
    await mia.type('[data-testid=emp-bank] input[name=iban]', DOMESTIC);
    await mia.waitForSelector('[data-testid=emp-iban-preview]');
    assert.match(await textOf(mia, '[data-testid=emp-iban-preview]'), new RegExp(IBAN_GROUPED));
    await save(mia, 'emp-bank');
    const masked = await textOf(mia, '[data-testid=emp-iban]');
    assert.match(masked, /^RS35 .*•/, `masked: ${masked}`);
    assert.ok(!masked.includes('2600 0560'), 'the middle is hidden');
    await click(mia, '[data-testid=emp-bank] button::-p-text(Show)');
    await mia.waitForFunction((full) => document.querySelector('[data-testid=emp-iban]')?.textContent === full, {}, IBAN_GROUPED);
    assert.match(await text(mia), new RegExp(DOMESTIC), 'the domestic form below');
  });

  step("the member doesn't see a colleague's personal details or bank account", async () => {
    await mia.goto(`${BASE_URL}/people/${olgaEmployee}`, { waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-testid=emp-work]');
    assert.equal(await textOf(mia, '[data-testid=emp-name]'), 'Olga Owner');
    assert.equal(await mia.$('[data-testid=emp-personal]'), null, 'no personal details section');
    assert.equal(await mia.$('[data-testid=emp-bank]'), null, 'no bank account section');
    assert.equal(await mia.$('[data-testid=emp-work] .emp-edit'), null, "can't edit a colleague");
    const card = await api(mia, `/people/employees/${olgaEmployee}`);
    assert.equal(card.personal, undefined);
    assert.equal(card.bank, undefined);
  });

  step('the owner deactivates someone with a direct report, who moves to the chosen manager', async () => {
    const start = '2024-03-01';
    leaver = (await api(olga, '/people/employees', { method: 'POST', body: JSON.stringify({ firstName: 'Rade', lastName: 'Odlazić', employmentStartDate: start }) })).id;
    report = (await api(olga, '/people/employees', { method: 'POST', body: JSON.stringify({ firstName: 'Petar', lastName: 'Ostaje', employmentStartDate: start, managerId: leaver }) })).id;
    await olga.goto(`${BASE_URL}/people/${leaver}`, { waitUntil: 'networkidle0' });
    await olga.waitForSelector('[data-testid=emp-status]');
    assert.equal(await textOf(olga, '[data-testid=emp-status]'), 'Active');
    await clickButton(olga, 'Deactivate');
    await olga.waitForSelector('.modal select[name=reportsManagerId]');
    // The pickers load: Olga is offered as the new manager.
    await olga.waitForFunction((id) => !!document.querySelector(`.modal select[name=reportsManagerId] option[value="${id}"]`), {}, olgaEmployee);
    await setValue(olga, '.modal select[name=reportsManagerId]', olgaEmployee);
    await setValue(olga, '.modal select[name=reason]', 'resigned');
    await click(olga, '.modal .modal-actions button::-p-text(Deactivate)');
    await olga.waitForFunction(() => /Inactive since/.test(document.querySelector('[data-testid=emp-status]')?.textContent ?? ''));
    const moved = await eventually(async () => (await api(olga, `/people/employees/${report}`)).managerId === olgaEmployee);
    assert.ok(moved, 'the report now reports to Olga');
    // History shows it to the owner.
    await olga.waitForFunction(() => /Deactivated/.test(document.querySelector('[data-testid=emp-history]')?.textContent ?? ''));
  });

  step('"Add employee" on the Org structure page opens the new card', async () => {
    await olga.goto(`${BASE_URL}/org?tab=list`, { waitUntil: 'networkidle0' });
    await click(olga, '[data-testid=org-add-employee]');
    await olga.waitForSelector('.modal input[name=firstName]');
    await olga.type('.modal input[name=firstName]', 'Nova');
    await olga.type('.modal input[name=lastName]', 'Zaposlena');
    await olga.type('.modal input[name=workEmail]', email('card-nova'));
    await click(olga, '[data-testid=add-employee-save]');
    await olga.waitForFunction(() => /^\/people\/[0-9a-f-]{36}$/.test(location.pathname));
    await olga.waitForFunction(() => document.querySelector('[data-testid=emp-name]')?.textContent === 'Nova Zaposlena');
    assert.equal(await textOf(olga, '[data-testid=emp-account]'), 'No account');
    // The owner edits someone else's card (CD-224: it looked read-only on an old build).
    await click(olga, '[data-testid=emp-work] .emp-edit');
    await olga.waitForSelector('[data-testid=emp-work] input[name=jobTitle]');
    await olga.type('[data-testid=emp-work] input[name=jobTitle]', 'Office manager');
    await click(olga, '[data-testid=emp-work] .emp-section-actions .btn-primary');
    await olga.waitForFunction(() => document.querySelector('[data-testid=emp-work]')?.innerText.includes('Office manager') && !document.querySelector('[data-testid=emp-work] input[name=jobTitle]'));
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
    const wideShown = await olga.$$eval('.emp-wide', (els) => els.some((el) => el.offsetParent !== null));
    assert.equal(wideShown, false, 'no header buttons on a phone');
    await click(olga, '[data-testid=emp-menu]');
    await olga.waitForSelector('.emp-menu button::-p-text(Deactivate)', { visible: true });
  });
});
