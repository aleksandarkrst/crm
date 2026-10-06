// Meeting calendar (CD-130): creating a meeting from the week view (quick create → More options),
// seeing it in Day, Week, Month and Table, its page (edited in place, held, cancel, restore), the deal's timeline entries, filters kept in
// the URL, "Show all" from a company, scheduling from the deal's Composer, and phones.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { api, BASE_URL, click, eventually, newUserWithWorkspace, RUN, setValue, steps, useBrowser, waitForToastToClear } from '../lib/harness.mjs';

const TZ = 'Europe/Belgrade'; // new workspaces use it
const PHONE = { width: 375, height: 812, isMobile: true, hasTouch: true };

/** An ISO date `days` from today in the workspace time zone. */
function isoDay(days) {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

describe('meeting calendar', () => {
  const browser = useBrowser();
  const step = steps(browser, 'meetings');
  let page;
  let company;
  let contact;
  let deal;
  let meetingId;
  const COMPANY = `Acme Lighting ${RUN}`;
  const DAY = isoDay(8); // a day next week or the one after: in the future, with no other meetings
  const statusOf = () => page.$eval('[data-testid=meeting-status]', (el) => el.innerText.trim());
  const dealMeetings = async () => (await api(page, `/crm/meetings?dealId=${deal.id}`)).meetings;
  /** The deal's timeline, as its page shows it. */
  async function timelineHas(entry) {
    await page.goto(`${BASE_URL}/deals/${deal.id}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction((entry) => document.body.innerText.includes(entry), { timeout: 10_000 }, entry);
  }

  step('sets up a company with a contact and a deal', async () => {
    page = await browser.person('mia');
    await newUserWithWorkspace(page, { label: 'meetings', name: 'Mia Meetings', workspace: 'Meetings Co' });
    company = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: COMPANY, hq: 'Belgrade, Knez Mihailova 1' }) });
    contact = await api(page, '/crm/contacts', { method: 'POST', body: JSON.stringify({ fullName: 'Petra Customer', companyId: company.id, email: 'petra@acme.example.com' }) });
    const funnels = await api(page, '/crm/funnels');
    deal = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Acme showroom lights', funnelId: funnels[0].id, companyId: company.id, primaryContactId: contact.id }) });
  });

  step('creates a meeting by clicking 10:00 in the week view, then "More options"', async () => {
    await page.goto(`${BASE_URL}/calendar?view=week&date=${DAY}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`.cal-col[data-day="${DAY}"]`);
    const at = await page.evaluate((day) => {
      const r = document.querySelector(`.cal-col[data-day="${day}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + 10 * 48 + 12 };
    }, DAY);
    // A click draws an hour from the half hour and opens the quick-create popover (CD-212).
    await page.mouse.click(at.x, at.y);
    await page.waitForSelector('[data-testid=quick-create]');
    assert.equal(await page.$eval('[data-testid=cal-draft-time]', (el) => el.textContent.trim()), '10:00–11:00');
    // An agenda typed in the popover comes along to the New meeting page (CD-221).
    await setValue(page, '[data-testid=quick-create] [data-testid=meeting-agenda]', 'Walk the showroom');
    await click(page, '[data-testid=quick-more]');
    await page.waitForSelector('[data-testid=new-meeting] [data-testid=meeting-form]');
    assert.equal(new URL(page.url()).pathname, '/meetings/new', 'More options is a page');
    assert.equal(await page.$('[data-testid=quick-create]'), null, 'the popover gave way to the page');
    assert.equal(await page.$eval('[data-testid=meeting-date]', (el) => el.dataset.value), DAY);
    // The app's date style ("Tue 6 Oct 2026") and 24-hour times, not the browser's.
    assert.match(await page.$eval('[data-testid=meeting-date]', (el) => el.value), /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}$/);
    assert.equal(await page.$eval('[data-testid=meeting-start]', (el) => el.value), '10:00');
    assert.equal(await page.$eval('[data-testid=meeting-end]', (el) => el.value), '11:00', 'an hour by default');
    assert.equal(await page.$eval('[data-testid=meeting-agenda]', (el) => el.value), 'Walk the showroom');
    // Google Calendar's layout: details beside the guests.
    assert.ok(await page.$('[data-testid=new-meeting] .mf-details'), 'the details column');
    assert.ok(await page.$('[data-testid=new-meeting] .mf-guests [data-testid=meeting-guests]'), 'the guests column');

    // Company is required (AC 6).
    await click(page, '[data-testid=meeting-save]');
    await page.waitForSelector('[data-testid=meeting-errors]');
    assert.match(await page.$eval('[data-testid=meeting-errors]', (el) => el.innerText), /Pick the customer company/);

    await setValue(page, '[data-testid=meeting-company]', company.id);
    await page.waitForFunction((name) => document.querySelector('[data-testid=meeting-title]').value === `Meeting with ${name}`, {}, COMPANY);
    assert.equal(await page.$eval('[data-testid=meeting-deal]', (el) => el.value), deal.id, 'the company’s only open deal');
    assert.equal(await page.$eval('[data-testid=meeting-type]', (el) => el.dataset.value), 'visit');
    assert.equal(await page.$eval('[data-testid=meeting-location]', (el) => el.value), 'Belgrade, Knez Mihailova 1', 'a visit is at the HQ');
    // Picking the deal invites its primary contact (CD-221); this test wants a visit without one.
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-guests-list]')?.innerText.includes('Petra Customer'));
    await click(page, '[data-testid=meeting-guests-list] [data-kind=external] button[title^="Remove"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=meeting-guests-list]').innerText.includes('Petra Customer'));

    // B1: an end before the start says so at once; Save keeps the meeting on screen and sends nothing.
    await setValue(page, '[data-testid=meeting-end]', '09:00');
    await page.waitForSelector('[data-testid=meeting-time-error]');
    assert.match(await page.$eval('[data-testid=meeting-time-error]', (el) => el.innerText), /The end must be after the start/);
    await click(page, '[data-testid=meeting-save]');
    await page.waitForSelector('[data-testid=meeting-errors]');
    assert.equal(new URL(page.url()).pathname, '/meetings/new', 'still on the page');
    assert.equal(await page.$eval('[data-testid=meeting-title]', (el) => el.value), `Meeting with ${COMPANY}`, 'nothing typed is lost');
    assert.deepEqual(await dealMeetings(), [], 'nothing saved');
    // B7: moving the start keeps the length; a length that isn't valid becomes an hour.
    await setValue(page, '[data-testid=meeting-start]', '12:00');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-end]').value === '13:00');
    assert.equal(await page.$('[data-testid=meeting-time-error]'), null);
    await setValue(page, '[data-testid=meeting-end]', '14:30');
    await setValue(page, '[data-testid=meeting-start]', '10:00');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-end]').value === '12:30');
    await setValue(page, '[data-testid=meeting-end]', '11:00');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-end]').value === '11:00');

    // A customer visit without anyone from the customer: a warning, then the second click saves.
    await click(page, '[data-testid=meeting-save]');
    await page.waitForSelector('[data-testid=meeting-no-external]');
    await click(page, '[data-testid=meeting-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=meeting-form]'), { timeout: 10_000 });
    await page.waitForFunction(() => location.pathname === '/calendar', { timeout: 10_000 });
    const rows = await eventually(async () => {
      const list = await dealMeetings();
      return list.length === 1 && list;
    });
    assert.ok(rows, 'the meeting was saved');
    meetingId = rows[0].id;
    assert.equal(rows[0].title, `Meeting with ${COMPANY}`);
    assert.equal(rows[0].status, 'planned');
    await page.waitForSelector(`.cal-col[data-day="${DAY}"] .cal-block[data-meeting-id="${meetingId}"]`);
  });

  step('shows it in the day, month and table views, keeping the period', async () => {
    await click(page, '[data-testid=view-day]');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'day');
    assert.equal(new URL(page.url()).searchParams.get('date'), DAY);
    await page.waitForSelector(`.cal-block[data-meeting-id="${meetingId}"]`);
    await click(page, '[data-testid=view-month]');
    await page.waitForSelector(`.cal-cell[data-day="${DAY}"] .cal-chip[data-meeting-id="${meetingId}"]`);
    await click(page, '[data-testid=view-table]');
    await page.waitForSelector(`[data-testid=meeting-table] .table-row[data-meeting-id="${meetingId}"]`);
    const row = await page.$eval(`.table-row[data-meeting-id="${meetingId}"]`, (el) => el.innerText);
    assert.match(row, /10:00/);
    assert.match(row, /Customer visit/);
    assert.match(row, /Planned/);
    assert.match(row, /Missing/);
    assert.match(row, /Not sent/);
    // Back from the table, a calendar view opens on the table's first day.
    await click(page, '[data-testid=view-week]');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'week');
    assert.equal(new URL(page.url()).searchParams.get('date'), DAY.slice(0, 8) + '01');
  });

  step('the deal timeline says the meeting was scheduled', async () => {
    await timelineHas(`Meeting scheduled · Meeting with ${COMPANY}`);
  });

  step('opens the meeting page from the table; it can’t be marked held before it starts', async () => {
    await page.goto(`${BASE_URL}/calendar?view=table&from=${isoDay(0)}&to=${isoDay(20)}`, { waitUntil: 'networkidle0' });
    await click(page, `.table-row[data-meeting-id="${meetingId}"]`);
    await page.waitForFunction((id) => location.pathname === `/meetings/${id}`, {}, meetingId);
    await page.waitForSelector('[data-testid=meeting-page]');
    assert.equal(await page.$eval('[data-testid=meeting-title-input]', (el) => el.value), `Meeting with ${COMPANY}`);
    assert.equal(await page.$('[data-testid=meeting-edit]'), null, 'no Edit button: fields are edited in place');
    assert.equal(await statusOf(), 'Planned');
    assert.equal(await page.$eval('[data-testid=meeting-held]', (el) => el.disabled), true);
    const picked = (selector) => page.$eval(selector, (el) => el.selectedOptions[0]?.textContent ?? '');
    assert.equal(await picked('[data-testid=meeting-field-deal]'), 'Acme showroom lights', 'the deal is shown');
    assert.equal(await picked('[data-testid=meeting-field-organizer]'), 'Mia Meetings', 'the organizer is shown');
  });

  step('edits the title in place (CD-212)', async () => {
    await setValue(page, '[data-testid=meeting-title-input]', 'Showroom walkthrough');
    assert.ok(await eventually(async () => (await api(page, `/crm/meetings/${meetingId}`)).title === 'Showroom walkthrough'), 'saved after the typing pause');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-title-input]')?.value === 'Showroom walkthrough');
  });

  step('marks it held once it has started; the deal timeline says so', async () => {
    const start = new Date(Date.now() - 3 * 3_600_000);
    const end = new Date(Date.now() - 2 * 3_600_000);
    await api(page, `/crm/meetings/${meetingId}`, { method: 'PATCH', body: JSON.stringify({ startsAt: start.toISOString(), endsAt: end.toISOString() }) });
    await page.goto(`${BASE_URL}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-held]')?.disabled === false);
    await click(page, '[data-testid=meeting-held]');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-status]')?.innerText.trim() === 'Held');
    assert.equal((await api(page, `/crm/meetings/${meetingId}`)).status, 'held');
    await timelineHas('Meeting held · Showroom walkthrough');
  });

  step('undo held, cancel with a reason, and restore', async () => {
    await page.goto(`${BASE_URL}/meetings/${meetingId}`, { waitUntil: 'networkidle0' });
    await click(page, '[data-testid=meeting-undo-held]');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-status]')?.innerText.trim() === 'Planned');
    await waitForToastToClear(page).catch(() => {});
    await click(page, '[data-testid=meeting-cancel]');
    await page.waitForSelector('[data-testid=cancel-reason]');
    await setValue(page, '[data-testid=cancel-reason]', 'Customer moved it');
    await click(page, '[data-testid=cancel-confirm]');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-status]')?.innerText.trim() === 'Cancelled');
    assert.match(await page.$eval('[data-testid=meeting-cancelled]', (el) => el.innerText), /Customer moved it/);
    assert.equal(await page.$('[data-testid=meeting-title-input]'), null, 'a cancelled meeting is read-only');
    assert.equal(await page.$eval('[data-testid=meeting-field-type]', (el) => el.disabled), true);
    await waitForToastToClear(page).catch(() => {});
    await click(page, '[data-testid=meeting-restore]');
    await page.waitForFunction(() => document.querySelector('[data-testid=meeting-status]')?.innerText.trim() === 'Planned');
    assert.equal((await api(page, `/crm/meetings/${meetingId}`)).status, 'planned');
    await timelineHas('Meeting cancelled · Showroom walkthrough');
  });

  step('filter chips live in the URL and survive a reload', async () => {
    const from = isoDay(-30);
    const to = isoDay(30);
    await page.goto(`${BASE_URL}/calendar?view=table&from=${from}&to=${to}&deal=${deal.id}&type=visit`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`.table-row[data-meeting-id="${meetingId}"]`);
    assert.match(await page.$eval('[data-testid=chip-deal]', (el) => el.innerText), /Acme showroom lights/);
    assert.equal(await page.$eval('[data-testid=filter-type-visit]', (el) => el.getAttribute('aria-pressed')), 'true');

    // Only online meetings: ours (a visit) is gone; both types: it is back. The URL follows.
    await click(page, '[data-testid=filter-type-visit]');
    await click(page, '[data-testid=filter-type-online]');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('type') === 'online');
    await page.waitForFunction((id) => !document.querySelector(`.table-row[data-meeting-id="${id}"]`), {}, meetingId);
    await click(page, '[data-testid=filter-type-visit]');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('type') === 'online,visit');
    await page.waitForSelector(`.table-row[data-meeting-id="${meetingId}"]`);

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector(`.table-row[data-meeting-id="${meetingId}"]`);
    assert.equal(await page.$eval('[data-testid=filter-type-online]', (el) => el.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.$eval('[data-testid=view-table]', (el) => el.getAttribute('aria-selected')), 'true');
    assert.equal(await page.$eval('[data-testid=cal-from]', (el) => el.value), from);

    // Switching views keeps the filters and the period.
    await click(page, '[data-testid=view-week]');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'week');
    const params = new URL(page.url()).searchParams;
    assert.equal(params.get('deal'), deal.id);
    assert.equal(params.get('type'), 'online,visit');
    assert.equal(params.get('date'), from);

    await click(page, '[data-testid=chip-deal] button');
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('deal'));
    // The URL changes first; the chip goes with the next render.
    await page.waitForFunction(() => !document.querySelector('[data-testid=chip-deal]'), { timeout: 5_000 });
  });

  step('"Show all" on the company opens the table filtered to it', async () => {
    await page.goto(`${BASE_URL}/companies/${company.id}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=meetings-card]');
    await click(page, '[data-testid=meetings-show-all]');
    await page.waitForFunction(() => location.pathname === '/calendar');
    const params = new URL(page.url()).searchParams;
    assert.equal(params.get('view'), 'table');
    assert.equal(params.get('company'), company.id);
    await page.waitForSelector(`[data-testid=meeting-table] .table-row[data-meeting-id="${meetingId}"]`);
    assert.equal(await page.$eval('[data-testid=filter-company]', (el) => el.value), company.id);
  });

  step('without a planned meeting to come, the deal has no next step', async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=no-next-step]');
  });

  step("the deal's Composer schedules a real meeting", async () => {
    await page.goto(`${BASE_URL}/deals/${deal.id}`, { waitUntil: 'networkidle0' });
    await click(page, '.composer-tab::-p-text(Meeting)');
    await page.waitForSelector('.lead-main [data-testid=meeting-form]');
    // The same layout as the New meeting page (CD-221): title, date and time, details beside the guests.
    assert.ok(await page.$('.lead-main .mf-inline .mf-details'), 'the details column');
    assert.ok(await page.$('.lead-main .mf-inline .mf-guests'), 'the guests column');
    assert.equal(await page.$('.lead-main input[type=time], .lead-main input[type=date]'), null, 'no browser date or time inputs');
    assert.equal(await page.$eval('.lead-main [data-testid=meeting-deal]', (el) => el.value), deal.id);
    assert.match(await page.$eval('.lead-main [data-testid=meeting-guests-list]', (el) => el.innerText), /Petra Customer/, 'the primary contact is invited');
    await setValue(page, '.lead-main [data-testid=meeting-date]', isoDay(3));
    await page.waitForFunction((day) => document.querySelector('.lead-main [data-testid=meeting-date]').dataset.value === day, {}, isoDay(3));
    await setValue(page, '.lead-main [data-testid=meeting-start]', '14:00');
    assert.equal(await page.$eval('.lead-main [data-testid=meeting-save]', (el) => el.innerText.trim()), 'Schedule meeting');
    await click(page, '.lead-main [data-testid=meeting-save]');
    const created = await eventually(async () => (await dealMeetings()).find((m) => m.id !== meetingId));
    assert.ok(created, 'a second meeting on the deal');
    assert.equal(created.participants.filter((p) => p.kind === 'external').map((p) => p.contactId).join(), contact.id);
    await page.waitForFunction((id) => !!document.querySelector(`[data-testid=meetings-card] [data-meeting-id="${id}"]`), { timeout: 10_000 }, created.id);
    // A second "Meeting scheduled" on the timeline.
    await page.waitForFunction(() => document.body.innerText.split('Meeting scheduled · ').length > 2, { timeout: 10_000 });
  });

  step('a deal with a planned meeting to come has a next step', async () => {
    await page.goto(`${BASE_URL}/pipeline`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !document.querySelector('[data-testid=no-next-step]'), { timeout: 10_000 });
  });

  step('a meeting needs a deal: a company without one gets "+ New deal", which is picked after creating it', async () => {
    const other = await api(page, '/crm/companies', { method: 'POST', body: JSON.stringify({ name: `Nodeal Works ${RUN}` }) });
    const start = new Date(Math.ceil((Date.now() + 9 * 86_400_000) / 3_600_000) * 3_600_000).toISOString();
    const openNew = async () => {
      await page.goto(`${BASE_URL}/calendar?new=1&companyId=${other.id}&type=online&start=${encodeURIComponent(start)}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('[data-testid=new-meeting] [data-testid=meeting-form]');
    };
    await openNew();
    assert.match(await page.$eval('[data-testid=meeting-no-deals]', (el) => el.innerText), /This company has no deals yet/);
    // Saving is blocked until there is a deal.
    await click(page, '[data-testid=meeting-save]');
    await page.waitForSelector('[data-testid=meeting-errors]');
    assert.match(await page.$eval('[data-testid=meeting-errors]', (el) => el.innerText), /no deals yet/);
    assert.ok(await page.$('[data-testid=new-meeting] [data-testid=meeting-form]'), 'still open');
    assert.deepEqual((await api(page, `/crm/meetings?companyId=${other.id}`)).meetings, []);

    // "+ New deal": the New deal dialog for this company, above the meeting; creating stays here and picks it.
    await click(page, '[data-testid=meeting-new-deal]');
    await page.waitForSelector('[data-testid=new-deal-create]');
    assert.equal(await page.$eval('[data-testid=new-deal-company]', (el) => el.value), other.id);
    assert.equal(await page.$eval('[data-testid=new-deal-company]', (el) => el.disabled), true);
    await click(page, '[data-testid=new-deal-create]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=new-deal-create]'), { timeout: 10_000 });
    const made = await eventually(async () => (await api(page, '/crm/deals')).find((r) => r.deal.companyId === other.id)?.deal);
    assert.ok(made, 'the deal was created');
    await page.waitForFunction((id) => document.querySelector('[data-testid=meeting-deal]')?.value === id, { timeout: 10_000 }, made.id);
    assert.equal(new URL(page.url()).pathname, '/meetings/new', 'stays on the meeting');
    await click(page, '[data-testid=meeting-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=meeting-form]'), { timeout: 10_000 });
    const saved = await eventually(async () => (await api(page, `/crm/meetings?companyId=${other.id}`)).meetings[0]);
    assert.equal(saved.dealId, made.id);
    await waitForToastToClear(page).catch(() => {});

    // With two open deals nothing is picked for you: saving asks for one.
    const funnels = await api(page, '/crm/funnels');
    const second = await api(page, '/crm/deals', { method: 'POST', body: JSON.stringify({ title: 'Nodeal second deal', funnelId: funnels[0].id, companyId: other.id }) });
    await openNew();
    assert.equal(await page.$eval('[data-testid=meeting-deal]', (el) => el.value), '');
    await click(page, '[data-testid=meeting-save]');
    await page.waitForSelector('[data-testid=meeting-errors]');
    assert.match(await page.$eval('[data-testid=meeting-errors]', (el) => el.innerText), /Pick the deal this meeting is for/);
    await setValue(page, '[data-testid=meeting-deal]', second.id);
    await click(page, '[data-testid=meeting-save]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=meeting-form]'), { timeout: 10_000 });
    assert.ok(await eventually(async () => (await api(page, `/crm/meetings?dealId=${second.id}`)).meetings.length === 1), 'saved on the picked deal');
  });

  step('on a phone: Day by default, Week as a list, nothing scrolls sideways', async () => {
    await page.setViewport(PHONE);
    const sideways = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    await page.goto(`${BASE_URL}/calendar`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=calendar][data-view=day]');
    assert.ok((await sideways()) <= 0, `/calendar scrolls sideways by ${await sideways()}px`);
    for (const path of [`/calendar?view=week&date=${DAY}`, `/calendar?view=month&date=${DAY}`, `/calendar?view=table&from=${isoDay(-30)}&to=${isoDay(30)}`, `/meetings/${meetingId}`, `/meetings/new?companyId=${company.id}`]) {
      await page.goto(BASE_URL + path, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.screen-header');
      assert.ok((await sideways()) <= 0, `${path} scrolls sideways by ${await sideways()}px`);
    }
    // On a phone "+ New meeting" opens the New meeting page (there is no popover on phones).
    await page.goto(`${BASE_URL}/calendar?view=day&date=${DAY}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=calendar][data-view=day]');
    await click(page, '[data-testid=cal-new]');
    await page.waitForSelector('[data-testid=new-meeting] [data-testid=meeting-form]');
    assert.equal(await page.$('[data-testid=quick-create]'), null);
    assert.ok((await sideways()) <= 0, `the New meeting page scrolls sideways by ${await sideways()}px`);
    await click(page, '[data-testid=meeting-close]');
    await page.waitForFunction(() => location.pathname === '/calendar');
    await page.goto(`${BASE_URL}/calendar?view=week&date=${isoDay(3)}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid=day-list]');
  });

  it('throws no uncaught errors in the page', () => {
    assert.deepEqual(browser.errors, []);
  });
});
