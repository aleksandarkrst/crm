/**
 * Sick leave (CD-169, spec 13): types; reporting by the employee, the direct manager and Admins
 * (and what each may set); no medical fields; visibility per role (13.6); confirming; overlap
 * refused; approved time off interrupted and restored on cancel, with its email; open records
 * extended by the daily job; day 31 across continuations and the suggestion; the team calendar and
 * the absent manager; the weekly check; the emails; another workspace.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, mailTo, ok, type Session, signIn } from './helpers';
import { joinAsEmployee, START } from './people-helpers';

let owner: Session;
let mgr: Session;
let emp: Session;
let peer: Session;
let other: Session;
let boss: Session;
let tenant: string;
let otherTenant: string;
const id = {} as Record<'owner' | 'mgr' | 'emp' | 'peer' | 'boss', string>;
const as = (s: Session) => ({ token: s.token, tenant });
const NEXT = new Date().getUTCFullYear() + 1;
const d = (md: string) => `${NEXT}-${md}`;
const plus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const weekday = (date: string) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
/** The first Monday to Friday on or after `date`. */
const weekdayFrom = (date: string) => {
  let x = date;
  while (!weekday(x)) x = addDays(x, 1);
  return x;
};
const mailsAbout = async (to: string, subject: string) => (await mailTo(owner, to)).filter((m) => m.subject.startsWith(subject));

interface Sick {
  id: string;
  status: string;
  startDate: string;
  endDate: string | null;
  type: { id: string; name: string } | null;
  note: string | null;
  sickNoteRef: string | null;
  calendarDays: number;
  day31: string | null;
  suggestedContinuationId: string | null;
  interruptedDays: number;
  canSetEnd: boolean;
  canConfirm: boolean;
}
interface SickType {
  id: string;
  name: string;
  active: boolean;
  used: number;
}
let types: SickType[];
const report = (s: Session, body: Record<string, unknown>) => ok<Sick>('POST', '/timeoff/sick-leave', { ...as(s), body });
const vacation = async (s: Session, startDate: string, endDate: string) => {
  const r = await ok<{ id: string; workingDays: number }>('POST', '/timeoff/requests', { ...as(s), body: { type: 'vacation', startDate, endDate } });
  await ok('POST', `/timeoff/requests/${r.id}/approve`, { ...as(mgr), body: {} }, 200);
  return r;
};
const request = (rid: string) => ok<{ workingDays: number; days: { date: string; state: string }[] }>('GET', `/timeoff/requests/${rid}`, as(owner));

beforeAll(async () => {
  [owner, mgr, emp, peer, other, boss] = (await Promise.all(['sick-owner', 'sick-mgr', 'sick-emp', 'sick-peer', 'sick-other', 'sick-boss'].map((l) => signIn(l)))) as [Session, Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Sick leave');
  otherTenant = await createTenant(other, 'Sick leave elsewhere');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  for (const [key, s] of [['mgr', mgr], ['emp', emp], ['peer', peer], ['boss', boss]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  // boss manages mgr: an indirect manager of emp and peer.
  await ok('PATCH', `/people/employees/${id.mgr}`, { ...as(owner), body: { managerId: id.boss } }, 200);
  for (const key of ['mgr', 'emp', 'peer', 'owner'] as const) await ok('PATCH', `/people/employees/${id[key]}`, { ...as(owner), body: { employmentStartDate: START, ...(key === 'emp' || key === 'peer' ? { managerId: id.mgr } : {}) } }, 200);
  types = await ok<SickType[]>('GET', '/timeoff/sick-leave-types', as(emp));
});

describe('types (spec 13.3)', () => {
  it('a new workspace has the defaults; Admins add, rename and deactivate; members can\'t', async () => {
    expect(types.map((t) => t.name)).toEqual(['Illness or injury outside work', 'Injury at work or occupational disease', 'Pregnancy related', 'Care of a family member', 'Other legal ground']);
    expect((await call('POST', '/timeoff/sick-leave-types', { ...as(emp), body: { name: 'Mine' } })).status).toBe(403);
    const added = await ok<SickType>('POST', '/timeoff/sick-leave-types', { ...as(owner), body: { name: 'Quarantine', payerNote: 'RFZO' } });
    expect((await ok<SickType>('PATCH', `/timeoff/sick-leave-types/${added.id}`, { ...as(owner), body: { active: false } })).active).toBe(false);
    expect((await call('POST', '/timeoff/sick-leave-types', { ...as(owner), body: { name: 'quarantine' } })).status).toBe(409);
    await ok('DELETE', `/timeoff/sick-leave-types/${added.id}`, as(owner));
  });
});

describe('reporting and visibility (spec 13.2, 13.4, 13.6)', () => {
  let mine: Sick;

  it('the employee reports their own; no medical fields; Admin-only fields refused; 60 days back at most', async () => {
    expect((await call('POST', '/timeoff/sick-leave', { ...as(emp), body: { startDate: plus(-2), diagnosis: 'Flu' } })).status).toBe(400);
    expect((await call('POST', '/timeoff/sick-leave', { ...as(emp), body: { startDate: plus(-2), typeId: types[0]!.id } })).status).toBe(403);
    expect((await call('POST', '/timeoff/sick-leave', { ...as(emp), body: { startDate: plus(-70) } })).status).toBe(400);
    mine = await report(emp, { startDate: d('02-02'), endDate: d('02-04') });
    expect(mine).toMatchObject({ status: 'reported', type: null, calendarDays: 3, canSetEnd: true, canConfirm: false });
    expect((await call('POST', '/timeoff/sick-leave', { ...as(mgr), body: { employeeId: id.emp, startDate: d('02-04') } })).status).toBe(409);
    for (const to of [mgr.email, owner.email]) await eventually(async () => (await mailsAbout(to, 'Sick leave reported: Sick-emp Tester'))[0] ?? null, `the reported email to ${to}`);
    expect(await mailsAbout(emp.email, 'Sick leave reported')).toEqual([]);
  });

  it('a manager reports for a direct report, not for others; a peer sees nothing', async () => {
    const r = await report(mgr, { employeeId: id.peer, startDate: plus(-5), endDate: plus(-5) });
    expect(r.status).toBe('reported');
    expect((await call('POST', '/timeoff/sick-leave', { ...as(mgr), body: { employeeId: id.owner, startDate: plus(-5) } })).status).toBe(404);
    expect((await call('GET', `/timeoff/sick-leave/${mine.id}`, as(peer))).status).toBe(404);
    expect((await call('GET', '/timeoff/sick-leave?all=true', as(emp))).status).toBe(403);
  });

  it('Admins confirm with the type; the employee sees the type, the manager doesn\'t; note and reference are Admins\' only', async () => {
    expect((await call('POST', `/timeoff/sick-leave/${mine.id}/confirm`, { ...as(mgr), body: { typeId: types[0]!.id } })).status).toBe(403);
    const confirmed = await ok<Sick>('POST', `/timeoff/sick-leave/${mine.id}/confirm`, { ...as(owner), body: { typeId: types[0]!.id, sickNoteRef: 'EB-2027-123' } }, 200);
    expect(confirmed).toMatchObject({ status: 'confirmed', type: { name: 'Illness or injury outside work' }, sickNoteRef: 'EB-2027-123' });
    await ok('PATCH', `/timeoff/sick-leave/${mine.id}`, { ...as(owner), body: { note: 'Sick note arrived by post' } });
    const own = await ok<Sick>('GET', `/timeoff/sick-leave/${mine.id}`, as(emp));
    expect(own).toMatchObject({ type: { name: 'Illness or injury outside work' }, note: null, sickNoteRef: null, canSetEnd: false });
    const team = await ok<Sick[]>('GET', '/timeoff/sick-leave?all=true', as(mgr));
    expect(team.find((r) => r.id === mine.id)).toMatchObject({ type: null, note: null, sickNoteRef: null });
    expect((await ok<Sick>('GET', `/timeoff/sick-leave/${mine.id}`, as(owner))).note).toBe('Sick note arrived by post');
    // The end date of a confirmed record is the Admins'.
    expect((await call('PATCH', `/timeoff/sick-leave/${mine.id}`, { ...as(emp), body: { endDate: d('02-05') } })).status).toBe(403);
    expect((await call('PATCH', `/timeoff/sick-leave/${mine.id}`, { ...as(emp), body: { note: 'x' } })).status).toBe(403);
    // A used type can't be deleted.
    expect((await call('DELETE', `/timeoff/sick-leave-types/${types[0]!.id}`, as(owner))).status).toBe(409);
  });
});

describe('time off interrupted (spec 13.4, A9)', () => {
  it('approved vacation inside the period is interrupted and emailed; cancelling restores the days still ahead', async () => {
    const v = await vacation(emp, d('03-01'), d('03-12'));
    const before = (await request(v.id)).workingDays;
    const sick = await report(owner, { employeeId: id.emp, startDate: d('03-09'), endDate: d('03-12'), typeId: types[0]!.id, confirm: true });
    expect(sick.status).toBe('confirmed');
    const after = await request(v.id);
    expect(after.workingDays).toBe(before - 4);
    expect(after.days.filter((x) => x.state === 'interrupted').map((x) => x.date)).toEqual([d('03-09'), d('03-10'), d('03-11'), d('03-12')].filter(weekday));
    expect((await ok<Sick>('GET', `/timeoff/sick-leave/${sick.id}`, as(owner))).interruptedDays).toBe(after.days.filter((x) => x.state === 'interrupted').length);
    for (const to of [emp.email, mgr.email, owner.email]) await eventually(async () => (await mailsAbout(to, 'Time off interrupted by sick leave'))[0] ?? null, `the interrupted email to ${to}`);
    expect((await call('POST', `/timeoff/sick-leave/${sick.id}/cancel`, { ...as(mgr), body: { reason: 'Wrong person' } })).status).toBe(403);
    const cancelled = await ok<Sick & { notRestored: number }>('POST', `/timeoff/sick-leave/${sick.id}/cancel`, { ...as(owner), body: { reason: 'Entered for the wrong person' } }, 200);
    expect(cancelled).toMatchObject({ status: 'cancelled', notRestored: 0 });
    expect((await request(v.id)).workingDays).toBe(before);
    await ok('POST', `/timeoff/requests/${v.id}/cancel`, { ...as(emp), body: {} }, 200);
  });

  it('an open record extends day by day with the daily job; setting the end date emails the manager', async () => {
    const start = weekdayFrom(plus(1));
    const vacDay = weekdayFrom(addDays(start, 1));
    const v = await vacation(peer, vacDay, vacDay);
    const sick = await report(peer, { startDate: start });
    expect(sick.endDate).toBeNull();
    // Today the record hasn't reached the vacation day yet.
    expect((await request(v.id)).workingDays).toBe(1);
    const run = await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${vacDay}T06:00:00Z` } }, 200);
    expect(run.sick).toBeGreaterThanOrEqual(1);
    expect((await request(v.id)).workingDays).toBe(0);
    const ended = await ok<Sick>('PATCH', `/timeoff/sick-leave/${sick.id}`, { ...as(peer), body: { endDate: start } });
    expect(ended.endDate).toBe(start);
    // Shortened before the vacation day: the day still ahead is back.
    expect((await request(v.id)).workingDays).toBe(1);
    await eventually(async () => (await mailsAbout(mgr.email, 'Sick leave ended: Sick-peer Tester'))[0] ?? null, 'the ended email');
    await ok('POST', `/timeoff/requests/${v.id}/cancel`, { ...as(peer), body: {} }, 200);
  });
});

describe('day 31 and continuations (spec 13.2, 13.3)', () => {
  it('counts across the records a record continues; the next-day record is suggested', async () => {
    const a = await report(owner, { employeeId: id.owner, startDate: d('05-03'), endDate: d('05-22'), typeId: types[0]!.id, confirm: true });
    expect(a.day31).toBeNull();
    const b = await report(owner, { employeeId: id.owner, startDate: d('05-23'), endDate: d('06-30'), typeId: types[0]!.id, confirm: true });
    expect(b.suggestedContinuationId).toBe(a.id);
    expect(b.day31).toBe(d('06-22'));
    const linked = await ok<Sick>('PATCH', `/timeoff/sick-leave/${b.id}`, { ...as(owner), body: { continuationOfId: a.id } });
    expect(linked.day31).toBe(d('06-02'));
    expect((await call('PATCH', `/timeoff/sick-leave/${a.id}`, { ...as(owner), body: { continuationOfId: b.id } })).status).toBe(400);
  });
});

describe('the team calendar, the absent manager, the weekly check', () => {
  it('the calendar shows sick leave without its type; a manager on sick leave today hands requests to the Admins', async () => {
    const cal = await ok<{ cells: { employeeId: string; date: string; type: string }[] }>('GET', `/timeoff/calendar?month=${NEXT}-02`, as(mgr));
    expect(cal.cells.filter((c) => c.employeeId === id.emp && c.type === 'sick_leave').map((c) => c.date)).toEqual([d('02-02'), d('02-03'), d('02-04')]);
    const away = await report(mgr, { startDate: plus(0), endDate: plus(0) });
    const r = await ok<{ id: string; approver: { kind: string } }>('POST', '/timeoff/requests', { ...as(emp), body: { type: 'unpaid_leave', startDate: d('09-01'), endDate: d('09-01') } });
    expect(r.approver.kind).toBe('admins');
    await ok('POST', `/timeoff/requests/${r.id}/withdraw`, as(emp), 200);
    await ok('POST', `/timeoff/sick-leave/${away.id}/cancel`, { ...as(owner), body: { reason: 'Test' } }, 200);
  });

  it('on Mondays the Admins get the records to check, once', async () => {
    let monday = plus(1);
    while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
    const run = await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${monday}T06:00:00Z` } }, 200);
    expect(run.sickChecks).toBe(1);
    expect((await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${monday}T07:00:00Z` } }, 200)).sickChecks).toBe(0);
    const mail = await eventually(async () => (await mailsAbout(owner.email, 'Sick leave to check'))[0] ?? null, 'the weekly check');
    expect(mail.text).toContain('Sick-peer Tester');
    expect(mail.text).not.toContain('Illness');
  });
});

describe('permissions and the toggle (spec 13.4, 15.1, 15.2)', () => {
  it('only the employee and the direct manager report and set the end date; managers set nothing else', async () => {
    expect((await call('POST', '/timeoff/sick-leave', { ...as(boss), body: { employeeId: id.emp, startDate: plus(-40) } })).status).toBe(403);
    expect((await call('POST', '/timeoff/sick-leave', { ...as(mgr), body: { employeeId: id.emp, startDate: plus(-40), note: 'x' } })).status).toBe(403);
    expect((await call('POST', '/timeoff/sick-leave', { ...as(mgr), body: { employeeId: id.emp, startDate: plus(-40), confirm: true } })).status).toBe(403);
    const r = await report(emp, { startDate: plus(-40), endDate: plus(-39) });
    expect((await call('PATCH', `/timeoff/sick-leave/${r.id}`, { ...as(boss), body: { endDate: plus(-38) } })).status).toBe(403);
    expect((await call('PATCH', `/timeoff/sick-leave/${r.id}`, { ...as(mgr), body: { startDate: plus(-41) } })).status).toBe(403);
    expect((await call('PATCH', `/timeoff/sick-leave/${r.id}`, { ...as(emp), body: { endDate: null } })).status).toBe(403);
    expect((await ok<Sick>('PATCH', `/timeoff/sick-leave/${r.id}`, { ...as(mgr), body: { endDate: plus(-38) } })).endDate).toBe(plus(-38));
    expect((await call('GET', '/timeoff/sick-leave/csv?all=true', as(mgr))).status).toBe(403);
    expect((await call('PATCH', `/timeoff/sick-leave-types/${types[1]!.id}`, { ...as(mgr), body: { active: false } })).status).toBe(403);
    expect((await call('DELETE', `/timeoff/sick-leave-types/${types[1]!.id}`, as(mgr))).status).toBe(403);
    expect((await call('GET', '/timeoff/sick-leave/csv?all=true', as(owner))).status).toBe(200);
  });

  it('an inactive type is refused', async () => {
    const t = await ok<SickType>('POST', '/timeoff/sick-leave-types', { ...as(owner), body: { name: 'Retired type' } });
    await ok('PATCH', `/timeoff/sick-leave-types/${t.id}`, { ...as(owner), body: { active: false } });
    expect((await call('POST', '/timeoff/sick-leave', { ...as(owner), body: { employeeId: id.peer, startDate: d('10-04'), endDate: d('10-04'), typeId: t.id, confirm: true } })).status).toBe(400);
  });

  it('time off approved on days sick leave covers is interrupted at once', async () => {
    const sick = await report(owner, { employeeId: id.peer, startDate: d('11-02'), endDate: d('11-03'), typeId: types[0]!.id, confirm: true });
    const v = await vacation(peer, d('11-01'), d('11-05'));
    expect((await request(v.id)).days.filter((x) => x.state === 'interrupted').map((x) => x.date)).toEqual([d('11-02'), d('11-03')].filter(weekday));
    await ok('POST', `/timeoff/requests/${v.id}/cancel`, { ...as(peer), body: {} }, 200);
    await ok('POST', `/timeoff/sick-leave/${sick.id}/cancel`, { ...as(owner), body: { reason: 'Test' } }, 200);
  });

  it('with "Sick leave notices" off the manager gets no "reported" email; the Admins still do', async () => {
    await ok('PATCH', '/profile', { ...as(mgr), body: { notifySickLeave: false } }, 200);
    const day = plus(-50);
    const label = new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const r = await report(emp, { startDate: day, endDate: day });
    const subject = `Sick leave reported: Sick-emp Tester, ${label}`;
    await eventually(async () => (await mailsAbout(owner.email, subject))[0] ?? null, 'the Admins email');
    expect(await mailsAbout(mgr.email, subject)).toEqual([]);
    await ok('PATCH', '/profile', { ...as(mgr), body: { notifySickLeave: true } }, 200);
    await ok('POST', `/timeoff/sick-leave/${r.id}/cancel`, { ...as(owner), body: { reason: 'Test' } }, 200);
  });
});

describe('tenant isolation', () => {
  it('another workspace sees none of it', async () => {
    const [one] = await ok<Sick[]>('GET', '/timeoff/sick-leave?all=true', as(owner));
    const elsewhere = { token: other.token, tenant: otherTenant };
    expect((await call('GET', `/timeoff/sick-leave/${one!.id}`, elsewhere)).status).toBe(404);
    expect((await call('PATCH', `/timeoff/sick-leave/${one!.id}`, { ...elsewhere, body: { endDate: d('12-31') } })).status).toBe(404);
    expect((await call('POST', `/timeoff/sick-leave/${one!.id}/cancel`, { ...elsewhere, body: { reason: 'x' } })).status).toBe(404);
    expect((await call('POST', '/timeoff/sick-leave', { ...elsewhere, body: { employeeId: id.emp, startDate: d('12-01') } })).status).toBe(404);
    expect(await ok('GET', '/timeoff/sick-leave?all=true', elsewhere)).toEqual([]);
    expect((await call('PATCH', `/timeoff/sick-leave-types/${types[0]!.id}`, { ...elsewhere, body: { active: false } })).status).toBe(404);
  });
});
