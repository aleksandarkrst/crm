// Workspace settings and profile settings are saved and survive a reload; a deal's discovery notes reach the proposal.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, createDealInUi, email, eventually, fillField, newUserWithWorkspace, chooseOption, RUN, signIn, steps, text, useBrowser, waitForToastToClear, finishOnboarding } from '../lib/harness.mjs';

/** The glass toast says `words` (Workspace and Profile settings, CD-524, CD-525). */
const toastSays = (page, words) => page.waitForFunction((words) => document.querySelector('.toast.toast-glass')?.textContent.includes(words), {}, words);
const valueOf = (page, testId) => page.$eval(`[data-testid=${testId}]`, (el) => el.value);

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
    await page.goto(`${BASE_URL}/settings/general`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Fiscal year starts'));
    // Settings fields save when they are left, and dropdowns are buttons with a menu (CD-524).
    await fillField(page, '[data-testid="workspace-info-name"]', workspaceName);
    await chooseOption(page, '[data-testid=workspace-currency]', 'RSD');
    // The time zone is a searchable list (CD-488): search, then Enter picks the first match.
    await click(page, '[data-testid="workspace-timezone"]');
    await page.waitForSelector('input[aria-label="Search time zones"]');
    await page.type('input[aria-label="Search time zones"]', 'london');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-testid="workspace-timezone"]')?.dataset.zone === 'Europe/London');
    await chooseOption(page, '[data-testid=workspace-fiscal-month]', 'April');
    await click(page, '[data-testid=customer-email-language] button::-p-text(Srpski)');
    assert.ok((await text(page)).includes('Default language of the fixed text, such as meeting minutes'), 'hint under the language');
    const saved = await eventually(async () => {
      const ws = await api(page, '/workspace');
      return ws.name === workspaceName && ws.currency === 'RSD' && ws.timezone === 'Europe/London' && ws.fiscalYearStartMonth === 4 && ws.customerEmailLanguage === 'sr' && ws;
    });
    assert.ok(saved, 'workspace settings saved');
    // Every save in Settings says so in the design's toast (CD-524).
    await page.waitForFunction(() => document.querySelector('.toast.toast-glass')?.textContent.includes('Changes saved'));
  });

  step('has no Integrations or Billing page, and their old links go back to Settings (CD-207)', async () => {
    const pages = await page.$$eval('[data-testid=settings-nav] .gs-nav-row .label', (els) => els.map((b) => b.textContent.trim()));
    assert.ok(pages.includes('General'), 'the nav is there');
    assert.ok(!pages.includes('Notifications'), 'Notifications is in Profile settings, not here (CD-489)');
    assert.ok(!pages.includes('Integrations') && !pages.includes('Billing'), 'no placeholder pages');
    for (const tab of ['integrations', 'billing']) {
      await page.goto(`${BASE_URL}/settings/${tab}`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => location.pathname === '/settings/general' && document.body.innerText.includes('Fiscal year starts'));
    }
  });

  step('shows the saved workspace settings after a reload, and the new name in the session', async () => {
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Fiscal year starts'));
    assert.equal(await page.$eval('[data-testid="workspace-info-name"]', (el) => el.value), workspaceName);
    assert.equal(await page.$eval('[data-testid=workspace-currency]', (el) => el.dataset.value), 'RSD');
    assert.equal(await page.$eval('[data-testid="workspace-timezone"]', (el) => el.dataset.zone), 'Europe/London');
    assert.equal(await page.$eval('[data-testid=workspace-fiscal-month]', (el) => el.dataset.value), '4');
    assert.equal(await page.$eval('[data-testid=customer-email-language] button[aria-pressed=true]', (el) => el.textContent), 'Srpski');
    // The session has the new name: the CRM's glass sidebar (CD-530) and the module switcher in
    // another module's rail name the workspace.
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    await page.waitForFunction((name) => document.querySelector('[data-testid=crm-sidebar] .gs-side-who')?.textContent.includes(name), {}, workspaceName);
    await page.goto(`${BASE_URL}/projects`, { waitUntil: 'networkidle0' });
    await page.waitForFunction((name) => document.querySelector('[data-testid=module-switcher]')?.title.includes(name), {}, workspaceName);
    // Profile settings is an area of its own, like Workspace settings: no module rail (CD-525).
    await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=account-nav]');
    assert.equal(await page.$('[data-testid=module-switcher]'), null, 'no module rail in Profile settings');
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
    // The page's first line is its description (CD-525 spec 2); the sign-in email is read-only.
    assert.equal(await page.$eval('[data-testid=account-content] .gs-lede', (el) => el.textContent), 'How you show up for the people you work with.');
    assert.match(await page.$eval('[data-testid=profile-email]', (el) => el.textContent), /\S+@\S+/);
    // Text fields save when they are left, and each save says so in the glass toast (CD-525 spec 5).
    await fillField(page, '[data-testid=profile-name]', 'Olga Renamed');
    await toastSays(page, 'Your name saved');
    // An empty name shows why under the field and isn't saved; the sidebar keeps the saved name.
    await fillField(page, '[data-testid=profile-name]', '');
    await page.waitForFunction(() => document.querySelector('[data-testid=profile-name-error]')?.textContent === 'Enter your name.');
    assert.equal(await page.$eval('[data-testid=profile-name]', (el) => el.getAttribute('aria-invalid')), 'true');
    assert.equal(await page.$eval('[data-testid=account-name]', (el) => el.textContent), 'Olga Renamed');
    await fillField(page, '[data-testid=profile-title]', 'Head of sales');
    await toastSays(page, 'Your job title saved');
    // A phone takes digits, spaces, parentheses and a leading +; a dash is refused on purpose.
    await fillField(page, '[data-testid=profile-phone]', '060-123-456');
    await page.waitForFunction(() => document.querySelector('[data-testid=profile-phone-error]')?.textContent === 'Use digits and spaces, with a + for the country code.');
    await fillField(page, '[data-testid=profile-phone]', '+381 60 123 456');
    await page.waitForFunction(() => !document.querySelector('[data-testid=profile-phone-error]'));
    await toastSays(page, 'Your phone saved');
    // Preferences and Notifications are pages of the account (CD-525).
    await click(page, '[data-testid=account-nav] [data-section=preferences]');
    await page.waitForFunction(() => location.pathname === '/profile/preferences');
    await chooseOption(page, '[data-testid=default-funnel]', ent.label);
    await toastSays(page, 'Default funnel saved');
    await click(page, '[data-testid=account-nav] [data-section=notifications]');
    await page.waitForSelector('[data-notification=digest] [role=switch]');
    // The daily digest comes first.
    assert.equal(await page.$eval('[data-testid=notifications-card] [data-notification]', (el) => el.dataset.notification), 'digest');
    await page.click('[data-notification=digest] [role=switch]');
    await toastSays(page, 'Your notification settings saved');
    // Leaving the page put the saved name back in the field.
    await click(page, '[data-testid=account-nav] [data-section=profile]');
    await page.waitForFunction(() => document.querySelector('[data-testid=profile-name]')?.value === 'Olga Renamed');
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
    await page.goto(`${BASE_URL}/profile/notifications`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-notification=digest] [role=switch]');
    assert.equal(await page.$eval('[data-notification=digest] [role=switch]', (el) => el.getAttribute('aria-checked')), 'false');
    assert.match(await page.$eval('[data-testid=notifications-foot]', (el) => el.textContent), /^Emails go to \S+@\S+\. These settings are yours and do not change what others get\.$/);
    await page.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=profile-name]');
    assert.equal(await valueOf(page, 'profile-name'), 'Olga Renamed');
    assert.equal(await valueOf(page, 'profile-title'), 'Head of sales');
    assert.equal(await valueOf(page, 'profile-phone'), '+381 60 123 456');
    await page.goto(`${BASE_URL}/profile/preferences`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=default-funnel]');
    assert.ok(!(await page.evaluate(() => document.body.innerText)).includes('Start page'), 'no Start page: everyone starts on Home (CD-288)');
  });

  step('with a module off, its settings in your account stay visible but disabled (CD-525)', async () => {
    const modules = (await api(page, '/workspace')).modules ?? ['planning', 'crm', 'projects', 'employees', 'timesheet', 'timeoff', 'finance', 'reporting'];
    const without = (m) => modules.filter((x) => x !== m);
    await api(page, '/workspace', { method: 'PATCH', body: JSON.stringify({ modules: without('crm') }) });
    try {
      await page.goto(`${BASE_URL}/profile/preferences`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid=default-funnel]');
      assert.equal(await page.$eval('[data-testid=default-funnel]', (el) => el.disabled), true, 'the default funnel is disabled');
      assert.ok((await text(page)).includes('CRM is off in this workspace'));
      await page.goto(`${BASE_URL}/profile/notifications`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-notification=digest] [role=switch]');
      const off = await page.$$eval('[data-notification][data-off] [role=switch]:disabled', (els) => els.map((el) => el.closest('[data-notification]').dataset.notification).sort());
      assert.deepEqual(off, ['assigned', 'meetings', 'proposal-approvals']);
      assert.equal(await page.$eval('[data-notification=digest] [role=switch]', (el) => el.disabled), false, 'the digest stays on');
    } finally {
      await api(page, '/workspace', { method: 'PATCH', body: JSON.stringify({ modules }) });
    }
  });

  step('opens Home, even with a start page saved before CD-288', async () => {
    await api(page, '/profile', { method: 'PATCH', body: JSON.stringify({ startPage: 'today' }) });
    await page.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=home-modules]');
    assert.equal(new URL(page.url()).pathname, '/');
    // Home has no sidebar, as in its design (CD-288).
    assert.equal(await page.$('.app-sidebar'), null, 'Home has no sidebar');
    assert.match(await page.$eval('[data-testid=home-waiting]', (el) => el.innerText), /Waiting for you[\s\S]*From all your modules/);
    // "Find a module" finds by keyword, says when nothing matches, and Escape clears it.
    await page.type('[data-testid=home-search]', 'hours');
    assert.deepEqual(await page.$$eval('[data-testid=home-modules] [data-module]', (els) => els.map((el) => el.dataset.module)), ['timesheet']);
    await page.type('[data-testid=home-search]', 'xyz');
    await page.waitForFunction(() => document.querySelector('.home-none')?.textContent.startsWith('No module matches that.'));
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('[data-testid=home-search]', (el) => el.value), '');
    // A tile opens its module; the CRM glass sidebar's mark (CD-530), and in another module Home in
    // the rail and the Pultly mark, take them back.
    await click(page, '[data-testid=home-modules] [data-module=crm]');
    await page.waitForFunction(() => location.pathname === '/pipeline');
    await click(page, '[data-testid=crm-sidebar] a.gs-home');
    await page.waitForSelector('[data-testid=home-modules]');
    await click(page, '[data-testid=home-modules] [data-module=projects]');
    await page.waitForFunction(() => location.pathname === '/projects');
    await click(page, '.app-sidebar nav a.nav-item[href="/"]');
    await page.waitForSelector('[data-testid=home-modules]');
    await click(page, '[data-testid=home-modules] [data-module=projects]');
    await page.waitForFunction(() => location.pathname === '/projects');
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
    // The built-in proposal's preview is in its row's menu in CRM → Document templates (CD-524).
    await page.goto(`${BASE_URL}/settings/crm`, { waitUntil: 'networkidle0' });
    await click(page, 'button[aria-label="Actions for Proposal v4"]');
    await click(page, '[role=menuitem]::-p-text(Preview with an opportunity)');
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
    // Not in a module's sidebar (the CRM's glass one has no Settings link at all, CD-530), the account
    // menu, the Pipeline's funnel or the command search.
    await member.goto(BASE_URL + '/projects', { waitUntil: 'networkidle0' });
    await member.waitForSelector('.app-sidebar');
    assert.equal(await member.$('.app-sidebar a[href="/settings"]'), null, 'no Settings in the sidebar');
    await member.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    assert.equal(await member.$('[data-testid=pipeline-edit-funnel]'), null, 'no Edit funnel pencil');
    await click(member, '[data-testid=account-menu]');
    const items = await member.$$eval('[data-testid=account-pop] [role=menuitem]', (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(items, ['Profile settings', 'Sign out']);
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
    // Their own notification settings are in their account, where the digest's link takes them,
    // and the old `/profile#notifications` link still lands there (CD-525).
    await member.goto(`${BASE_URL}/settings/notifications`, { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => location.pathname === '/profile/notifications');
    await member.waitForSelector('[data-notification=digest] [role=switch]');
    await member.goto(`${BASE_URL}/profile#notifications`, { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => location.pathname === '/profile/notifications');
    await member.waitForSelector('[data-notification=digest] [role=switch]');
    // A member's own profile starts with the defaults, independent of the owner's.
    const p = await api(member, '/profile');
    assert.equal(p.startPage, 'pipeline');
    assert.equal(p.defaultFunnelId, null);
  });

  step('promoting the member to admin shows the workspace settings after a reload; demoting hides them (CD-523)', async () => {
    const { user } = await api(member, '/me');
    await api(page, `/team/members/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) });
    await member.goto(`${BASE_URL}/settings/workspace`, { waitUntil: 'networkidle0' });
    await member.waitForFunction((name) => document.querySelector('[data-testid="workspace-info-name"]')?.value === name, {}, workspaceName);
    assert.equal(await member.$eval('[data-testid=workspace-currency]', (el) => el.dataset.value), 'RSD');
    // Settings has no module sidebar (CD-524): the link is in a module's sidebar. The CRM's glass
    // sidebar (CD-530) has none; for now Workspace settings is reached there through Home or Ctrl+K.
    await member.goto(`${BASE_URL}/projects`, { waitUntil: 'networkidle0' });
    await member.waitForSelector('.app-sidebar a[href="/settings"]');
    await member.goto(`${BASE_URL}/settings/general`, { waitUntil: 'networkidle0' });
    await member.waitForSelector('[data-testid=settings-nav]');

    await api(page, `/team/members/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'member' }) });
    await member.reload({ waitUntil: 'networkidle0' });
    await member.waitForSelector('[data-testid=home-modules]');
    assert.equal(await member.$('.app-sidebar a[href="/settings"]'), null, 'no Settings in the sidebar');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});

