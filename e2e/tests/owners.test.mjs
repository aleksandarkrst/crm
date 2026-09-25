// Salesperson filters match owners by user id (CD-30): two members with the same name are
// filtered separately, and a member who left still shows (and filters) as a former member.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, email, eventually, newUserWithWorkspace, steps, text, useBrowser } from '../lib/harness.mjs';

/** Signs a user in through the dev login from Node (no browser needed for them). */
async function devUser(label, name) {
  const res = await fetch(BASE_URL + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email(label), name }) });
  if (!res.ok) throw new Error('dev-login ' + res.status);
  const { accessToken } = await res.json();
  const me = await (await fetch(BASE_URL + '/api/me', { headers: { authorization: 'Bearer ' + accessToken } })).json();
  return { token: accessToken, email: email(label), id: me.user.id };
}

/** The Salesperson filter <select> on the current screen: its options as { value, label }. */
const ownerOptions = (page) =>
  page.evaluate(() => {
    const select = [...document.querySelectorAll('select')].find((s) => s.options[0]?.textContent === 'Salesperson');
    return select ? [...select.options].slice(1).map((o) => ({ value: o.value, label: o.textContent })) : null;
  });
const pickOwner = (page, value) =>
  page.evaluate((value) => {
    const select = [...document.querySelectorAll('select')].find((s) => s.options[0]?.textContent === 'Salesperson');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

describe('owners by id', () => {
  const browser = useBrowser();
  const step = steps(browser, 'owners');
  let page;
  let samA;
  let samB;

  step('two members named Sam Seller each own a deal', async () => {
    page = await browser.person('olga');
    await newUserWithWorkspace(page, { label: 'olga', name: 'Olga Owner', workspace: 'Namesakes' });
    samA = await devUser('sam-a', 'Sam Seller');
    samB = await devUser('sam-b', 'Sam Seller');
    for (const sam of [samA, samB]) {
      const { token } = await api(page, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: sam.email, role: 'member' }) });
      const res = await fetch(`${BASE_URL}/api/invitations/${token}/accept`, { method: 'POST', headers: { authorization: 'Bearer ' + sam.token } });
      assert.equal(res.status, 200, 'accepted');
    }
    const funnels = await api(page, '/crm/funnels');
    const funnelId = funnels.find((f) => f.key === 'smb')?.id ?? funnels[0].id;
    for (const [sam, company] of [
      [samA, 'Alpha Owned'],
      [samB, 'Bravo Owned'],
    ]) {
      const c = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: company }) });
      await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: company, funnelId, companyId: c.id, ownerUserId: sam.id }) });
    }
  });

  step('the pipeline filter lists both, told apart, and filters each separately', async () => {
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Alpha Owned'));
    const options = await ownerOptions(page);
    const a = options.find((o) => o.value === samA.id);
    const b = options.find((o) => o.value === samB.id);
    assert.ok(a && b, 'both Sams are options');
    assert.notEqual(a.label, b.label, 'labels differ');
    assert.ok(a.label.startsWith('Sam Seller') && a.label.includes(samA.email), a.label);

    await pickOwner(page, samA.id);
    await page.waitForFunction(() => !document.body.innerText.includes('Bravo Owned'));
    assert.ok((await text(page)).includes('Alpha Owned'));

    await pickOwner(page, samB.id);
    await page.waitForFunction(() => !document.body.innerText.includes('Alpha Owned'));
    assert.ok((await text(page)).includes('Bravo Owned'));
  });

  step('a removed member still owns their deal and shows as a former member', async () => {
    await api(page, '/team/members/' + samB.id, { method: 'DELETE' });
    await page.goto(BASE_URL + '/pipeline', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Bravo Owned'));
    const options = await eventually(async () => {
      const list = await ownerOptions(page);
      return list?.some((o) => o.value === samB.id) && list;
    });
    assert.ok(options, 'former member is still a filter option');
    assert.equal(options.find((o) => o.value === samB.id).label, 'Sam Seller (former member)');
    await pickOwner(page, samB.id);
    await page.waitForFunction(() => !document.body.innerText.includes('Alpha Owned'));
    assert.ok((await text(page)).includes('Bravo Owned'));

    const deals = await api(page, '/crm/deals');
    const bravo = deals.find((d) => d.deal.title === 'Bravo Owned');
    await page.goto(BASE_URL + '/deals/' + bravo.deal.id, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => {
      const select = document.querySelector('select[aria-label=Owner]');
      return select && select.options[select.selectedIndex]?.textContent === 'Sam Seller (former member)';
    });
  });

  it('throws no uncaught errors in the pages', () => {
    assert.deepEqual(browser.errors, []);
  });
});
