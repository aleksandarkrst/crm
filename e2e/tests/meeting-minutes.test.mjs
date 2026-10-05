// Internal minutes of a meeting (CD-132): writing the summary and agreements (saved on their own),
// a next step with an owner and a due date, "Create task" (the task shows on Today), and a member
// who doesn't take part seeing the minutes read-only.
import assert from 'node:assert/strict';
import { describe } from 'node:test';
import { api, BASE_URL, click, clickButton, email, eventually, finishOnboarding, newUserWithWorkspace, RUN, setValue, signIn, steps, useBrowser } from '../lib/harness.mjs';

const TZ = 'Europe/Belgrade'; // new workspaces use it

/** Today's date in the workspace time zone. */
function today() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

describe('internal minutes', () => {
  const browser = useBrowser();
  const step = steps(browser, 'meeting-minutes');
  let mia;
  let bo;
  let miaId;
  let deal;
  let meeting;
  const STEP = `Send the pilot contract ${RUN}`;
  const minutes = () => api(mia, `/crm/meetings/${meeting.id}/minutes/internal`);
  const saved = (page) => page.waitForFunction(() => document.querySelector('[data-testid=minutes-save-state]')?.textContent === 'Saved', { timeout: 10_000 });

  step('sets up a held meeting on a deal, and a colleague who is not at it', async () => {
    mia = await browser.person('mia');
    await newUserWithWorkspace(mia, { label: 'minutes-mia', name: 'Mia Minutes', workspace: 'Minutes Co' });
    miaId = (await api(mia, '/team')).members.find((m) => m.displayName === 'Mia Minutes').userId;
    const company = await api(mia, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Globex ${RUN}` }) });
    const funnels = await api(mia, '/crm/funnels');
    deal = await api(mia, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Globex pilot', funnelId: funnels[0].id, companyId: company.id }) });
    const start = Date.now() - 2 * 3_600_000;
    meeting = await api(mia, '/crm/meetings', {
      method: 'POST',
      body: JSON.stringify({ title: 'Pilot kickoff', type: 'visit', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3_600_000).toISOString(), companyId: company.id, dealId: deal.id }),
    });
    await api(mia, `/crm/meetings/${meeting.id}/held`, { method: 'POST' });

    const { token } = await api(mia, '/team/invitations', { method: 'POST', body: JSON.stringify({ email: email('minutes-bo'), role: 'member' }) });
    bo = await browser.person('bo');
    await bo.goto(`${BASE_URL}/invite/${token}`, { waitUntil: 'networkidle0' });
    await signIn(bo, email('minutes-bo'), 'Bo Member');
    await clickButton(bo, 'Accept and join');
    await finishOnboarding(bo);
  });

  step('writes the summary and the agreements; each saves itself', async () => {
    await mia.goto(`${BASE_URL}/meetings/${meeting.id}`, { waitUntil: 'networkidle0' });
    await mia.waitForSelector('[data-testid=internal-minutes][data-editable=true]');
    await click(mia, '[data-testid=minutes-summary]');
    await mia.keyboard.type('We agreed on the scope of the ');
    await click(mia, '[data-testid=minutes-summary-bold]'); // "**bold text**", selected: typing replaces it
    await mia.waitForFunction(() => {
      const el = document.querySelector('[data-testid=minutes-summary]');
      return el === document.activeElement && el.value.slice(el.selectionStart, el.selectionEnd) === 'bold text';
    });
    await mia.keyboard.type('pilot');
    await saved(mia);
    assert.equal((await minutes()).summary, 'We agreed on the scope of the **pilot**');

    await click(mia, '[data-testid=minutes-agreements]');
    await mia.keyboard.type('Pilot starts in November');
    await click(mia, '[data-testid=minutes-agreements-bullets]');
    await saved(mia);
    assert.equal((await minutes()).agreements, '- Pilot starts in November');

    // Out of the editor, the text shows formatted.
    await click(mia, '[data-testid=minutes-add-step]');
    const view = await mia.waitForSelector('[data-testid=minutes-summary-view] strong');
    assert.equal(await view.evaluate((el) => el.textContent), 'pilot');
    // The agreements turn into their formatted view once the click is over.
    const item = await mia.waitForSelector('[data-testid=minutes-agreements-view] li');
    assert.equal(await item.evaluate((el) => el.textContent), 'Pilot starts in November');
    // The meeting counts as recorded.
    assert.equal((await api(mia, `/crm/meetings/${meeting.id}`)).internalMinutes, 'recorded');
  });

  step('adds a next step with an owner and a due date', async () => {
    await mia.waitForSelector('[data-testid=minutes-step] [data-testid=step-text]');
    await mia.type('[data-testid=minutes-step] [data-testid=step-text]', STEP);
    await setValue(mia, '[data-testid=minutes-step] [data-testid=step-owner]', miaId);
    await setValue(mia, '[data-testid=minutes-step] [data-testid=step-due]', today());
    await saved(mia);
    const steps = await eventually(async () => {
      const list = (await minutes()).nextSteps;
      return list.length === 1 && list[0].text === STEP && list[0].dueDate === today() && list;
    });
    assert.ok(steps, 'the step was saved');
    assert.equal(steps[0].ownerUserId, miaId);
    assert.equal(steps[0].taskId, null);
  });

  step('"Create task" makes a task on the deal, linked from the step, and it shows on Today', async () => {
    await click(mia, '[data-testid=step-create-task]');
    await mia.waitForSelector('[data-testid=step-task-link]', { timeout: 10_000 });
    const { nextSteps } = await minutes();
    assert.ok(nextSteps[0].taskId, 'the step links to its task');
    const task = (await api(mia, `/crm/deal-tasks?dealIds=${deal.id}`)).find((t) => t.id === nextSteps[0].taskId);
    assert.ok(task, 'the task is on the deal');
    assert.equal(task.channel, 'MT');
    assert.equal(task.label, STEP);
    assert.equal(task.assigneeUserId, miaId);
    assert.equal(task.dueDate, today());
    assert.equal(await mia.$('[data-testid=step-create-task]'), null, 'once only');

    await click(mia, '[data-testid=step-task-link]');
    await mia.waitForFunction((id) => location.pathname === `/deals/${id}`, {}, deal.id);
    await mia.goto(`${BASE_URL}/today`, { waitUntil: 'networkidle0' });
    const group = await mia.waitForSelector('[data-group="Today"]');
    await mia.waitForFunction((step) => document.querySelector('[data-group="Today"]')?.innerText.includes(step), { timeout: 10_000 }, STEP);
    assert.match(await group.evaluate((el) => el.innerText), /Send the pilot contract/);
  });

  step('a member who is not at the meeting reads the minutes but cannot change them', async () => {
    await bo.goto(`${BASE_URL}/meetings/${meeting.id}`, { waitUntil: 'networkidle0' });
    await bo.waitForSelector('[data-testid=internal-minutes][data-editable=false]');
    assert.equal(await bo.$('[data-testid=minutes-summary]'), null, 'no editor');
    assert.equal(await bo.$('[data-testid=minutes-add-step]'), null);
    assert.equal(await bo.$('[data-testid=step-create-task]'), null);
    assert.equal(await bo.$eval('[data-testid=minutes-summary-view]', (el) => el.querySelector('strong')?.textContent), 'pilot');
    const stepText = await bo.$eval('[data-testid=minutes-step]', (el) => el.innerText);
    assert.match(stepText, /Send the pilot contract/);
    assert.match(stepText, /Mia Minutes/);
    assert.ok(await bo.$('[data-testid=step-task-link]'), 'the task link is shown');
    assert.match(await bo.$eval('[data-testid=internal-minutes]', (el) => el.innerText), /Only the organizer, the internal participants, owners and admins can write the minutes/);
  });
});
