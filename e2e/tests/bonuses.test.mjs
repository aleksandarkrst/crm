// Sales bonus rules (CD-17): owners and admins set them in Settings → Sales bonuses and see the
// bonus card on Overview; members see neither, and the API refuses them.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, clickButton, email, eventually, newUserWithWorkspace, signIn, steps, text, useBrowser, finishOnboarding } from '../lib/harness.mjs';

describe('sales bonus rules', () => {
  const browser = useBrowser();
  const step = steps(browser, 'bonuses');
  let page;
  let member;
  let memberId;

  step('an owner with a member in the workspace', async () => {
    page = await browser.person('bonus-owner');
    await newUserWithWorkspace(page, { label: 'bonus-owner', name: 'Bruno Boss', workspace: 'Bonus Co' });
    const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('bonus-member'), role: 'member' }) });
    member = await browser.person('bonus-member');
    await member.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(member, email('bonus-member'), 'Sara Seller');
    await clickButton(member, 'Accept and join');
    await finishOnboarding(member);
    memberId = (await api(page, '/team')).members.find((m) => m.displayName === 'Sara Seller').userId;
  });

  step('the owner sets a rule in Settings → Sales bonuses, and it is saved', async () => {
    await page.goto(BASE_URL + '/settings/bonuses', { waitUntil: 'networkidle0' });
    const rate = await page.waitForSelector('input[aria-label="Rate for Sara Seller"]');
    await rate.type('7.5');
    await page.type('input[aria-label="Minimum for Sara Seller"]', '10000');
    const saved = await eventually(async () => {
      const r = (await api(page, '/crm/bonus-rules')).rules.find((x) => x.userId === memberId);
      return r && r.rate === '7.50' && r.floor === '10000.00' && r;
    });
    assert.ok(saved, 'rule saved');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal(await page.$eval('input[aria-label="Rate for Sara Seller"]', (el) => el.value), '7.5');
  });

  step('Overview shows the owner the bonus card with the stored rule', async () => {
    await page.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    const card = await page.waitForSelector('[data-testid=bonus-card]');
    const body = await card.evaluate((el) => el.innerText);
    assert.match(body, /Sara Seller/);
    assert.match(body, /7\.5%/);
  });

  step('a member sees no bonus tab, no bonus card, and gets 403 from the API', async () => {
    await member.goto(BASE_URL + '/settings/workspace', { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => document.body.innerText.includes('Customize Fields'));
    assert.ok(!(await text(member)).includes('Sales bonuses'), 'no Sales bonuses tab');
    await member.goto(BASE_URL + '/settings/bonuses', { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => location.pathname === '/settings/workspace');
    assert.equal(await member.$('input[aria-label="Rate for Sara Seller"]'), null);

    await member.goto(BASE_URL + '/overview', { waitUntil: 'networkidle0' });
    await member.waitForFunction(() => document.body.innerText.includes('in the current filter'));
    assert.equal(await member.$('[data-testid=bonus-card]'), null, 'no bonus card');
    const body = await text(member);
    assert.ok(!body.includes('Sales bonuses') && !body.includes('7.5%'), 'no bonus figures');

    await assert.rejects(api(member, '/crm/bonus-rules'), /403/);
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
