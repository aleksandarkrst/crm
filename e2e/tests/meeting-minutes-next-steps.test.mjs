// Next steps in the external minutes (CD-374): a held meeting has three next steps with owners and
// due dates; one is marked "Internal only" with its switch, which stays after a reload; the external
// minutes are then filled in with the other two (owner name and due date) and say that steps marked
// internal only stay in Pultly.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, createReadyCompany, eventually, newUserWithWorkspace, RUN, steps, useBrowser } from '../lib/harness.mjs';

describe('next steps in the external minutes', () => {
  const browser = useBrowser();
  const step = steps(browser, 'meeting-minutes-next-steps');
  let page;
  let me;
  let meeting;
  const SECRET = `Discount up to 15% ${RUN}`;
  const minutes = () => api(page, `/crm/meetings/${meeting.id}/minutes/internal`);

  step('sets up a held meeting with three next steps', async () => {
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
      { text: SECRET, dueDate: '2026-11-03' },
      { text: 'Book the follow-up', dueDate: '2026-11-09' },
    ].map((st) => ({ id: crypto.randomUUID(), ownerUserId: me.id, ...st }));
    await api(page, `/crm/meetings/${meeting.id}/minutes/internal`, { method: 'PUT', body: JSON.stringify({ nextSteps }) });
  });

  step('marks one step "Internal only"; the box stays ticked after a reload', async () => {
    await page.goto(`${BASE_URL}/meetings/${meeting.id}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=internal-minutes][data-editable=true]');
    const rows = await page.$$('[data-testid=minutes-step]');
    assert.equal(rows.length, 3);
    await (await rows[1].$('[data-testid=step-internal]')).click();
    await page.waitForFunction(() => document.querySelector('[data-testid=minutes-save-state]')?.textContent === 'Saved', { timeout: 10_000 });
    assert.ok(await eventually(async () => (await minutes()).nextSteps.map((s) => s.internalOnly).join() === 'false,true,false'), 'saved with the step');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=internal-minutes][data-editable=true]');
    const on = await page.$$eval('[data-testid=step-internal]', (els) => els.map((el) => el.checked));
    assert.deepEqual(on, [false, true, false]);
  });

  step('the external minutes list the other two steps with owner and due date, and say why', async () => {
    await click(page, '[data-testid=meeting-tab-external]');
    const view = await page.waitForSelector('[data-testid=external-next-steps-view]', { timeout: 10_000 });
    const body = await view.evaluate((el) => el.innerText);
    assert.match(body, /Send the offer \(Nina Steps, by 2 Nov 2026\)/);
    assert.match(body, /Book the follow-up \(Nina Steps, by 9 Nov 2026\)/);
    assert.ok(!body.includes(SECRET), 'the internal step is not in the external minutes');
    assert.ok(!body.includes(me.email), 'no email address of a member');
    assert.match(await page.$eval('[data-testid=external-steps-hint]', (el) => el.textContent), /Steps marked internal only stay in Pultly\./);
  });
});
