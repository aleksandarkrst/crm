// Workspace settings and profile settings are saved and survive a reload; a deal's discovery notes reach the proposal.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, createDealInUi, email, eventually, newUserWithWorkspace, RUN, setByLabel, setValue, signIn, steps, text, useBrowser, waitForToastToClear, finishOnboarding } from '../lib/harness.mjs';

/** The value of the input/select/textarea next to a label (like setByLabel, for reading). */
const valueByLabel = (page, label, tag = 'input') =>
  page.evaluate(
    (label, tag) => {
      const span = [...document.querySelectorAll('span')].find((el) => el.textContent.trim() === label);
      return span?.parentElement?.querySelector(tag)?.value ?? null;
    },
    label,
    tag,
  );

describe('settings and discovery fields', () => {
  const browser = useBrowser();
  const step = steps(browser, 'settings');
  let page;
  let member;
  let dealId;
  const workspaceName = `Renamed Studio ${RUN}`;

  step('sets up a workspace and an opportunity', async () => {
    page = await browser.person('owner');
    await newUserWithWorkspace(page, { label: 'settings-owner', name: 'Olga Owner', workspace: 'Settings Co' });
    dealId = await createDealInUi(page, { company: 'Umbrella', contact: 'Albert Wesker' });
    await waitForToastToClear(page);
  });

  step('saves the workspace settings', async () => {
    await page.goto(`${BASE_URL}/settings/workspace`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Fiscal year starts'));
    // The name is edited in the Workspace info dialog (CD-378).
    await click(page, '[data-testid="workspace-info-edit"]');
    await setValue(page, '[data-testid="workspace-info-name"]', workspaceName);
    await click(page, '[data-testid="workspace-info-save"]');
    await page.waitForFunction((name) => document.querySelector('.ws-info-name')?.textContent.trim() === name, {}, workspaceName);
    assert.ok(await setByLabel(page, 'Currency', 'RSD', 'select'));
    // The time zone is a searchable list (CD-488): search, then Enter picks the first match.
    await click(page, '[data-testid="workspace-timezone"]');
    await page.waitForSelector('input[aria-label="Search time zones"]');
    await page.type('input[aria-label="Search time zones"]', 'london');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="workspace-timezone"]')?.dataset.zone === 'Europe/London');
    assert.ok(await setByLabel(page, 'Fiscal year starts', '4', 'select'));
    assert.ok(await setByLabel(page, 'Customer email language', 'sr', 'select'));
    assert.ok((await text(page)).includes('Language of the fixed text in emails to customers'), 'hint under the language');
    const saved = await eventually(async () => {
      const ws = await api(page, '/workspace');
      return ws.name === workspaceName && ws.currency === 'RSD' && ws.timezone === 'Europe/London' && ws.fiscalYearStartMonth === 4 && ws.customerEmailLanguage === 'sr' && ws;
    });
    assert.ok(saved, 'workspace settings saved');
  });

  step('has no Integrations or Billing tab, and their old links go back to Settings (CD-207)', async () => {
    const tabs = await page.$$eval('button', (els) => els.map((b) => b.textContent.trim()));
    assert.ok(tabs.includes('Notifications'), 'the tab bar is there');
    assert.ok(!tabs.includes('Integrations') && !tabs.includes('Billing'), 'no placeholder tabs');
    for (const tab of ['integrations', 'billing']) {
      await page.goto(`${BASE_URL}/settings/${tab}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => location.pathname === '/settings/workspace' && document.body.innerText.includes('Fiscal year starts'));
    }
  });

  step('shows the saved workspace settings after a reload, and the new name in the session', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Fiscal year starts'));
    assert.equal(await page.$eval('.ws-info-name', (el) => el.textContent.trim()), workspaceName);
    assert.equal(await valueByLabel(page, 'Currency', 'select'), 'RSD');
    assert.equal(await page.$eval('[data-testid="workspace-timezone"]', (el) => el.dataset.zone), 'Europe/London');
    assert.equal(await valueByLabel(page, 'Fiscal year starts', 'select'), '4');
    assert.equal(await valueByLabel(page, 'Customer email language', 'select'), 'sr');
    await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle0' });
    await page.waitForFunction((name) => document.body.innerText.includes(name), {}, workspaceName);
  });

  step('saves the profile settings, without password fields or fake toasts', async () => {
    const body = await text(page);
    assert.equal(await page.$$eval('input[type=password]', (els) => els.length), 0, 'no password fields');
    assert.ok(!/current password|update password/i.test(body), 'no password section');
    assert.ok(!body.includes('Save changes'), 'no fake save button');
    // Language and date format aren't applied yet, so they aren't offered (CD-223).
    assert.ok(!body.includes('Date format'), 'no date format');
    assert.equal(await page.$$eval('span', (els) => els.filter((el) => el.textContent.trim() === 'Language').length), 0, 'no language');
    const funnels = await api(page, '/crm/funnels');
    const ent = funnels.find((f) => f.key === 'ent');
    assert.ok(await setByLabel(page, 'Full name', 'Olga Renamed'));
    assert.ok(await setByLabel(page, 'Job title', 'Head of sales'));
    assert.ok(await setByLabel(page, 'Phone', '+381 60 123 456'));
    assert.ok(await setByLabel(page, 'Default funnel', ent.id, 'select'));
    await page.click('.switch');
    const saved = await eventually(async () => {
      const p = await api(page, '/profile');
      return (
        p.displayName === 'Olga Renamed' &&
        p.jobTitle === 'Head of sales' &&
        p.phone === '+381 60 123 456' &&
        p.defaultFunnelId === ent.id &&
        p.dailyDigest === false &&
        p
      );
    });
    assert.ok(saved, 'profile saved');
  });

  step('shows the saved profile after a reload', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Daily digest email'));
    assert.equal(await valueByLabel(page, 'Full name'), 'Olga Renamed');
    assert.equal(await valueByLabel(page, 'Job title'), 'Head of sales');
    assert.equal(await valueByLabel(page, 'Phone'), '+381 60 123 456');
    assert.ok(!(await page.evaluate(() => document.body.innerText)).includes('Start page'), 'no Start page: everyone starts on Home (CD-288)');
    assert.equal(await page.$eval('.switch', (el) => el.classList.contains('on')), false);
  });

  step('opens Home, even with a start page saved before CD-288', async () => {
    await api(page, '/profile', { method: 'PATCH', body: JSON.stringify({ startPage: 'today' }) });
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=home-modules]');
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.$('.app-sidebar'), null, 'Home has no sidebar');
    assert.match(await page.$eval('[data-testid=home-waiting]', (el) => el.innerText), /Waiting for you[\s\S]*From all your modules/);
    // A tile opens its module, which has its sidebar again.
    await click(page, '[data-testid=home-modules] [data-module=crm]');
    await page.waitForFunction(() => location.pathname === '/pipeline');
    // The Pultly mark takes them back (there is no Home item in the sidebar).
    assert.equal(await page.$('.app-sidebar a.nav-item[href="/"]'), null, 'no Home item in the sidebar');
    await click(page, '.app-sidebar a.ws-logo');
    await page.waitForSelector('[data-testid=home-modules]');
  });

  // Discovery notes are no longer shown on the deal page or merged into the proposal (CD-362),
  // even when a deal still has them saved.
  step('leaves the discovery notes out of the proposal', async () => {
    await api(page, '/crm/deals/' + dealId, {
      method: 'PATCH',
      body: JSON.stringify({
        discoveryDate: '2026-09-03',
        need: 'a repositioning across six markets',
        constraint: 'procurement requires three approvals',
        decisionMaker: 'the CMO with CFO sign-off',
        headline: 'One story across six markets',
      }),
    });
    await page.goto(`${BASE_URL}/settings/templates`, { waitUntil: 'networkidle0' });
    await clickButton(page, 'Preview with an opportunity');
    await page.waitForFunction(() => document.body.textContent.includes('01 — Scope'));
    const doc = await text(page);
    for (const note of ['What you told us', 'One story across six markets', '3 September 2026', 'a repositioning across six markets', 'procurement requires three approvals', 'the CMO with CFO sign-off']) {
      assert.ok(!doc.includes(note), `"${note}" is not in the proposal`);
    }
  });

  step("members don't see the workspace settings anywhere (CD-523)", async () => {
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('settings-member'), role: 'member' }) });
    member = await browser.person('member');
    await member.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(member, email('settings-member'), 'Max Member');
    await clickButton(member, 'Accept and join');
    await finishOnboarding(member);
    // Any settings URL goes Home (CD-288), without showing the settings first.
    for (const tab of ['workspace', 'team', 'funnel', 'fields', 'templates', 'roles', 'modules', 'nope']) {
      await member.goto(`${BASE_URL}/settings/${tab}`, { waitUntil: 'networkidle0' });
      await member.waitForSelector('[data-testid=home-modules]');
      assert.equal(new URL(member.url()).pathname, '/');
      assert.equal(await member.$('[data-testid=settings-nav]'), null, `no settings on /settings/${tab}`);
    }
    // Home has no Workspace settings tile for them either.
    assert.equal(await member.$('[data-testid=home-modules] [data-module=settings]'), null, 'no Settings tile on Home');
    await member.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    // Not in the sidebar, the account menu, the Pipeline's funnel or the command search.
    assert.equal(await member.$('.app-sidebar a[href="/settings"]'), null, 'no Settings in the sidebar');
    assert.equal(await member.$('[data-testid=pipeline-edit-funnel]'), null, 'no Edit funnel pencil');
    await click(member, '[data-testid=account-menu]');
    const items = await member.$$eval('.header-right .menu-pop [role=menuitem]', (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(items, ['Personal preferences', 'Sign out']);
    await member.keyboard.press('Escape');
    await member.click('h1');
    await member.keyboard.down('Control');
    await member.keyboard.press('k');
    await member.keyboard.up('Control');
    await member.waitForSelector('[data-testid=palette]');
    await member.keyboard.type('settings');
    const titles = await member.$$eval('[data-testid=search-results] [role=option] .search-item-title', (els) => els.map((el) => el.textContent));
    assert.ok(!titles.includes('Workspace settings') && !titles.includes('Funnel builder'), JSON.stringify(titles));
    await member.keyboard.press('Escape');
    // Their own notification settings are on Personal preferences, where the digest's link takes them.
    await member.goto(`${BASE_URL}/settings/notifications`, { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => location.pathname === '/profile' && location.hash === '#notifications');
    await member.waitForSelector('#notifications [data-notification=digest] [role=switch]');
    // A member's own profile starts with the defaults, independent of the owner's.
    const p = await api(member, '/profile');
    assert.equal(p.startPage, 'pipeline');
    assert.equal(p.defaultFunnelId, null);
  });

  step('promoting the member to admin shows the workspace settings after a reload; demoting hides them (CD-523)', async () => {
    const { user } = await api(member, '/me');
    await api(page, `/team/members/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) });
    await member.goto(`${BASE_URL}/settings/workspace`, { waitUntil: 'networkidle0' });
    await member.waitForFunction((name) => document.querySelector('.ws-info-name')?.textContent.trim() === name, {}, workspaceName);
    assert.equal(await valueByLabel(member, 'Currency', 'select'), 'RSD');
    assert.ok(await member.$('.app-sidebar a[href="/settings"]'), 'Settings in the sidebar');

    await api(page, `/team/members/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'member' }) });
    await member.reload({ waitUntil: 'networkidle0' });
    await member.waitForSelector('[data-testid=home-modules]');
    assert.equal(await member.$('.app-sidebar a[href="/settings"]'), null, 'no Settings in the sidebar');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});

