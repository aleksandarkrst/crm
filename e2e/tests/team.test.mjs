// Two people, two browser contexts: the owner invites a colleague, who signs in through the
// link and joins; roles change; a wrong account can't use a link; invitations are withdrawn and
// members removed.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, clickButton, email, eventually, signIn, steps, text, useBrowser, createWorkspace, finishOnboarding } from '../lib/harness.mjs';

describe('team and invitations', () => {
  const browser = useBrowser();
  const step = steps(browser, 'team');
  let owner;
  let bob;
  const bobEmail = email('bob');
  const carolEmail = email('carol');

  async function createInvite(page, address) {
    await page.goto(BASE_URL + '/settings/team', { waitUntil: 'networkidle0' });
    await clickButton(page, 'Invite member');
    await page.type('input[placeholder="name@company.com"]', address);
    await clickButton(page, 'Send invitation');
    const input = await page.waitForSelector('input[readonly]');
    const link = await input.evaluate((el) => el.value);
    await clickButton(page, 'Done');
    return link;
  }

  /** Clicks a button inside the team-table row that mentions `who`. */
  const clickInRow = (page, who, selector) =>
    page.evaluate(
      (who, selector) => {
        const row = [...document.querySelectorAll('.table-row')].find((r) => r.textContent.includes(who));
        const el = row?.querySelector(selector);
        el?.click();
        return !!el;
      },
      who,
      selector,
    );

  step('the owner sets up a workspace with a deal', async () => {
    owner = await browser.person('olivia');
    await owner.goto(BASE_URL, { waitUntil: 'networkidle0' });
    await signIn(owner, email('olivia'), 'Olivia Owner');
    await createWorkspace(owner, 'Shared Co');
    const funnels = await api(owner, '/crm/funnels');
    await api(owner, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Acme rebrand', funnelId: funnels[0].id }) });
  });

  step('the team tab shows the owner as (you)', async () => {
    await owner.goto(BASE_URL + '/settings/team', { waitUntil: 'networkidle0' });
    await owner.waitForFunction(() => document.body.innerText.includes('Olivia Owner'));
    const body = await text(owner);
    assert.ok(body.includes('(you)'), '(you) marker');
    assert.match(body, /owner/i);
  });

  let bobLink;
  step('the owner creates an invite link and sees it pending', async () => {
    bobLink = await createInvite(owner, bobEmail);
    assert.ok(bobLink.startsWith(BASE_URL + '/invite/'), bobLink);
    const body = await text(owner);
    assert.ok(body.includes('Invitation sent') && body.includes(bobEmail), 'pending invitation listed');
  });

  step('the invitee is asked to sign in, then sees who invited them and joins', async () => {
    bob = await browser.person('bob');
    await bob.goto(bobLink, { waitUntil: 'networkidle0' });
    assert.match(await text(bob), /Sign in with the email address the invitation was sent to/);
    await signIn(bob, bobEmail, 'Bob Builder');
    await bob.waitForSelector('button::-p-text(Accept and join)');
    const body = await text(bob);
    assert.ok(body.includes('Join Shared Co') && body.includes('Olivia Owner invited'), 'names workspace and inviter');
    await clickButton(bob, 'Accept and join');
    await finishOnboarding(bob);
  });

  step("the invitee lands in the shared workspace, not one of their own", async () => {
    const deals = await eventually(async () => {
      const list = await api(bob, '/crm/deals?limit=50');
      return list.length === 1 && list;
    });
    assert.ok(deals, 'sees the one shared deal');
    assert.equal(deals[0].deal.title, 'Acme rebrand');
    await bob.waitForFunction(() => document.body.innerText.includes('No company'));
    assert.equal((await api(bob, '/me')).tenants.length, 1);
  });

  step('the owner sees the new member and makes them an admin', async () => {
    await owner.goto(BASE_URL + '/settings/team', { waitUntil: 'networkidle0' });
    await owner.waitForFunction(() => document.body.innerText.includes('Bob Builder'));
    const changed = await owner.evaluate(() => {
      const row = [...document.querySelectorAll('.table-row')].find((r) => r.textContent.includes('Bob Builder'));
      const select = row?.querySelector('select');
      if (!select) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'Admin');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    assert.ok(changed, 'role select found');
    const saved = await eventually(async () => (await api(owner, '/team')).members.find((m) => m.displayName === 'Bob Builder')?.role === 'admin');
    assert.ok(saved, 'role saved as admin');
  });

  let carolLink;
  step("someone else can't accept an invitation that isn't theirs", async () => {
    carolLink = await createInvite(owner, carolEmail);
    const eve = await browser.person('eve');
    await eve.goto(carolLink, { waitUntil: 'networkidle0' });
    await signIn(eve, email('eve'), 'Eve Other');
    await eve.waitForSelector('::-p-text(Join Shared Co)');
    assert.ok((await text(eve)).includes(`Sign out and sign in as ${carolEmail}`), 'told to switch accounts');
    const disabled = await eve.$eval('button::-p-text(Accept and join)', (b) => b.disabled);
    assert.equal(disabled, true);
    assert.equal((await api(eve, '/me')).tenants.length, 0);
  });

  step('the owner withdraws the invitation', async () => {
    await owner.goto(BASE_URL + '/settings/team', { waitUntil: 'networkidle0' });
    await click(owner, 'button[title="Withdraw invitation"]');
    const withdrawn = await eventually(async () => (await api(owner, '/team')).invitations.length === 0);
    assert.ok(withdrawn, 'no pending invitations left');
  });

  step('the owner removes the member, who loses access', async () => {
    await owner.waitForFunction(() => document.body.innerText.includes('Bob Builder'));
    assert.ok(await clickInRow(owner, 'Bob Builder', 'button[title="Remove from workspace"]'), 'remove button found');
    const removed = await eventually(async () => (await api(owner, '/team')).members.length === 1);
    assert.ok(removed, 'only the owner is left');
    assert.equal((await api(bob, '/me')).tenants.length, 0);
  });

  it('throws no uncaught errors in the pages', () => {
    assert.deepEqual(browser.errors, []);
  });
});
