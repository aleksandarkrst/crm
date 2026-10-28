// Next steps in the external minutes (CD-374): a held meeting has two next steps with owners and due
// dates; the internal minutes show them as a table, and the external minutes list them (owner name
// and due date, no email address) as the email will add them.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, createReadyCompany, newUserWithWorkspace, RUN, steps, useBrowser } from '../lib/harness.mjs';

describe('next steps in the external minutes', () => {
  const browser = useBrowser();
  const step = steps(browser, 'meeting-minutes-next-steps');
  let page;
  let me;
  let meeting;

  step('sets up a held meeting with two next steps', async () => {
    page = await browser.person('nina');
    await newUserWithWorkspace(page, { label: 'mns-nina', name: 'Nina Steps', workspace: 'Next Steps Co' });
    me = (await api(page, '/me')).user;
    const company = { id: await createReadyCompany(page, `Umbrella ${RUN}`) };
    const jovan = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Jovan Customer', companyId: company.id, email: `jovan-${RUN}@customer.example.com` }) });
    const start = Date.now() - 2 * 3_600_000;
    meeting = await api(page, '/crm/meetings', {
      method: 'POST',
      body: JSON.stringify({ title: 'Scope review', type: 'visit', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3_600_000).toISOString(), companyId: company.id, externalContactIds: [jovan.id] }),
    });
    await api(page, `/crm/meetings/${meeting.id}/held`, { method: 'POST' });
    const nextSteps = [
      { text: 'Send the offer', dueDate: '2026-11-02' },
      { text: 'Book the follow-up', dueDate: '2026-11-09' },
    ].map((st) => ({ id: crypto.randomUUID(), ownerUserId: me.id, ...st }));
    await api(page, `/crm/meetings/${meeting.id}/minutes/internal`, { method: 'PUT', body: JSON.stringify({ nextSteps }) });
  });

  step('the internal minutes show the steps as a table', async () => {
    await page.goto(`${BASE_URL}/meetings/${meeting.id}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=internal-minutes][data-editable=true]');
    assert.equal((await page.$$('[data-testid=minutes-step]')).length, 2);
    assert.deepEqual(await page.$$eval('[data-testid=step-text]', (els) => els.map((el) => el.value)), ['Send the offer', 'Book the follow-up']);
  });

  step('the external minutes list the steps with owner and due date', async () => {
    await click(page, '[data-testid=meeting-tab-external]');
    const view = await page.waitForSelector('[data-testid=external-next-steps-view]', { timeout: 10_000 });
    const body = await view.evaluate((el) => el.innerText);
    assert.match(body, /Send the offer \(Nina Steps, by 2 Nov 2026\)/);
    assert.match(body, /Book the follow-up \(Nina Steps, by 9 Nov 2026\)/);
    assert.ok(!body.includes(me.email), 'no email address of a member');
    assert.match(await page.$eval('[data-testid=external-steps-hint]', (el) => el.textContent), /Added after the text when the minutes are sent/);
  });
});
