import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  dealAssignedEmail,
  DIGEST_SECTION_LIMIT,
  digestEmail,
  digestItemCount,
  type DigestMeetingRow,
  type DigestTaskRow,
  isDigestHour,
  isEmptyDigest,
  zonedNow,
} from '../src/modules/notifications/digest-content';
import { countVisits } from '../src/modules/crm/visit-plans/visit-counting';

const task = (id: string, dueDate: string, over: Partial<DigestTaskRow> = {}): DigestTaskRow => ({ id, title: `Task ${id}`, dueDate, dealId: `deal-${id}`, dealTitle: `Deal ${id}`, company: 'Acme', ...over });

describe('buildDigest', () => {
  it('splits tasks into overdue and due today, oldest first, and keeps the deals without a next step', () => {
    const d = buildDigest('2026-09-24', [task('c', '2026-09-24'), task('a', '2026-09-20'), task('b', '2026-09-23')], [
      { id: 'd2', title: 'Zeta', company: null, stage: 'Discovery' },
      { id: 'd1', title: 'Alpha', company: 'Acme', stage: 'Proposal' },
    ]);
    expect(d.overdue.map((t) => t.id)).toEqual(['a', 'b']);
    expect(d.dueToday.map((t) => t.id)).toEqual(['c']);
    expect(d.noNextStep.map((x) => x.title)).toEqual(['Alpha', 'Zeta']);
    expect(digestItemCount(d)).toBe(5);
    expect(isEmptyDigest(d)).toBe(false);
  });

  it('leaves out tasks due later (the loader only asks up to today, but the builder is strict too)', () => {
    const d = buildDigest('2026-09-24', [task('x', '2026-09-25')], []);
    expect(isEmptyDigest(d)).toBe(true);
  });
});

const meeting = (id: string, startsAt: string, endsAt: string, over: Partial<DigestMeetingRow> = {}): DigestMeetingRow => ({
  id,
  title: `Meeting ${id}`,
  startsAt,
  endsAt,
  company: 'Acme',
  status: 'planned',
  ...over,
});

describe('buildDigest: meetings (CD-130)', () => {
  const now = new Date('2026-10-25T06:00:00Z'); // 07:00 in Belgrade, the day clocks go back
  const opts = (today: DigestMeetingRow[], notClosed: DigestMeetingRow[] = []) => ({ today, notClosed, timeZone: 'Europe/Belgrade', now });

  it('lists the planned and held meetings starting today on the workspace clock, earliest first', () => {
    const d = buildDigest('2026-10-25', [], [], opts([
      meeting('late', '2026-10-25T15:00:00Z', '2026-10-25T16:00:00Z'),
      meeting('early', '2026-10-24T22:30:00Z', '2026-10-24T23:30:00Z', { status: 'held' }), // 00:30 CEST on the 25th
      meeting('yesterday', '2026-10-24T21:30:00Z', '2026-10-24T23:30:00Z'), // 23:30 on the 24th, crossing midnight
      meeting('cancelled', '2026-10-25T09:00:00Z', '2026-10-25T10:00:00Z', { status: 'cancelled' }),
    ]));
    expect(d.meetingsToday.map((m) => m.id)).toEqual(['early', 'late']);
    expect(d.timeZone).toBe('Europe/Belgrade');
    expect(digestItemCount(d)).toBe(2);
  });

  it('lists planned meetings that ended more than 24 hours ago as not closed', () => {
    const d = buildDigest('2026-10-25', [], [], opts([], [
      meeting('old', '2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z'),
      meeting('recent', '2026-10-24T08:00:00Z', '2026-10-24T09:00:00Z'), // ended 21 hours ago
      meeting('held', '2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z', { status: 'held' }),
    ]));
    expect(d.notClosed.map((m) => m.id)).toEqual(['old']);
    expect(isEmptyDigest(d)).toBe(false);
  });

  it('puts the meetings in the email with times in the workspace zone and links to the meetings', () => {
    const d = buildDigest('2026-10-25', [], [], opts(
      [meeting('m1', '2026-10-25T09:00:00Z', '2026-10-25T10:30:00Z', { title: 'Visit <Globex>', company: 'Globex' })],
      [meeting('m2', '2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z', { title: 'Demo' })],
    ));
    const mail = digestEmail({ to: 'bo@example.com', memberName: 'Bo', workspaceName: 'Acme Studio', appUrl: 'https://app.example.com', digest: d });
    expect(mail.subject).toBe('Your day in Acme Studio: 1 meeting today, 1 meeting not closed');
    // 09:00Z is 10:00 CET after the change (it would be 11:00 in summer time).
    expect(mail.text).toContain('Meetings today (1)\n- 10:00–11:30 Visit <Globex> · Globex\n  https://app.example.com/meetings/m1');
    expect(mail.text).toContain('Not closed meetings (1)\n- Demo · Acme (20 Oct)\n  https://app.example.com/meetings/m2');
    expect(mail.html).toContain('Visit &lt;Globex&gt;');
  });
});

describe('buildDigest: minutes missing (CD-132)', () => {
  const now = new Date('2026-10-25T06:00:00Z');
  const held = (id: string, startsAt: string, over: Partial<DigestMeetingRow> = {}) =>
    meeting(id, startsAt, new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(), { status: 'held', ...over });

  it('lists held meetings without a summary that started in the last 7 days, oldest first', () => {
    const d = buildDigest('2026-10-25', [], [], {
      minutesMissing: [
        held('yesterday', '2026-10-24T09:00:00Z'),
        held('six-days', '2026-10-19T09:00:00Z'),
        held('edge', '2026-10-18T06:00:00Z'), // exactly 7 days before now: still listed
        held('eight-days', '2026-10-17T09:00:00Z'),
        held('planned', '2026-10-24T09:00:00Z', { status: 'planned' }),
        held('cancelled', '2026-10-24T09:00:00Z', { status: 'cancelled' }),
      ],
      timeZone: 'Europe/Belgrade',
      now,
    });
    expect(d.minutesMissing.map((m) => m.id)).toEqual(['edge', 'six-days', 'yesterday']);
    expect(digestItemCount(d)).toBe(3);
    expect(isEmptyDigest(buildDigest('2026-10-25', [], [], { minutesMissing: [held('old', '2026-10-01T09:00:00Z')], now }))).toBe(true);
  });

  it('puts a "Minutes missing" section in the email, linking to the meetings', () => {
    const d = buildDigest('2026-10-25', [], [], { minutesMissing: [held('m3', '2026-10-23T08:00:00Z', { title: 'Visit <Initech>', company: 'Initech' })], timeZone: 'Europe/Belgrade', now });
    const mail = digestEmail({ to: 'bo@example.com', memberName: 'Bo', workspaceName: 'Acme Studio', appUrl: 'https://app.example.com', digest: d });
    expect(mail.subject).toBe('Your day in Acme Studio: 1 meeting without minutes');
    expect(mail.text).toContain('Minutes missing (1)\n- Visit <Initech> · Initech (held 23 Oct)\n  https://app.example.com/meetings/m3');
    expect(mail.html).toContain('Minutes missing');
    expect(mail.html).toContain('Visit &lt;Initech&gt;');
    expect(mail.html).toContain('href="https://app.example.com/meetings/m3"');
  });
});

describe('buildDigest: visit plan progress (CD-135)', () => {
  const now = new Date('2026-10-15T07:00:00Z');
  const visit = (id: string, startsAt: string, companyId: string) => ({
    id,
    type: 'visit' as const,
    status: 'held' as const,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 3600_000),
    companyId,
    companyName: companyId,
    organizerUserId: 'ana',
    dealOwnerUserId: null,
    internalUserIds: ['ana'],
  });

  it('says "N of M held" per running plan, counted as the plan page counts (capped per customer), month first', () => {
    const lines = [
      { companyId: 'acme', plannedVisits: 2 },
      { companyId: 'beta', plannedVisits: 3 },
    ];
    // Three visits at Acme (one over plan), none at Beta, one unplanned at Gamma: 2 of 5.
    const visits = [visit('1', '2026-10-02T08:00:00Z', 'acme'), visit('2', '2026-10-05T08:00:00Z', 'acme'), visit('3', '2026-10-06T08:00:00Z', 'acme'), visit('4', '2026-10-07T08:00:00Z', 'gamma')];
    const month = countVisits({ salespersonUserId: 'ana', periodStart: '2026-10-01', periodEnd: '2026-11-01', lines }, visits, now, 'Europe/Belgrade').totals;
    const quarter = countVisits({ salespersonUserId: 'ana', periodStart: '2026-10-01', periodEnd: '2027-01-01', lines: [{ companyId: 'acme', plannedVisits: 6 }] }, visits, now, 'Europe/Belgrade').totals;
    const d = buildDigest('2026-10-15', [task('a', '2026-10-15')], [], {
      timeZone: 'Europe/Belgrade',
      now,
      visitPlans: [
        { planId: 'q', periodType: 'quarter', periodLabel: 'Q4 2026', held: quarter.heldCapped, planned: quarter.planned },
        { planId: 'm', periodType: 'month', periodLabel: 'October 2026', held: month.heldCapped, planned: month.planned },
      ],
    });
    expect(d.visitPlans.map((p) => p.planId)).toEqual(['m', 'q']);
    const mail = digestEmail({ to: 'ana@example.com', memberName: 'Ana', workspaceName: 'Acme Studio', appUrl: 'https://app.example.com/', digest: d });
    expect(mail.text).toContain(
      [
        'Visit plan progress (2)',
        '- Visits planned this period (October 2026): 2 of 5 held',
        '  https://app.example.com/visit-plans/m',
        '- Visits planned this period (Q4 2026): 3 of 6 held',
        '  https://app.example.com/visit-plans/q',
      ].join('\n'),
    );
    expect(mail.html).toContain('Visits planned this period (October 2026): 2 of 5 held');
    // The plan doesn't change the subject's counts.
    expect(mail.subject).toBe('Your day in Acme Studio: 1 due today');
  });

  it('is never a reason to send the digest on its own', () => {
    const d = buildDigest('2026-10-15', [], [], { visitPlans: [{ planId: 'm', periodType: 'month', periodLabel: 'October 2026', held: 0, planned: 4 }] });
    expect(isEmptyDigest(d)).toBe(true);
  });

  it('has no section without a running plan', () => {
    const d = buildDigest('2026-10-15', [task('a', '2026-10-15')], []);
    expect(d.visitPlans).toEqual([]);
    expect(digestEmail({ to: 'a@example.com', memberName: null, workspaceName: 'W', appUrl: 'https://x', digest: d }).text).not.toContain('Visit plan progress');
  });
});

describe('zonedNow and the digest hour', () => {
  const at = new Date('2026-09-24T06:30:00Z');
  it('reads the date and hour on the workspace clock', () => {
    expect(zonedNow('Europe/Belgrade', at)).toEqual({ date: '2026-09-24', hour: 8, minute: 30 });
    expect(zonedNow('America/New_York', at)).toEqual({ date: '2026-09-24', hour: 2, minute: 30 });
    expect(zonedNow('Pacific/Kiritimati', at)).toEqual({ date: '2026-09-24', hour: 20, minute: 30 });
    expect(zonedNow('Pacific/Pago_Pago', at)).toEqual({ date: '2026-09-23', hour: 19, minute: 30 });
    expect(zonedNow('Asia/Kolkata', at)).toEqual({ date: '2026-09-24', hour: 12, minute: 0 });
  });

  it('treats an unknown zone as UTC and midnight as hour 0', () => {
    expect(zonedNow('Not/AZone', at)).toEqual({ date: '2026-09-24', hour: 6, minute: 30 });
    expect(zonedNow('UTC', new Date('2026-09-24T00:05:00Z')).hour).toBe(0);
  });

  it('opens the window from 8:00 to 11:59', () => {
    expect([7, 8, 9, 11, 12, 20].map(isDigestHour)).toEqual([false, true, true, true, false, false]);
  });
});

describe('digestEmail', () => {
  const digest = buildDigest('2026-09-24', [task('a', '2026-09-22', { title: 'Call <Ana>' }), task('b', '2026-09-24', { company: null })], [{ id: 'd1', title: 'Renewal', company: 'Globex', stage: 'Proposal' }]);
  const mail = digestEmail({ to: 'bo@example.com', memberName: 'Bo Jensen', workspaceName: 'Acme Studio', appUrl: 'https://app.example.com/', digest });

  it('summarises the counts in the subject', () => {
    expect(mail.subject).toBe('Your day in Acme Studio: 1 overdue, 1 due today, 1 deal without a next step');
  });

  it('lists each section with links to the deals, in text and HTML', () => {
    expect(mail.text).toContain('Good morning, Bo.');
    expect(mail.text).toContain('Thursday 24 September');
    expect(mail.text).toContain('Overdue tasks (1)\n- Call <Ana> (was due 22 Sept) · Deal a · Acme\n  https://app.example.com/deals/deal-a');
    expect(mail.text).toContain('Due today (1)\n- Task b · Deal b\n');
    expect(mail.text).toContain('Deals with no next step (1)\n- Renewal · Globex · Proposal\n  https://app.example.com/deals/d1');
    expect(mail.text).toContain('https://app.example.com/settings/notifications');
    expect(mail.html).toContain('Call &lt;Ana&gt;');
    expect(mail.html).toContain('href="https://app.example.com/deals/d1"');
    expect(mail.html).toContain('src="https://app.example.com/email-logo.png"');
  });

  it('leaves out empty sections and caps long ones', () => {
    const many = buildDigest('2026-09-24', Array.from({ length: DIGEST_SECTION_LIMIT + 3 }, (_, i) => task(String(i).padStart(2, '0'), '2026-09-24')), []);
    const m = digestEmail({ to: 'x@example.com', memberName: null, workspaceName: 'W', appUrl: 'https://a.test', digest: many });
    expect(m.subject).toBe(`Your day in W: ${DIGEST_SECTION_LIMIT + 3} due today`);
    expect(m.text).not.toContain('Overdue tasks');
    expect(m.text).not.toContain('no next step');
    expect(m.text).toContain('- and 3 more');
    expect(m.text.startsWith('Good morning.')).toBe(true);
  });
});

describe('dealAssignedEmail', () => {
  it('says who assigned which deal, with its facts and link', () => {
    const mail = dealAssignedEmail({
      to: 'bo@example.com',
      assigneeName: 'Bo Jensen',
      actorName: 'Ana Petrović',
      workspaceName: 'Acme Studio',
      appUrl: 'https://app.example.com',
      deal: { id: 'd1', title: 'Website rebuild', company: 'Globex', stage: 'Discovery', amount: '14000.00', currency: 'EUR', closeDate: '2026-10-15' },
    });
    expect(mail.subject).toBe('Ana Petrović assigned you Website rebuild');
    expect(mail.text).toContain('Ana Petrović made you the owner of Website rebuild in Acme Studio.');
    expect(mail.text).toContain('Company: Globex\nStage: Discovery\nValue: €14,000\nExpected close: 15 Oct');
    expect(mail.text).toContain('https://app.example.com/deals/d1');
  });
});
