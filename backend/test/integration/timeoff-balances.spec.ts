/**
 * The vacation balance (CD-164, spec 6.6): the figures and history through the API, who sees whose
 * balance (AC2), adjustments by Admins only with a reason, append-only, refused below zero, with
 * the "Balance adjusted" email and its toggle (AC3), the Balances table per role with filters and
 * CSV, the bulk actions, the daily job's 1 July expiry record and the May reminder, and tenant
 * isolation. Vacation days don't exist until CD-165, so used, scheduled and pending stay 0 here;
 * the pool rules are covered by test/timeoff-balance.spec.ts.
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
/** Whether last year's carry-over has expired by now (the figures depend on the real date). */
const AFTER_JUNE = new Date().toISOString().slice(5, 10) > '06-30';
let technicians: { id: string };

const balanceMails = async (to: string) => (await mailTo(owner, to)).filter((m) => m.subject.includes('vacation balance'));

beforeAll(async () => {
  [owner, mgr, emp, peer, otherOwner] = (await Promise.all(['bal-owner', 'bal-mgr', 'bal-emp', 'bal-peer', 'bal-other'].map((l) => signIn(l)))) as [Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Time off balances');
  otherTenant = await createTenant(otherOwner, 'Balances elsewhere');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  for (const [key, s] of [['mgr', mgr], ['emp', emp], ['peer', peer]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  await ok('PATCH', `/people/employees/${id.emp}`, { ...as(owner), body: { managerId: id.mgr, employmentStartDate: START } }, 200);
  await ok('PATCH', `/people/employees/${id.mgr}`, { ...as(owner), body: { employmentStartDate: START } }, 200);
  await ok('PATCH', `/people/employees/${id.peer}`, { ...as(owner), body: { employmentStartDate: START } }, 200);
  technicians = await ok('POST', '/timeoff/policies', { ...as(owner), body: { name: 'Technicians', baseDays: 25, carryOver: true, carryOverCap: 5 } });
});

describe('one employee’s balance (spec 6.3, 6.5)', () => {
  it('the employee, their manager and Admins see it; a peer gets 403; Admins may adjust', async () => {
    const mine = await ok('GET', `/timeoff/employees/${id.emp}/balance`, as(emp));
    expect(mine).toMatchObject({ employeeId: id.emp, year: YEAR, currentYear: YEAR, policy: { name: 'Standard', carryOver: true }, hasStartDate: true, canAdjust: false });
    expect(mine.years).toEqual([YEAR - 1, YEAR]);
    expect((await ok('GET', `/timeoff/employees/${id.emp}/balance`, as(mgr))).canAdjust).toBe(false);
    expect((await ok('GET', `/timeoff/employees/${id.emp}/balance`, as(owner))).canAdjust).toBe(true);
    expect((await call('GET', `/timeoff/employees/${id.emp}/balance`, as(peer))).status).toBe(403);
    expect((await call('GET', `/timeoff/employees/00000000-0000-0000-0000-000000000000/balance`, as(owner))).status).toBe(404);
  });

  it('the figures: last year’s unused days carry over, and expire on 1 July', async () => {
    const b = await ok('GET', `/timeoff/employees/${id.emp}/balance`, as(emp));
    expect(b.figures).toMatchObject({ entitlement: 20, carriedOver: 20, carryExpiresOn: `${YEAR}-06-30`, adjustments: 0, total: 40, used: 0, scheduled: 0, pending: 0, twoWeekPart: false });
    expect(b.figures.expired).toBe(AFTER_JUNE ? 20 : 0);
    expect(b.figures.remaining).toBe(AFTER_JUNE ? 20 : 40);
    expect(b.figures.carryRemaining).toBe(AFTER_JUNE ? 0 : 20);
    const kinds = b.history.map((h: { kind: string }) => h.kind);
    expect(kinds).toContain('entitlement');
    expect(kinds).toContain('carry_over');
    expect(kinds.includes('expired')).toBe(AFTER_JUNE);
    expect(b.history[b.history.length - 1].runningTotal).toBe(b.figures.remaining);
    // Another year: last year's card has no carry-over (nothing before it) and its own history.
    const last = await ok('GET', `/timeoff/employees/${id.emp}/balance?year=${YEAR - 1}`, as(emp));
    expect(last.figures).toMatchObject({ year: YEAR - 1, entitlement: 20, carriedOver: 0, remaining: 20 });
    // Without a start date there is no entitlement and nothing to carry.
    expect((await ok('GET', `/timeoff/employees/${id.owner}/balance`, as(owner))).figures).toMatchObject({ entitlement: 0, carriedOver: 0, total: 0, remaining: 0 });
  });
});

describe('adjustments (spec 6.4, AC3)', () => {
  it('only Admins adjust, always with a reason and a number of days other than 0, within three pool years', async () => {
    expect((await call('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(mgr), body: { poolYear: YEAR, days: 1, kind: 'correction', reason: 'x' } })).status).toBe(403);
    expect((await call('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(emp), body: { poolYear: YEAR, days: 1, kind: 'correction', reason: 'x' } })).status).toBe(403);
    expect((await call('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR, days: 0, kind: 'correction', reason: 'x' } })).status).toBe(400);
    expect((await call('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR, days: 2, kind: 'correction', reason: '  ' } })).status).toBe(400);
    expect((await call('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR - 2, days: 2, kind: 'correction', reason: 'x' } })).status).toBe(400);
    expect((await call('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR, days: 2, kind: 'bonus', reason: 'x' } })).status).toBe(400);
  });

  it('an opening balance lowers the year’s pool, shows in the history with who and why, and emails the employee', async () => {
    const before = (await balanceMails(emp.email)).length;
    const b = await ok('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR, days: -3, kind: 'opening_balance', reason: 'Used before Pultly' } });
    expect(b.figures).toMatchObject({ adjustments: -3, total: 37, remaining: AFTER_JUNE ? 17 : 37 });
    const entry = b.history.find((h: { kind: string }) => h.kind === 'adjustment');
    expect(entry).toMatchObject({ days: -3, label: 'Opening balance: Used before Pultly', adjustmentKind: 'opening_balance', actor: { userId: owner.userId } });
    const mail = await eventually(async () => {
      const mails = await balanceMails(emp.email);
      return mails.length > before ? mails[0] : null;
    }, 'the "Balance adjusted" email');
    expect(mail.subject).toBe(`Your vacation balance for ${YEAR} was adjusted: -3 days`);
    expect(mail.text).toContain('Opening balance: -3 days');
    expect(mail.text).toContain('Reason: Used before Pultly');
  });

  it('a pool can’t go below zero; extra days add up; adjustments are append-only', async () => {
    const tooMuch = await call('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR, days: -20, kind: 'correction', reason: 'Oops' } });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.message).toContain('below');
    const b = await ok('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR, days: 2, kind: 'extra_days', reason: 'Reward' } });
    expect(b.figures.adjustments).toBe(-1);
    expect(b.history.filter((h: { kind: string }) => h.kind === 'adjustment')).toHaveLength(2);
    // Last year's pool: an adjustment there changes this year's carry-over.
    const c = await ok('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR - 1, days: -15, kind: 'opening_balance', reason: 'Used in the old system' } });
    expect(c.figures).toMatchObject({ year: YEAR - 1, adjustments: -15, remaining: 5 });
    expect((await ok('GET', `/timeoff/employees/${id.emp}/balance`, as(emp))).figures.carriedOver).toBe(5);
  });

  it('the "Time off balance" toggle turns the email off', async () => {
    await ok('PATCH', '/profile', { ...as(emp), body: { notifyTimeoffBalance: false } }, 200);
    expect((await ok('GET', '/profile', as(emp))).notifyTimeoffBalance).toBe(false);
    const before = (await balanceMails(emp.email)).length;
    await ok('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...as(owner), body: { poolYear: YEAR, days: 1, kind: 'correction', reason: 'Quiet' } });
    await new Promise((r) => setTimeout(r, 1500));
    expect((await balanceMails(emp.email)).length).toBe(before);
    await ok('PATCH', '/profile', { ...as(emp), body: { notifyTimeoffBalance: true } }, 200);
  });
});

describe('the Balances table (spec 6.5, AC2)', () => {
  it('an employee without reports gets 403; a manager sees their reports; Admins everyone', async () => {
    expect((await call('GET', '/timeoff/balances', as(emp))).status).toBe(403);
    const mine = await ok('GET', '/timeoff/balances', as(mgr));
    expect(mine.rows.map((r: { employee: { id: string } }) => r.employee.id)).toEqual([id.emp]);
    expect(mine.canAdjust).toBe(false);
    const all = await ok('GET', '/timeoff/balances', as(owner));
    expect(all.rows.map((r: { employee: { id: string } }) => r.employee.id).sort()).toEqual([id.owner, id.mgr, id.emp, id.peer].sort());
    expect(all.canAdjust).toBe(true);
    const row = all.rows.find((r: { employee: { id: string } }) => r.employee.id === id.emp);
    expect(row).toMatchObject({ policy: { name: 'Standard' }, employee: { hasStartDate: true }, figures: { entitlement: 20, carriedOver: 5, adjustments: 0 } });
  });

  it('filters by policy and expiring days; the CSV has one line per row', async () => {
    const none = await ok('GET', `/timeoff/balances?policyId=${technicians.id}`, as(owner));
    expect(none.rows).toEqual([]);
    const expiring = await ok('GET', '/timeoff/balances?expiring=true', as(owner));
    // After 30 June nothing is "expiring"; before it, everyone with carry-over.
    expect(expiring.rows.length).toBe(AFTER_JUNE ? 0 : 3);
    const csv = await call('GET', '/timeoff/balances/csv', as(owner));
    expect(csv.status).toBe(200);
    const text = String(csv.body);
    expect(text.startsWith('﻿Employee,Job title,Unit,Policy,Entitlement')).toBe(true);
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(5);
    expect((await call('GET', '/timeoff/balances/csv', as(emp))).status).toBe(403);
  });

  it('bulk Change policy and Recalculate (Admins)', async () => {
    expect((await call('POST', '/timeoff/balances/policy', { ...as(mgr), body: { employeeIds: [id.emp], policyId: technicians.id } })).status).toBe(403);
    const moved = await ok('POST', '/timeoff/balances/policy', { ...as(owner), body: { employeeIds: [id.emp, id.peer], policyId: technicians.id } }, 200);
    expect(moved.changed).toBe(2);
    expect((await ok('GET', `/timeoff/employees/${id.peer}/profile`, as(owner))).policy.name).toBe('Technicians');
    const table = await ok('GET', `/timeoff/balances?policyId=${technicians.id}`, as(owner));
    expect(table.rows.map((r: { employee: { id: string } }) => r.employee.id).sort()).toEqual([id.emp, id.peer].sort());
    // The policy applies from next year; Recalculate applies it now: 25 days and a carry-over cap of 5.
    const rec = await ok('POST', '/timeoff/balances/recalculate', { ...as(owner), body: { employeeIds: [id.peer], year: YEAR } }, 200);
    expect(rec.changed).toBe(1);
    expect((await ok('GET', `/timeoff/employees/${id.peer}/balance`, as(peer))).figures).toMatchObject({ entitlement: 25, carriedOver: 5 });
    expect((await call('POST', '/timeoff/balances/recalculate', { ...as(mgr), body: { employeeIds: [id.emp], year: YEAR } })).status).toBe(403);
  });
});

describe('the daily job (spec 6.2, 15.2)', () => {
  it('records what expired on 1 July and reminds about expiring carry-over in May, once', async () => {
    const july = await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${YEAR}-07-01T12:00:00Z` } }, 200);
    expect(july.expired).toBeGreaterThanOrEqual(1);
    const b = await ok('GET', `/timeoff/employees/${id.emp}/balance`, as(emp));
    expect(b.expiryRecordedAt).not.toBeNull();
    expect((await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${YEAR}-07-02T12:00:00Z` } }, 200)).expired).toBe(0);

    const before = (await mailTo(owner, emp.email)).filter((m) => m.subject.includes('expire on 30 June')).length;
    const may = await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${YEAR}-05-02T12:00:00Z` } }, 200);
    expect(may.reminders).toBeGreaterThanOrEqual(1);
    const mail = await eventually(async () => {
      const mails = (await mailTo(owner, emp.email)).filter((m) => m.subject.includes('expire on 30 June'));
      return mails.length > before ? mails[0] : null;
    }, 'the "Carry-over expiring" email');
    expect(mail.subject).toBe(`5 vacation days from ${YEAR - 1} expire on 30 June`);
    expect((await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${YEAR}-05-03T12:00:00Z` } }, 200)).reminders).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('another workspace sees none of it', async () => {
    const other = { token: otherOwner.token, tenant: otherTenant };
    expect((await call('GET', `/timeoff/employees/${id.emp}/balance`, other)).status).toBe(404);
    expect((await call('POST', `/timeoff/employees/${id.emp}/adjustments`, { ...other, body: { poolYear: YEAR, days: 1, kind: 'correction', reason: 'x' } })).status).toBe(404);
    expect((await ok('GET', '/timeoff/balances', other)).rows.map((r: { employee: { id: string } }) => r.employee.id)).not.toContain(id.emp);
    expect((await ok('POST', '/timeoff/balances/policy', { ...other, body: { employeeIds: [id.emp], policyId: technicians.id } }, 200)).changed).toBe(0);
    expect((await call('GET', '/timeoff/balances', { token: otherOwner.token, tenant })).status).toBe(403);
  });
});
