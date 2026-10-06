// Calendar and meeting page fixes from testing (CD-212, CD-221): dragging over empty slots on the
// week view draws a placeholder that can be resized, and the quick-create popover (laid out like
// Google Calendar's: title, type, date and time, guests, location, agenda, organizer, company and
// deal) saves it with a guest; an end before the start is an error that loses nothing, and moving
// the start keeps the length; Escape discards one; a meeting's lower edge and the meeting itself
// are dragged right on the Calendar; a click on a day of the month opens the popover at 09:00; the
// New meeting page offers only the meeting company's contacts and, alone in the workspace, "Invite
// a colleague"; picking a deal invites its primary contact; the meeting page edits the time in
// place on one line.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, RUN, setValue, steps, useBrowser } from '../lib/harness.mjs';

const TZ = 'Europe/Belgrade'; // new workspaces use it
const HOUR = 48; // px per hour of the time grid
const QUICK = '[data-testid=quick-create]';

/** An ISO date `days` from today in the workspace time zone. */
function isoDay(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
/** "10:00" of an instant in the workspace time zone. */
const hm = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

describe('calendar quick create and in-place editing', () => {
  const browser = useBrowser();
  const step = steps(browser, 'calendar-quick-create');
  let page;
  let alpha;
  let beta;
  let gamma;
  let gita;
  let gammaOne;
  let deal;
  let meetingId;
  const TITLE = `Quick plan ${RUN}`;
  const DAY = isoDay(10); // a weekday or weekend in the future, with no other meetings

  /** The screen point of a minute of the day in DAY's column. */
  const at = (minutes) =>
    page.evaluate(
      (day, minutes, hour) => {
        const r = document.querySelector(`.cal-col[data-day="${day}"]`).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + (minutes / 60) * hour };
      },
      DAY,
      minutes,
      HOUR,
    );
  /** Presses at a point, moves by (dx, dy) in small steps and lets go. */
  async function drag(from, dx, dy) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
    await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
    await page.mouse.up();
  }
  const centerOf = (selector) =>
    page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  const draftTime = () => page.$eval('[data-testid=cal-draft-time]', (el) => el.textContent.trim());
  const value = (selector) => page.$eval(selector, (el) => el.value);
  /** Picks someone from "Add guests" (within `scope`). */
  async function addGuest(scope, name) {
    await click(page, `${scope} [data-testid=meeting-guests-add] .picker-search`);
    await page.type(`${scope} [data-testid=meeting-guests-add] .picker-search`, name.split(' ')[0]);
    await click(page, `${scope} [data-testid=meeting-guests-add] .picker-item::-p-text(${name})`);
    await page.waitForFunction((scope, name) => document.querySelector(`${scope} [data-testid=meeting-guests-list]`)?.innerText.includes(name), {}, scope, name);
  }

  step('sets up three companies with contacts and deals', async () => {
    page = await browser.person('quinn');
    await newUserWithWorkspace(page, { label: 'quick', name: 'Quinn Quick', workspace: 'Quick Co' });
    alpha = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Quick Alpha ${RUN}`, hq: 'Novi Sad' }) });
    beta = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Quick Beta ${RUN}` }) });
    gamma = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Quick Gamma ${RUN}` }) });
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Ana Alpha', companyId: alpha.id }) });
    await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Boris Beta', companyId: beta.id }) });
    gita = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Gita Gamma', companyId: gamma.id, email: 'gita@gamma.example.com' }) });
    const funnels = await api(page, '/crm/funnels');
    deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Alpha rollout', funnelId: funnels[0].id, companyId: alpha.id }) });
    // Gamma has two open deals: nothing is picked for you; the first has Gita as its primary contact.
    gammaOne = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Gamma one', funnelId: funnels[0].id, companyId: gamma.id, primaryContactId: gita.id }) });
    await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Gamma two', funnelId: funnels[0].id, companyId: gamma.id }) });
  });

  step('dragging draws a placeholder; the popover has Google Calendar’s fields and saves it with a guest', async () => {
    await page.goto(`${BASE_URL}/calendar?view=week&date=${DAY}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`.cal-col[data-day="${DAY}"]`);
    // 10:00 to 11:30, in 15-minute steps.
    const from = await at(10 * 60 + 2);
    await drag(from, 0, 1.5 * HOUR - 2);
    await page.waitForSelector(QUICK);
    assert.equal(await draftTime(), '10:00–11:30');
    assert.equal(await value(`${QUICK} [data-testid=meeting-start]`), '10:00');
    assert.equal(await value(`${QUICK} [data-testid=meeting-end]`), '11:30');
    assert.equal(await page.$(`${QUICK} input[type=time], ${QUICK} input[type=date]`), null, '24-hour fields of the app, not the browser’s');
    // From top to bottom: title, type, date and time, guests, location, agenda, organizer, company, deal.
    const order = await page.$eval(QUICK, (el) =>
      ['quick-title', 'meeting-type', 'meeting-when-fields', 'meeting-guests', 'meeting-location', 'meeting-agenda', 'meeting-organizer', 'meeting-company', 'meeting-deal', 'meeting-save'].map((id) => {
        const node = el.querySelector(`[data-testid=${id}]`);
        return node ? Math.round(node.getBoundingClientRect().top) : null;
      }),
    );
    assert.ok(order.every((top) => top !== null), `every field is there: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `in Google Calendar's order: ${order}`);

    // Its lower edge, half an hour down: 10:00–12:00; the popover follows.
    const edge = await centerOf('[data-testid=cal-draft-resize]');
    await drag(edge, 0, HOUR / 2);
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-draft-time]')?.textContent.trim() === '10:00–12:00');
    assert.equal(await value(`${QUICK} [data-testid=meeting-end]`), '12:00');
    assert.ok(await page.$(QUICK), 'still open');

    // The deal is required: saving without a company says so.
    await click(page, `${QUICK} [data-testid=meeting-save]`);
    await page.waitForSelector(`${QUICK} [data-testid=meeting-errors]`);
    assert.match(await page.$eval(`${QUICK} [data-testid=meeting-errors]`, (el) => el.innerText), /Pick the customer company/);

    await page.type('[data-testid=quick-title]', TITLE);
    await setValue(page, `${QUICK} [data-testid=meeting-company]`, alpha.id);
    await page.waitForFunction((id) => document.querySelector('[data-testid=quick-create] [data-testid=meeting-deal]')?.value === id, {}, deal.id);
    assert.equal(await value(`${QUICK} [data-testid=meeting-location]`), 'Novi Sad', 'a visit is at the HQ');
    await addGuest(QUICK, 'Ana Alpha');
    await click(page, `${QUICK} [data-testid=meeting-save]`);
    await page.waitForFunction(() => !document.querySelector('[data-testid=quick-create]'), { timeout: 10_000 });
    assert.equal(await page.$('[data-testid=cal-draft]'), null, 'the placeholder is gone');
    const saved = await eventually(async () => (await api(page, `/crm/meetings?dealId=${deal.id}`)).meetings.find((m) => m.title === TITLE));
    assert.ok(saved, 'the meeting was saved');
    meetingId = saved.id;
    assert.equal(hm(saved.startsAt), '10:00');
    assert.equal(hm(saved.endsAt), '12:00');
    assert.equal(saved.type, 'visit');
    assert.equal(saved.location, 'Novi Sad');
    assert.deepEqual(
      saved.participants.map((p) => [p.kind, p.name]),
      [
        ['internal', 'Quinn Quick'],
        ['external', 'Ana Alpha'],
      ],
    );
    await page.waitForSelector(`.cal-col[data-day="${DAY}"] .cal-block[data-meeting-id="${meetingId}"]`);
  });

  step('an end before the start is an error and loses nothing; moving the start keeps the length; Escape discards', async () => {
    const p = await at(15 * 60 + 5);
    await page.mouse.click(p.x, p.y);
    await page.waitForSelector(QUICK);
    assert.equal(await draftTime(), '15:00–16:00', 'a click makes an hour from the half hour');
    await page.type('[data-testid=quick-title]', 'Not lost');
    await setValue(page, `${QUICK} [data-testid=meeting-company]`, alpha.id);

    // B1: the end before the start says so at once; Save keeps the popover and saves nothing.
    await setValue(page, `${QUICK} [data-testid=meeting-end]`, '14:00');
    await page.waitForSelector(`${QUICK} [data-testid=meeting-time-error]`);
    await click(page, `${QUICK} [data-testid=meeting-save]`);
    await page.waitForSelector(`${QUICK} [data-testid=meeting-errors]`);
    assert.match(await page.$eval(`${QUICK} [data-testid=meeting-errors]`, (el) => el.innerText), /The end must be after the start/);
    assert.ok(await page.$(QUICK), 'still open');
    assert.equal(await value('[data-testid=quick-title]'), 'Not lost');
    assert.equal((await api(page, `/crm/meetings?dealId=${deal.id}`)).meetings.length, 1, 'nothing saved');

    // B7: a new start moves the end; a length that isn't valid becomes an hour, then is kept.
    await setValue(page, `${QUICK} [data-testid=meeting-start]`, '16:00');
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-draft-time]')?.textContent.trim() === '16:00–17:00');
    assert.equal(await value(`${QUICK} [data-testid=meeting-end]`), '17:00');
    assert.equal(await page.$(`${QUICK} [data-testid=meeting-time-error]`), null);
    await setValue(page, `${QUICK} [data-testid=meeting-end]`, '17:30');
    await setValue(page, `${QUICK} [data-testid=meeting-start]`, '13:00');
    await page.waitForFunction(() => document.querySelector('[data-testid=cal-draft-time]')?.textContent.trim() === '13:00–14:30');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=quick-create]') && !document.querySelector('[data-testid=cal-draft]'));

    await page.mouse.click(p.x, p.y);
    await page.waitForSelector(QUICK);
    await click(page, '[data-testid=cal-title]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=quick-create]') && !document.querySelector('[data-testid=cal-draft]'));
    assert.equal((await api(page, `/crm/meetings?dealId=${deal.id}`)).meetings.length, 1, 'nothing saved');
  });

  step('a meeting is resized by its lower edge and moved by dragging, right on the Calendar', async () => {
    const block = `.cal-block[data-meeting-id="${meetingId}"]`;
    // Lower edge an hour down: 10:00–13:00.
    await drag(await centerOf(`${block} [data-testid=cal-resize]`), 0, HOUR);
    const resized = await eventually(async () => {
      const m = await api(page, `/crm/meetings/${meetingId}`);
      return hm(m.endsAt) === '13:00' && m;
    });
    assert.ok(resized, 'the new end was saved');
    assert.equal(hm(resized.startsAt), '10:00');
    // Moved an hour later, the length kept: 11:00–14:00.
    await page.waitForFunction((sel) => document.querySelector(sel)?.getBoundingClientRect().height > 2.5 * 48, {}, block);
    await drag(await centerOf(block), 0, HOUR);
    const moved = await eventually(async () => {
      const m = await api(page, `/crm/meetings/${meetingId}`);
      return hm(m.startsAt) === '11:00' && m;
    });
    assert.ok(moved, 'the new time was saved');
    assert.equal(hm(moved.endsAt), '14:00');
    // A click on the lower edge alone changes nothing and stays on the Calendar.
    await page.waitForFunction((sel) => !!document.querySelector(sel), {}, `${block} [data-testid=cal-resize]`);
    const edge = await centerOf(`${block} [data-testid=cal-resize]`);
    await page.mouse.click(edge.x, edge.y);
    assert.equal(new URL(page.url()).pathname, '/calendar');
  });

  step('a click on a day of the month opens the popover at 09:00', async () => {
    await page.goto(`${BASE_URL}/calendar?view=month&date=${DAY}`, { waitUntil: 'networkidle0' });
    const corner = await page.$eval(`.cal-cell[data-day="${DAY}"]`, (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.right - 6, y: r.bottom - 6 };
    });
    await page.mouse.click(corner.x, corner.y);
    await page.waitForSelector(QUICK);
    assert.equal(await page.$eval(`${QUICK} [data-testid=meeting-date]`, (el) => el.dataset.value), DAY);
    assert.equal(await value(`${QUICK} [data-testid=meeting-start]`), '09:00');
    assert.equal(await value(`${QUICK} [data-testid=meeting-end]`), '10:00');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid=quick-create]'));
  });

  step('the New meeting page offers the meeting company’s contacts and, alone in the workspace, "Invite a colleague"', async () => {
    await click(page, '[data-testid=cal-new]');
    await page.waitForSelector('[data-testid=new-meeting] [data-testid=meeting-form]');
    await click(page, '[data-testid=meeting-guests-add] .picker-search');
    await page.waitForSelector('[data-testid=guests-pick-company]');
    await page.waitForSelector('[data-testid=guests-invite-colleague]');
    await setValue(page, '[data-testid=meeting-company]', alpha.id);
    await click(page, '[data-testid=meeting-guests-add] .picker-search');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-guests-add]')?.innerText.includes('Ana Alpha'));
    const listed = await page.$eval('[data-testid=meeting-guests-add]', (el) => el.innerText);
    assert.ok(!listed.includes('Boris Beta'), `another company's contact is not offered: ${listed}`);
    assert.match(listed, /Add new contact at Quick Alpha/);
    assert.match(listed, /Invite a colleague/);
    await click(page, '[data-testid=meeting-close]');
    await page.waitForFunction(() => location.pathname === '/calendar' && !document.querySelector('[data-testid=meeting-form]'));
  });

  step('picking a deal invites its primary contact', async () => {
    await page.goto(`${BASE_URL}/meetings/new?companyId=${gamma.id}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=new-meeting] [data-testid=meeting-form]');
    assert.equal(await value('[data-testid=meeting-deal]'), '', 'two open deals: none is picked');
    assert.ok(!(await page.$eval('[data-testid=meeting-guests-list]', (el) => el.innerText)).includes('Gita Gamma'));
    await setValue(page, '[data-testid=meeting-deal]', gammaOne.id);
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-guests-list]')?.innerText.includes('Gita Gamma'));
    assert.match(await page.$eval('[data-testid=meeting-guests-list] [data-kind=external]', (el) => el.innerText), /gita@gamma\.example\.com/);
  });

  step('"Invite a colleague" opens the invitation in Settings → Team', async () => {
    await click(page, '[data-testid=meeting-guests-add] .picker-search');
    await click(page, '[data-testid=guests-invite-colleague]');
    await page.waitForFunction(() => location.pathname === '/settings/team');
    await page.waitForFunction(() => document.body.innerText.includes('Invite a teammate'));
  });

  step('the meeting page: a compact header, the time on one line edited in place, details beside the guests', async () => {
    await page.goto(`${BASE_URL}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=meeting-field-start]');
    assert.equal(await page.$('[data-testid=meeting-edit]'), null);
    assert.equal(await page.$('[data-testid=meeting-page] .deal-crumb'), null, 'no "Calendar → Company" above the title');
    assert.equal(await page.$('[data-testid=meeting-when]'), null, 'no second summary of the time under the title');
    assert.ok(await page.$('[data-testid=meeting-page] .mf-details'), 'details');
    assert.ok(await page.$('[data-testid=meeting-page] .mf-guests [data-testid=meeting-field-guests]'), 'guests');
    assert.match(await page.$eval('[data-testid=meeting-field-date]', (el) => el.value), /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    const tops = await page.$$eval('[data-testid=meeting-field-when] input', (inputs) => inputs.map((el) => Math.round(el.getBoundingClientRect().top)));
    assert.equal(new Set(tops).size, 1, `date, start and end on one line: ${tops}`);

    await setValue(page, '[data-testid=meeting-field-start]', '15:00');
    const saved = await eventually(async () => {
      const m = await api(page, `/crm/meetings/${meetingId}`);
      return hm(m.startsAt) === '15:00' && m;
    });
    assert.ok(saved, 'the new start was saved');
    assert.equal(hm(saved.endsAt), '18:00', 'the length is kept');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-field-start]')?.value === '15:00');
    assert.equal(await value('[data-testid=meeting-field-end]'), '18:00');

    // An end before the start is refused: it says so and shows the saved time again.
    await setValue(page, '[data-testid=meeting-field-end]', '14:00');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-field-end]')?.value === '18:00', { timeout: 10_000 });
    assert.equal(hm((await api(page, `/crm/meetings/${meetingId}`)).endsAt), '18:00', 'nothing changed');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
