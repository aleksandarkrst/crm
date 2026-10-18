/**
 * Approvals (CD-166, spec 9.6): the approver rule on decisions (the manager; nobody their own;
 * Admins only when the rule says so; an absent manager hands over), approve with the balance
 * re-checked and the entitlement frozen, reject with a comment, the status flow and its 409s,
 * cancelling before the start and shortening after it with the days returned, the Approvals
 * list (balance after, who else is away, warnings) and count, the team calendar per role, the
 * daily reminders once a day, and the emails.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, mailTo, ok, type Session, signIn } from './helpers';
import { joinAsEmployee, START } from './people-helpers';

let owner: Session;
let mgr: Session;
let emp: Session;
let peer: Session;
let other: Session;
let tenant: string;
let otherTenant: string;
const id = {} as Record<'owner' | 'mgr' | 'emp' | 'peer' | 'other', string>;
const as = (s: Session) => ({ token: s.token, tenant });
const YEAR = new Date().getUTCFullYear();
const NEXT = YEAR + 1;
const d = (md: string, year = NEXT) => `${year}-${md}`;
const today = () => new Date().toISOString().slice(0, 10);
const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
/** The first Monday to Friday on or after `days` from now (a reminder test needs a working day). */
const weekdayAfter = (days: number) => {
  for (let n = days; ; n++) {
    const date = plus(n);
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return { date, n };
  }
};

const submit = (s: Session, body: Record<string, unknown>) => ok('POST', '/timeoff/requests', { ...as(s), body: { type: 'vacation', ...body } });
const mailsAbout = async (to: string, subjectStart: string) => (await mailTo(owner, to)).filter((m) => m.subject.startsWith(subjectStart));

beforeAll(async () => {
  [owner, mgr, emp, peer, other] = (await Promise.all(['ap-owner', 'ap-mgr', 'ap-emp', 'ap-peer', 'ap-other'].map((l) => signIn(l)))) as [Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Time off approvals');
  otherTenant = await createTenant(other, 'Approvals elsewhere');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  for (const [key, s] of [['mgr', mgr], ['emp', emp], ['peer', peer], ['other', other]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  for (const key of ['mgr', 'emp', 'peer', 'other', 'owner'] as const) await ok('PATCH', `/people/employees/${id[key]}`, { ...as(owner), body: { employmentStartDate: START, ...(key === 'emp' || key === 'peer' ? { managerId: id.mgr } : {}) } }, 200);
});

describe('who decides (spec 9.1, AC 9.6.1)', () => {
  it('the manager; nobody their own; an Admin who is not the approver gets 403; the list and the count follow', async () => {
    const r = await submit(emp, { startDate: d('06-07'), endDate: d('06-11') });
    expect(r.approver).toMatchObject({ kind: 'manager', approvers: [{ employeeId: id.mgr }] });
    expect((await call('POST', `/timeoff/requests/${r.id}/approve`, { ...as(emp), body: {} })).status).toBe(403);
    expect((await call('POST', `/timeoff/requests/${r.id}/approve`, { ...as(owner), body: {} })).status).toBe(403);
    expect((await call('POST', `/timeoff/requests/${r.id}/approve`, { ...as(peer), body: {} })).status).toBe(404);
    expect((await ok('GET', '/timeoff/approvals/count', as(emp))).pending).toBe(0);
    expect((await ok('GET', '/timeoff/approvals/count', as(owner))).pending).toBe(0);
    expect((await ok('GET', '/timeoff/approvals/count', as(mgr))).pending).toBe(1);
    const list = await ok('GET', '/timeoff/approvals', as(mgr));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: r.id, alsoAway: [], startDatePassed: false, twoWeekPartMissing: false });
    expect(list[0].balanceAfter).toBe(20 - r.workingDays);
  });

  it('shows who else is away on those days', async () => {
    const p = await submit(peer, { type: 'unpaid_leave', startDate: d('06-09'), endDate: d('06-10') });
    const list = await ok('GET', '/timeoff/approvals', as(mgr));
    const row = list.find((x: { employee: { id: string } }) => x.employee.id === id.emp);
    expect(row.alsoAway).toEqual([{ employeeId: id.peer, fullName: expect.any(String), what: 'unpaid leave', startDate: d('06-09'), endDate: d('06-10'), status: 'pending' }]);
    // Reject peer's with a comment: the days are released and the employee is emailed.
    expect((await call('POST', `/timeoff/requests/${p.id}/reject`, { ...as(mgr), body: {} })).status).toBe(400);
    const rejected = await ok('POST', `/timeoff/requests/${p.id}/reject`, { ...as(mgr), body: { comment: 'Too many away that week' } }, 200);
    expect(rejected).toMatchObject({ status: 'rejected', decisionComment: 'Too many away that week', decidedBy: { userId: mgr.userId } });
    expect(rejected.days.every((x: { state: string }) => x.state === 'cancelled')).toBe(true);
    const mail = await eventually(async () => (await mailsAbout(peer.email, 'Time off rejected'))[0] ?? null, 'the rejected email');
    expect(mail.text).toContain('- Comment: Too many away that week');
    expect((await call('POST', `/timeoff/requests/${p.id}/reject`, { ...as(mgr), body: { comment: 'again' } })).status).toBe(409);
  });
});

describe('approve (spec 9.3, AC 9.6.2)', () => {
  it('approves: days charged to the pool for good, the entitlement frozen, the employee emailed with the days left', async () => {
    const [pending] = await ok('GET', `/timeoff/requests?employeeId=${id.emp}&status=pending`, as(mgr));
    const r = await ok('POST', `/timeoff/requests/${pending.id}/approve`, { ...as(mgr), body: {} }, 200);
    expect(r).toMatchObject({ status: 'approved', decidedBy: { userId: mgr.userId }, approver: null, canWithdraw: false });
    expect(r.days.every((x: { poolYear: number; state: string }) => x.poolYear === NEXT && x.state === 'counted')).toBe(true);
    const profile = await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(owner));
    expect(profile.entitlements.find((e: { year: number }) => e.year === NEXT).frozen).toBe(true);
    const b = await ok('GET', `/timeoff/employees/${id.emp}/balance?year=${NEXT}`, as(emp));
    expect(b.figures).toMatchObject({ scheduled: r.workingDays, pending: 0, remaining: 20 - r.workingDays });
    const mail = await eventually(async () => (await mailsAbout(emp.email, 'Time off approved'))[0] ?? null, 'the approved email');
    expect(mail.text).toContain(`Vacation days left: ${20 - r.workingDays}`);
    expect((await ok('GET', '/timeoff/approvals/count', as(mgr))).pending).toBe(0);
  });

  it('refuses when the days no longer fit (an adjustment meanwhile)', async () => {
    // 15 more days: pending fits (20 − 5 = 15 left). An adjustment of −10 then leaves 5: approval must refuse.
    const big = await submit(emp, { startDate: d('09-06'), endDate: d('09-24') });
    expect(big.workingDays).toBe(15);
    await ok('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: NEXT, days: -10, kind: 'correction', reason: 'Correction' } });
    const refused = await call('POST', `/timeoff/requests/${big.id}/approve`, { ...as(mgr), body: {} });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('no longer fit');
    await ok('POST', `/timeoff/requests/${big.id}/reject`, { ...as(mgr), body: { comment: 'Not enough days' } }, 200);
    await ok('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: NEXT, days: 10, kind: 'correction', reason: 'Undo' } });
  });

  it('"Approve selected" names the ones that failed', async () => {
    const a = await submit(emp, { type: 'unpaid_leave', startDate: d('10-04'), endDate: d('10-05') });
    const b = await submit(peer, { type: 'unpaid_leave', startDate: d('10-11'), endDate: d('10-12') });
    const res = await ok('POST', '/timeoff/approvals/approve', { ...as(mgr), body: { ids: [a.id, b.id, '00000000-0000-0000-0000-000000000000'] } }, 200);
    expect(res.approved.sort()).toEqual([a.id, b.id].sort());
    expect(res.failed).toHaveLength(1);
  });
});

describe('cancel and shorten (spec 9.4, AC 9.6.3, 9.6.4)', () => {
  it('the employee cancels approved leave before it starts; the days go back; the approver is emailed', async () => {
    const [approved] = await ok('GET', `/timeoff/requests?employeeId=${id.emp}&status=approved&type=vacation`, as(emp));
    const c = await ok('POST', `/timeoff/requests/${approved.id}/cancel`, { ...as(emp), body: {} }, 200);
    expect(c).toMatchObject({ status: 'cancelled', decidedBy: { userId: emp.userId } });
    expect(c.days.every((x: { state: string }) => x.state === 'cancelled')).toBe(true);
    expect((await ok('GET', `/timeoff/employees/${id.emp}/balance?year=${NEXT}`, as(emp))).figures.scheduled).toBe(0);
    const mail = await eventually(async () => (await mailsAbout(mgr.email, 'Time off cancelled')).find((m) => m.text.includes('cancelled')) ?? null, 'the cancelled email to the approver');
    expect(mail.text).toContain("'s vacation");
    expect((await call('POST', `/timeoff/requests/${approved.id}/cancel`, { ...as(emp), body: {} })).status).toBe(409);
  });

  it('the approver and Admins cancel with a comment; a peer can’t', async () => {
    const r = await ok('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: id.emp, type: 'vacation', startDate: d('08-02'), endDate: d('08-04'), record: { reason: 'Agreed' } } });
    expect((await call('POST', `/timeoff/requests/${r.id}/cancel`, { ...as(peer), body: { comment: 'x' } })).status).toBe(404);
    expect((await call('POST', `/timeoff/requests/${r.id}/cancel`, { ...as(mgr), body: {} })).status).toBe(400);
    const c = await ok('POST', `/timeoff/requests/${r.id}/cancel`, { ...as(mgr), body: { comment: 'Project launch moved' } }, 200);
    expect(c).toMatchObject({ status: 'cancelled', decisionComment: 'Project launch moved' });
    const mail = await eventually(async () => (await mailsAbout(emp.email, 'Time off cancelled'))[0] ?? null, 'the cancelled email to the employee');
    expect(mail.text).toContain('- Comment: Project launch moved');
  });

  it('leave that started is shortened by the approver with a comment, never cancelled; the days after go back', async () => {
    const r = await ok('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: id.emp, type: 'vacation', startDate: plus(-1), endDate: plus(9), record: { reason: 'Already away' } } });
    expect((await call('POST', `/timeoff/requests/${r.id}/cancel`, { ...as(mgr), body: { comment: 'x' } })).status).toBe(409);
    expect((await call('POST', `/timeoff/requests/${r.id}/shorten`, { ...as(emp), body: { endDate: plus(3), comment: 'x' } })).status).toBe(403);
    expect((await call('POST', `/timeoff/requests/${r.id}/shorten`, { ...as(mgr), body: { endDate: plus(12), comment: 'x' } })).status).toBe(400);
    expect((await call('POST', `/timeoff/requests/${r.id}/shorten`, { ...as(mgr), body: { endDate: plus(-2), comment: 'x' } })).status).toBe(400);
    const s = await ok('POST', `/timeoff/requests/${r.id}/shorten`, { ...as(mgr), body: { endDate: plus(3), comment: 'Back early' } }, 200);
    expect(s).toMatchObject({ status: 'approved', endDate: plus(3), decisionComment: 'Back early' });
    expect(s.workingDays).toBeLessThan(r.workingDays);
    expect(s.days.filter((x: { date: string; state: string }) => x.date > plus(3)).every((x: { state: string }) => x.state === 'returned')).toBe(true);
    expect(s.days.filter((x: { date: string }) => x.date <= plus(3)).every((x: { state: string }) => x.state === 'counted')).toBe(true);
    const mail = await eventually(async () => (await mailsAbout(emp.email, 'Time off shortened'))[0] ?? null, 'the shortened email');
    expect(mail.text).toContain('it now ends on');
    // The manager counts as absent today? No: emp is the one away. Their own request on an away day still goes to the manager.
    expect((await ok('GET', `/timeoff/requests/${r.id}`, as(emp))).history.length).toBeGreaterThan(0);
  });
});

describe('the team calendar (spec 9.5, AC 9.6.6)', () => {
  it('employees see themselves, managers their reports, Admins everyone with filters', async () => {
    const month = `${YEAR}-${today().slice(5, 7)}`;
    const mine = await ok('GET', `/timeoff/calendar?month=${month}`, as(emp));
    expect(mine.employees.map((e: { id: string }) => e.id)).toEqual([id.emp]);
    expect(mine.cells.some((c: { employeeId: string; status: string }) => c.employeeId === id.emp && c.status === 'approved')).toBe(true);
    expect(mine.holidays).toBeInstanceOf(Array);
    const team = await ok('GET', `/timeoff/calendar?month=${month}`, as(mgr));
    expect(team.employees.map((e: { id: string }) => e.id).sort()).toEqual([id.mgr, id.emp, id.peer].sort());
    const all = await ok('GET', `/timeoff/calendar?month=${month}`, as(owner));
    expect(all.employees.length).toBeGreaterThanOrEqual(5);
    expect((await ok('GET', `/timeoff/calendar?month=${month}&managerId=${id.mgr}`, as(owner))).employees.map((e: { id: string }) => e.id).sort()).toEqual([id.emp, id.peer].sort());
    expect((await call('GET', '/timeoff/calendar?month=2026-13', as(owner))).status).toBe(400);
  });
});

describe('an absent manager and the reminders (spec 9.1, 15.2)', () => {
  it('while the manager is away the request goes to the Admins, who get the daily notice once', async () => {
    const { date: day } = weekdayAfter(20); // a one-day vacation needs a working day (20 days from a Sunday is a Saturday)
    await ok('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: id.mgr, type: 'vacation', startDate: day, endDate: day, record: { reason: 'Away' } } });
    const r = await submit(other, { type: 'unpaid_leave', startDate: d('11-01'), endDate: d('11-02') });
    expect(r.approver.kind).toBe('admins');
    const p = await submit(peer, { type: 'unpaid_leave', startDate: d('11-08'), endDate: d('11-09') });
    expect(p.approver.kind).toBe('manager');
    const run = await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${day}T06:00:00Z` } }, 200);
    expect(run.absent).toBeGreaterThanOrEqual(1);
    expect((await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${day}T07:00:00Z` } }, 200)).absent).toBe(0);
    const mail = await eventually(async () => (await mailsAbout(owner.email, '1 time off request waiting while'))[0] ?? null, 'the manager-absent email');
    expect(mail.text).toContain('is away');
    await ok('POST', `/timeoff/requests/${p.id}/withdraw`, as(peer), 200);
    await ok('POST', `/timeoff/requests/${r.id}/withdraw`, as(other), 200);
  });

  it('"Request waiting" goes to the approver once a day for requests starting within three working days', async () => {
    const { date, n } = weekdayAfter(30);
    const soon = await submit(peer, { type: 'unpaid_leave', startDate: date, endDate: date });
    const now = new Date(Date.parse(`${plus(n - 2)}T06:00:00Z`)).toISOString();
    const run = await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now } }, 200);
    expect(run.approvals).toBeGreaterThanOrEqual(1);
    expect((await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now } }, 200)).approvals).toBe(0);
    const mail = await eventually(async () => (await mailsAbout(mgr.email, '1 time off request waiting for you'))[0] ?? null, 'the reminder');
    expect(mail.text).toContain('unpaid leave');
    // With the toggle off the next day's reminder is queued but not sent; back on, the day after's arrives.
    await ok('PATCH', '/profile', { ...as(mgr), body: { notifyTimeoffApprovals: false } }, 200);
    expect((await ok('GET', '/profile', as(mgr))).notifyTimeoffApprovals).toBe(false);
    expect((await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${plus(n - 1)}T06:00:00Z` } }, 200)).approvals).toBeGreaterThanOrEqual(1);
    // The toggle is read when the email is sent: wait for a later email on the same queue before turning it on.
    const marker = await submit(peer, { type: 'unpaid_leave', startDate: d('10-05'), endDate: d('10-05') });
    await ok('POST', `/timeoff/requests/${marker.id}/reject`, { ...as(mgr), body: { comment: 'Queue marker' } }, 200);
    await eventually(async () => (await mailsAbout(peer.email, 'Time off rejected')).find((m) => m.text.includes('Queue marker')) ?? null, 'the marker email');
    await ok('PATCH', '/profile', { ...as(mgr), body: { notifyTimeoffApprovals: true } }, 200);
    expect((await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${date}T06:00:00Z` } }, 200)).approvals).toBeGreaterThanOrEqual(1);
    await eventually(async () => ((await mailsAbout(mgr.email, '1 time off request waiting for you')).length >= 2 ? true : null), 'the second reminder');
    expect(await mailsAbout(mgr.email, '1 time off request waiting for you')).toHaveLength(2);
    await ok('POST', `/timeoff/requests/${soon.id}/withdraw`, as(peer), 200);
  });
});

describe('tenant isolation', () => {
  it('another workspace sees none of it', async () => {
    const r = await submit(emp, { startDate: d('12-13'), endDate: d('12-14') });
    const elsewhere = { token: other.token, tenant: otherTenant };
    for (const action of ['approve', 'reject', 'cancel'] as const) expect((await call('POST', `/timeoff/requests/${r.id}/${action}`, { ...elsewhere, body: { comment: 'No' } })).status).toBe(404);
    expect((await call('POST', `/timeoff/requests/${r.id}/shorten`, { ...elsewhere, body: { endDate: d('12-13'), comment: 'No' } })).status).toBe(404);
    expect((await ok('POST', '/timeoff/approvals/approve', { ...elsewhere, body: { ids: [r.id] } }, 200)).failed).toHaveLength(1);
    expect(await ok('GET', '/timeoff/approvals', elsewhere)).toEqual([]);
    expect((await ok('GET', '/timeoff/approvals/count', elsewhere)).pending).toBe(0);
    expect((await ok('GET', `/timeoff/calendar?month=${NEXT}-12`, elsewhere)).employees.every((e: { id: string }) => e.id !== id.emp)).toBe(true);
    await ok('POST', `/timeoff/requests/${r.id}/withdraw`, as(emp), 200);
  });
});
