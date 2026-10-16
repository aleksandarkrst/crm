/**
 * Time off requests (CD-165, spec 8.8): the Serbian holiday preload and the working-day count,
 * the paid leave and other absence reasons (Admins), submitting vacation, paid and unpaid leave,
 * the refusals (no working days, past dates, the first month of work, overlap, more days than
 * available, concurrent requests), the preview with the balance before and after and the
 * approver, Admins requesting and recording for others, withdrawing, the "Time off requested"
 * email, the balance feed (pending and approved days) and tenant isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, mailTo, ok, type Session, signIn } from './helpers';
import { joinAsEmployee, START } from './people-helpers';

let owner: Session;
let mgr: Session;
let emp: Session;
let peer: Session;
let otherOwner: Session;
let tenant: string;
let otherTenant: string;
const id = {} as Record<'owner' | 'mgr' | 'emp' | 'peer', string>;
const as = (s: Session) => ({ token: s.token, tenant });
const YEAR = new Date().getUTCFullYear();
/** Next year, so the dates are always in the future (employees request up to the end of next year). */
const NEXT = YEAR + 1;
const d = (md: string, year = NEXT) => `${year}-${md}`;

let marriage: { id: string };
let donation: { id: string };

/** The first weekday on or after `date` that isn't a holiday, as a safe anchor. */
beforeAll(async () => {
  [owner, mgr, emp, peer, otherOwner] = (await Promise.all(['rq-owner', 'rq-mgr', 'rq-emp', 'rq-peer', 'rq-other'].map((l) => signIn(l)))) as [Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Time off requests');
  otherTenant = await createTenant(otherOwner, 'Requests elsewhere');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  for (const [key, s] of [['mgr', mgr], ['emp', emp], ['peer', peer]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  await ok('PATCH', `/people/employees/${id.emp}`, { ...as(owner), body: { managerId: id.mgr, employmentStartDate: START } }, 200);
  await ok('PATCH', `/people/employees/${id.mgr}`, { ...as(owner), body: { employmentStartDate: START } }, 200);
  await ok('PATCH', `/people/employees/${id.owner}`, { ...as(owner), body: { employmentStartDate: START } }, 200);
  const reasons = await ok('GET', '/timeoff/reasons', as(emp));
  marriage = reasons.find((r: { name: string }) => r.name === 'Marriage');
  donation = reasons.find((r: { name: string }) => r.name === 'Blood donation');
});

describe('the holiday calendar (spec 4.3, 4.5)', () => {
  it('a new workspace has Serbia’s days for this year and the next, Easter and moved days included', async () => {
    const state = await ok('GET', '/timesheet/holidays/preload', as(emp));
    expect(state).toMatchObject({ country: 'serbia', years: [YEAR, NEXT] });
    const next = await ok('GET', `/timesheet/holidays?year=${NEXT}`, as(emp));
    const names = next.map((h: { name: string }) => h.name);
    expect(names).toContain('Nova godina (New Year)');
    // Easter Sunday itself is skipped when it falls on a day that is already a holiday (2 May 2027); Good Friday always shows.
    expect(names).toContain('Veliki petak (Orthodox Good Friday)');
    expect(next.find((h: { name: string }) => h.name.startsWith('Veliki petak'))).toMatchObject({ repeats: false, source: 'preload' });
    expect(next.find((h: { name: string }) => h.name.startsWith('Nova godina'))).toMatchObject({ date: d('01-01'), endDate: d('01-02'), repeats: true });
  });

  it('a year is generated once: a deleted preloaded day stays deleted; members can’t change the setting', async () => {
    const next = await ok('GET', `/timesheet/holidays?year=${NEXT}`, as(owner));
    const easter = next.find((h: { name: string }) => h.name.startsWith('Veliki petak'));
    await ok('DELETE', `/timesheet/holidays/${easter.id}`, as(owner));
    const again = await ok('POST', '/timesheet/holidays/preload', { ...as(owner), body: { country: 'serbia', year: NEXT } }, 200);
    expect(again.added).toBe(0);
    expect((await ok('GET', `/timesheet/holidays?year=${NEXT}`, as(owner))).some((h: { id: string }) => h.id === easter.id)).toBe(false);
    expect((await call('POST', '/timesheet/holidays/preload', { ...as(emp), body: { country: 'none' } })).status).toBe(403);
    // A year not generated yet gets its days.
    const later = await ok('POST', '/timesheet/holidays/preload', { ...as(owner), body: { country: 'serbia', year: NEXT + 2 } }, 200);
    expect(later.added).toBeGreaterThanOrEqual(3);
    expect(later.years).toContain(NEXT + 2);
  });
});

describe('reasons and the yearly limit (spec 7.2, 7.3, AC 7.4.3)', () => {
  it('the defaults are there; Admins change them; a used reason can only be deactivated', async () => {
    const reasons = await ok('GET', '/timeoff/reasons', as(emp));
    expect(reasons.filter((r: { kind: string }) => r.kind === 'paid_leave').map((r: { name: string }) => r.name)).toContain('Blood donation');
    expect(reasons.filter((r: { kind: string }) => r.kind === 'other_absence')).toHaveLength(5);
    expect(marriage).toMatchObject({ maxDays: 5, countsTowardLimit: true, active: true, used: 0 });
    expect((await ok('GET', '/timeoff/settings', as(emp))).paidLeaveYearlyLimit).toBe(5);
    expect((await call('POST', '/timeoff/reasons', { ...as(emp), body: { kind: 'paid_leave', name: 'Moving house' } })).status).toBe(403);
    const moving = await ok('POST', '/timeoff/reasons', { ...as(owner), body: { kind: 'paid_leave', name: 'Moving house', maxDays: 2 } });
    expect(moving).toMatchObject({ name: 'Moving house', maxDays: 2, countsTowardLimit: false });
    expect((await call('POST', '/timeoff/reasons', { ...as(owner), body: { kind: 'paid_leave', name: ' moving house ' } })).status).toBe(409);
    expect((await ok('PATCH', `/timeoff/reasons/${moving.id}`, { ...as(owner), body: { active: false } }, 200)).active).toBe(false);
    await ok('DELETE', `/timeoff/reasons/${moving.id}`, as(owner));
    expect((await ok('PATCH', '/timeoff/settings', { ...as(owner), body: { paidLeaveYearlyLimit: 6 } }, 200)).paidLeaveYearlyLimit).toBe(6);
    await ok('PATCH', '/timeoff/settings', { ...as(owner), body: { paidLeaveYearlyLimit: 5 } }, 200);
  });
});

describe('submitting (spec 8.3, AC 8.8)', () => {
  it('the preview counts working days without holidays, shows the balance before and after and names the approver', async () => {
    // 27 April to 8 May next year: the weekdays minus the Labour Day, Easter and moved days that fall on weekdays.
    const p = await ok('POST', '/timeoff/requests/preview', { ...as(emp), body: { type: 'vacation', startDate: d('04-27'), endDate: d('05-08') } }, 200);
    expect(p.workingDays).toBe(p.dates.length);
    expect(p.workingDays).toBeLessThan(10);
    expect(p.excluded.length).toBeGreaterThanOrEqual(1);
    expect(p.refusal).toBeNull();
    expect(p.balance.before.year).toBe(NEXT);
    expect(p.balance.after.pending).toBe(p.balance.before.pending + p.workingDays);
    expect(p.approver).toMatchObject({ kind: 'manager', approvers: [{ employeeId: id.mgr }] });
  });

  it('refuses dates without working days, past dates, the first month of work and more days than available', async () => {
    // 1 and 2 January are holidays, and the weekend around them: no working day whichever weekday they fall on.
    const noDays = await call('POST', '/timeoff/requests', { ...as(emp), body: { type: 'vacation', startDate: d('01-01'), endDate: d('01-02') } });
    expect(noDays.status).toBe(400);
    expect(noDays.body.message).toContain('no working days');
    expect((await call('POST', '/timeoff/requests', { ...as(emp), body: { type: 'vacation', startDate: `${YEAR - 1}-06-01`, endDate: `${YEAR - 1}-06-02` } })).status).toBe(400);
    // peer starts next month: vacation in the first month is refused for them, not for an Admin recording it.
    await ok('PATCH', `/people/employees/${id.peer}`, { ...as(owner), body: { employmentStartDate: d('03-01') } }, 200);
    const early = await call('POST', '/timeoff/requests', { ...as(peer), body: { type: 'vacation', startDate: d('03-15'), endDate: d('03-16') } });
    expect(early.status).toBe(400);
    expect(early.body.message).toContain('one month');
    // 30 working days is more than the 20 of next year's pool.
    const tooMany = await call('POST', '/timeoff/requests', { ...as(emp), body: { type: 'vacation', startDate: d('09-01'), endDate: d('10-15') } });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.message).toContain('available');
  });

  it('submits vacation: pending, days charged to the pool, the balance’s pending goes up, the approver is emailed', async () => {
    const before = (await mailTo(owner, mgr.email)).filter((m) => m.subject.startsWith('Time off requested')).length;
    const r = await ok('POST', '/timeoff/requests', { ...as(emp), body: { type: 'vacation', startDate: d('06-07'), endDate: d('06-11'), note: 'Seaside' } });
    expect(r).toMatchObject({ status: 'pending', type: 'vacation', employee: { id: id.emp }, note: 'Seaside', recorded: false, canWithdraw: true, approver: { kind: 'manager' } });
    expect(r.workingDays).toBeGreaterThanOrEqual(4);
    expect(r.days.every((x: { poolYear: number; state: string }) => x.poolYear === NEXT && x.state === 'counted')).toBe(true);
    const b = await ok('GET', `/timeoff/employees/${id.emp}/balance?year=${NEXT}`, as(emp));
    expect(b.figures.pending).toBe(r.workingDays);
    expect(b.figures.available).toBe(b.figures.remaining - r.workingDays);
    const mail = await eventually(async () => {
      const mails = (await mailTo(owner, mgr.email)).filter((m) => m.subject.startsWith('Time off requested'));
      return mails.length > before ? mails[0] : null;
    }, 'the "Time off requested" email');
    expect(mail.text).toContain('requested vacation');
    expect(mail.text).toContain('Note: Seaside');
  });

  it('a second request can’t overlap a pending one; the employee withdraws it and the days are released', async () => {
    const overlap = await call('POST', '/timeoff/requests', { ...as(emp), body: { type: 'unpaid_leave', startDate: d('06-10'), endDate: d('06-12') } });
    expect(overlap.status).toBe(409);
    const mine = await ok('GET', `/timeoff/requests?year=${NEXT}`, as(emp));
    const pending = mine.find((x: { status: string }) => x.status === 'pending');
    expect((await call('POST', `/timeoff/requests/${pending.id}/withdraw`, as(peer))).status).toBe(404);
    const w = await ok('POST', `/timeoff/requests/${pending.id}/withdraw`, as(emp), 200);
    expect(w).toMatchObject({ status: 'withdrawn', canWithdraw: false });
    expect(w.days.every((x: { state: string }) => x.state === 'cancelled')).toBe(true);
    expect((await ok('GET', `/timeoff/employees/${id.emp}/balance?year=${NEXT}`, as(emp))).figures.pending).toBe(0);
    expect((await call('POST', `/timeoff/requests/${pending.id}/withdraw`, as(emp))).status).toBe(409);
    const detail = await ok('GET', `/timeoff/requests/${pending.id}`, as(emp));
    expect(detail.history.map((h: { field: string | null }) => h.field)).toContain('status');
  });

  it('paid leave needs a reason and warns over its limits; unpaid leave touches no balance', async () => {
    expect((await call('POST', '/timeoff/requests', { ...as(emp), body: { type: 'paid_leave', startDate: d('07-05'), endDate: d('07-06') } })).status).toBe(400);
    const p = await ok('POST', '/timeoff/requests/preview', { ...as(emp), body: { type: 'paid_leave', reasonId: donation.id, startDate: d('07-05'), endDate: d('07-09') } }, 200);
    expect(p.warnings.some((w: string) => w.startsWith('Exceeds the limit of 2 days'))).toBe(true);
    expect(p.balance).toBeNull();
    const r = await ok('POST', '/timeoff/requests', { ...as(emp), body: { type: 'paid_leave', reasonId: marriage.id, startDate: d('08-02'), endDate: d('08-04') } });
    expect(r).toMatchObject({ type: 'paid_leave', reason: { name: 'Marriage' }, status: 'pending', warnings: [] });
    const u = await ok('POST', '/timeoff/requests', { ...as(emp), body: { type: 'unpaid_leave', startDate: d('08-09'), endDate: d('08-10') } });
    expect(u.days.every((x: { poolYear: number | null }) => x.poolYear === null)).toBe(true);
    expect((await ok('GET', `/timeoff/employees/${id.emp}/balance?year=${NEXT}`, as(emp))).figures.pending).toBe(0);
    // The group limit across requests: 3 marriage days + 3 more of a counting reason = 6 > 5.
    const more = await ok('POST', '/timeoff/requests/preview', { ...as(emp), body: { type: 'paid_leave', reasonId: marriage.id, startDate: d('09-06'), endDate: d('09-08') } }, 200);
    expect(more.warnings.some((w: string) => w.startsWith('Exceeds the yearly limit of 5'))).toBe(true);
    expect((await call('DELETE', `/timeoff/reasons/${marriage.id}`, as(owner))).status).toBe(409);
  });

  it('Admins request for anyone and record leave as approved at once; other absences are theirs only', async () => {
    expect((await call('POST', '/timeoff/requests', { ...as(mgr), body: { employeeId: id.emp, type: 'vacation', startDate: d('10-04'), endDate: d('10-05') } })).status).toBe(403);
    expect((await call('POST', '/timeoff/requests', { ...as(emp), body: { type: 'other_absence', startDate: d('10-04'), endDate: d('10-05') } })).status).toBe(403);
    const recorded = await ok('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: id.emp, type: 'vacation', startDate: `${YEAR}-02-02`, endDate: `${YEAR}-02-03`, record: { reason: 'Agreed on paper' } } });
    expect(recorded).toMatchObject({ status: 'approved', recorded: true, recordReason: 'Agreed on paper', decidedBy: { userId: owner.userId }, approver: null, canWithdraw: false });
    const b = await ok('GET', `/timeoff/employees/${id.emp}/balance`, as(emp));
    expect(b.figures.used).toBe(recorded.workingDays);
    expect((await call('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: id.emp, type: 'vacation', startDate: d('10-04'), endDate: d('10-05'), record: { reason: '' } } })).status).toBe(400);
  });

  it('two requests at the same moment can’t both use the last days', async () => {
    // peer: next year's pool is proportional (starts 1 March next year: 10 months = 17 days); take 16 first, then race for the last.
    await ok('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: id.peer, type: 'vacation', startDate: d('06-01'), endDate: d('06-22'), record: { reason: 'Planned' } } });
    const left = (await ok('GET', `/timeoff/employees/${id.peer}/balance?year=${NEXT}`, as(owner))).figures.available;
    expect(left).toBeGreaterThanOrEqual(1);
    const bodies = [{ startDate: d('11-02'), endDate: d('11-02') }, { startDate: d('11-16'), endDate: d('11-16') }, { startDate: d('11-23'), endDate: d('11-23') }];
    const results = await Promise.all(bodies.map((b) => call('POST', '/timeoff/requests', { ...as(owner), body: { employeeId: id.peer, type: 'vacation', ...b, record: { reason: 'race' } } })));
    const okCount = results.filter((r) => r.status === 201).length;
    expect(okCount).toBe(Math.min(left, 3));
    expect(results.filter((r) => r.status === 409)).toHaveLength(3 - okCount);
  });

  it('who sees whose requests', async () => {
    expect((await ok('GET', `/timeoff/requests?employeeId=${id.emp}`, as(mgr))).length).toBeGreaterThan(0);
    expect((await call('GET', `/timeoff/requests?employeeId=${id.emp}`, as(peer))).status).toBe(403);
    expect((await call('GET', '/timeoff/requests?all=true', as(emp))).status).toBe(403);
    const team = await ok('GET', '/timeoff/requests?all=true', as(mgr));
    expect(team.every((r: { employee: { id: string } }) => [id.emp, id.mgr].includes(r.employee.id))).toBe(true);
    expect((await ok('GET', '/timeoff/requests?all=true', as(owner))).some((r: { employee: { id: string } }) => r.employee.id === id.peer)).toBe(true);
  });
});

describe('tenant isolation', () => {
  it('another workspace sees none of it', async () => {
    const other = { token: otherOwner.token, tenant: otherTenant };
    const mine = await ok('GET', `/timeoff/requests?year=${NEXT}`, as(emp));
    expect((await call('GET', `/timeoff/requests/${mine[0].id}`, other)).status).toBe(404);
    expect((await call('POST', `/timeoff/requests/${mine[0].id}/withdraw`, other)).status).toBe(404);
    expect((await call('POST', '/timeoff/requests', { ...other, body: { employeeId: id.emp, type: 'vacation', startDate: d('12-01'), endDate: d('12-02') } })).status).toBe(404);
    expect((await call('PATCH', `/timeoff/reasons/${marriage.id}`, { ...other, body: { active: false } })).status).toBe(404);
  });
});
