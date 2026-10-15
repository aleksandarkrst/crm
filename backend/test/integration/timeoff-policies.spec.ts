/**
 * Vacation policies, the time off profile and the yearly entitlement (CD-163, spec 5.6): the
 * default "Standard" policy of a new workspace, Admin-only changes (AC1: base days below 20
 * refused, exactly one default), the entitlement rules through the API (AC2), who sees whose
 * profile (spec 15.1), Recalculate and individual days, the history (AC4), the daily job and
 * tenant isolation.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn } from './helpers';
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

let standard: { id: string };
let technicians: { id: string };

beforeAll(async () => {
  [owner, mgr, emp, peer, otherOwner] = (await Promise.all(['to-owner', 'to-mgr', 'to-emp', 'to-peer', 'to-other'].map((l) => signIn(l)))) as [Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Time off policies');
  otherTenant = await createTenant(otherOwner, 'Time off elsewhere');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  for (const [key, s] of [['mgr', mgr], ['emp', emp], ['peer', peer]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  // emp reports to mgr; everyone started on 1 March 2024 (a full year in every later year).
  await ok('PATCH', `/people/employees/${id.emp}`, { ...as(owner), body: { managerId: id.mgr, employmentStartDate: START } }, 200);
  await ok('PATCH', `/people/employees/${id.mgr}`, { ...as(owner), body: { employmentStartDate: START } }, 200);
  await ok('PATCH', `/people/employees/${id.peer}`, { ...as(owner), body: { employmentStartDate: START } }, 200);
});

describe('policies (spec 5.2, 5.5)', () => {
  it('a new workspace has one default policy, Standard: 20 days, carry-over on', async () => {
    const policies = await ok('GET', '/timeoff/policies', as(owner));
    expect(policies).toHaveLength(1);
    standard = policies[0];
    expect(policies[0]).toMatchObject({ name: 'Standard', baseDays: 20, maxDays: null, carryOver: true, carryOverCap: null, isDefault: true, experienceRules: [] });
    // Everyone is on it: the owner, mgr, emp and peer (no profile rows yet).
    expect(policies[0].employees).toBe(4);
  });

  it('members read policies but only Admins change them (403)', async () => {
    expect((await call('GET', '/timeoff/policies', as(emp))).status).toBe(200);
    expect((await call('POST', '/timeoff/policies', { ...as(emp), body: { name: 'Mine', baseDays: 25 } })).status).toBe(403);
    expect((await call('PATCH', `/timeoff/policies/${standard.id}`, { ...as(emp), body: { baseDays: 25 } })).status).toBe(403);
    expect((await call('DELETE', `/timeoff/policies/${standard.id}`, as(emp))).status).toBe(403);
    expect((await call('POST', `/timeoff/policies/${standard.id}/default`, as(emp))).status).toBe(403);
  });

  it('refuses base days below the Labor Law minimum of 20 (A1) and duplicate names', async () => {
    const low = await call('POST', '/timeoff/policies', { ...as(owner), body: { name: 'Too few', baseDays: 19 } });
    expect(low.status).toBe(400);
    expect(JSON.stringify(low.body)).toContain('20');
    const dup = await call('POST', '/timeoff/policies', { ...as(owner), body: { name: ' standard ', baseDays: 22 } });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('A policy with this name already exists');
    const sameRows = await call('POST', '/timeoff/policies', { ...as(owner), body: { name: 'Twice', baseDays: 22, experienceRules: [{ fromYears: 5, extraDays: 1 }, { fromYears: 5, extraDays: 2 }] } });
    expect(sameRows.status).toBe(400);
  });

  it('Admins create a policy with experience rows, a cap and a carry-over cap', async () => {
    technicians = await ok('POST', '/timeoff/policies', {
      ...as(owner),
      body: { name: 'Field technicians', baseDays: 25, maxDays: 30, carryOver: true, carryOverCap: 5, note: 'Rulebook art. 12', experienceRules: [{ fromYears: 10, extraDays: 4 }, { fromYears: 5, extraDays: 2 }] },
    });
    expect(technicians).toMatchObject({ name: 'Field technicians', baseDays: 25, maxDays: 30, carryOverCap: 5, isDefault: false, employees: 0, experienceRules: [{ fromYears: 5, extraDays: 2 }, { fromYears: 10, extraDays: 4 }] });
    const list = await ok('GET', '/timeoff/policies', as(owner));
    // The default comes first.
    expect(list.map((p: { name: string }) => p.name)).toEqual(['Standard', 'Field technicians']);
  });

  it('a renamed policy changes nobody’s days; a delete needs no employees and never the default', async () => {
    const renamed = await ok('PATCH', `/timeoff/policies/${technicians.id}`, { ...as(owner), body: { name: 'Technicians' } }, 200);
    expect(renamed).toMatchObject({ name: 'Technicians', recalculated: 0 });
    const isDefault = await call('DELETE', `/timeoff/policies/${standard.id}`, as(owner));
    expect(isDefault.status).toBe(409);
    expect(isDefault.body.message).toContain('default');
    const unused = await ok('POST', '/timeoff/policies', { ...as(owner), body: { name: 'Interns', baseDays: 20 } });
    await ok('DELETE', `/timeoff/policies/${unused.id}`, as(owner));
    expect((await call('DELETE', `/timeoff/policies/${unused.id}`, as(owner))).status).toBe(404);
  });
});

describe('the time off profile and entitlement (spec 5.3, 5.4, 15.1)', () => {
  it('the employee, their manager and Admins see it; a peer does not (403); a stranger’s id is 404', async () => {
    const mine = await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(emp));
    expect(mine).toMatchObject({ employeeId: id.emp, policy: { name: 'Standard' }, hasProfile: false, priorExperienceMonths: 0, startDate: START, currentYear: YEAR, canEdit: false });
    expect((await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(mgr))).canEdit).toBe(false);
    expect((await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(owner))).canEdit).toBe(true);
    expect((await call('GET', `/timeoff/employees/${id.emp}/profile`, as(peer))).status).toBe(403);
    expect((await call('GET', `/timeoff/employees/00000000-0000-0000-0000-000000000000/profile`, as(owner))).status).toBe(404);
  });

  it('looking at the profile makes this year’s entitlement: a full year of the policy’s base days', async () => {
    const p = await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(emp));
    const year = p.entitlements.find((e: { year: number }) => e.year === YEAR);
    expect(year).toMatchObject({ policy: { name: 'Standard' }, baseDays: 20, experienceDays: 0, individualDays: 0, monthsWorked: null, annualDays: 20, totalDays: 20, frozen: false, policyOutdated: false });
    // Without a start date there is no entitlement (the owner's record has none).
    const o = await ok('GET', `/timeoff/employees/${id.owner}/profile`, as(owner));
    expect(o.startDate).toBeNull();
    expect(o.entitlements).toEqual([]);
  });

  it('a mid-year start is proportional (A3): 15 March, 9 full months of 20 days = 15', async () => {
    await ok('PATCH', `/people/employees/${id.peer}`, { ...as(owner), body: { employmentStartDate: `${YEAR}-03-15` } }, 200);
    const p = await ok('GET', `/timeoff/employees/${id.peer}/profile`, as(owner));
    expect(p.entitlements.find((e: { year: number }) => e.year === YEAR)).toMatchObject({ monthsWorked: 9, annualDays: 20, totalDays: 15 });
    await ok('PATCH', `/people/employees/${id.peer}`, { ...as(owner), body: { employmentStartDate: START } }, 200);
    expect((await ok('GET', `/timeoff/employees/${id.peer}/profile`, as(owner))).entitlements.find((e: { year: number }) => e.year === YEAR)).toMatchObject({ monthsWorked: null, totalDays: 20 });
  });

  it('only Admins change the profile; a new policy applies from next year until Recalculate', async () => {
    expect((await call('PATCH', `/timeoff/employees/${id.emp}/profile`, { ...as(emp), body: { policyId: technicians.id } })).status).toBe(403);
    expect((await call('PATCH', `/timeoff/employees/${id.emp}/profile`, { ...as(mgr), body: { policyId: technicians.id } })).status).toBe(403);
    expect((await call('PATCH', `/timeoff/employees/${id.emp}/profile`, { ...as(owner), body: {} })).status).toBe(400);
    const p = await ok('PATCH', `/timeoff/employees/${id.emp}/profile`, { ...as(owner), body: { policyId: technicians.id } }, 200);
    expect(p).toMatchObject({ policy: { id: technicians.id, name: 'Technicians' }, hasProfile: true });
    // This year stays on Standard, flagged.
    expect(p.entitlements.find((e: { year: number }) => e.year === YEAR)).toMatchObject({ policy: { name: 'Standard' }, totalDays: 20, policyOutdated: true });
    // The counts follow: emp moved, the other three stay on the default.
    const list = await ok('GET', '/timeoff/policies', as(owner));
    expect(list.find((x: { id: string }) => x.id === technicians.id).employees).toBe(1);
    expect(list.find((x: { id: string }) => x.id === standard.id).employees).toBe(3);

    // Recalculate: preview, then save. 25 base days, 1 year of experience (started 1 March 2024): no extra.
    const preview = await ok('POST', `/timeoff/employees/${id.emp}/entitlements/${YEAR}/recalculate`, { ...as(owner), body: { preview: true } }, 200);
    expect(preview.before).toMatchObject({ totalDays: 20 });
    expect(preview.after).toMatchObject({ baseDays: 25, experienceDays: 0, annualDays: 25, totalDays: 25 });
    expect(preview.profile).toBeNull();
    expect((await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(owner))).entitlements.find((e: { year: number }) => e.year === YEAR).totalDays).toBe(20);
    const saved = await ok('POST', `/timeoff/employees/${id.emp}/entitlements/${YEAR}/recalculate`, { ...as(owner), body: {} }, 200);
    expect(saved.profile.entitlements.find((e: { year: number }) => e.year === YEAR)).toMatchObject({ policy: { name: 'Technicians' }, totalDays: 25, policyOutdated: false });
    expect((await call('POST', `/timeoff/employees/${id.emp}/entitlements/${YEAR}/recalculate`, { ...as(emp), body: {} })).status).toBe(403);
  });

  it('prior work experience reaches the experience rows at their thresholds', async () => {
    // 4 years prior + ~1.8 years here = 5 → +2 days; the row isn't frozen, so it follows at once.
    let p = await ok('PATCH', `/timeoff/employees/${id.emp}/profile`, { ...as(owner), body: { priorExperienceMonths: 48 } }, 200);
    expect(p.priorExperienceLabel).toBe('4 years');
    let year = p.entitlements.find((e: { year: number }) => e.year === YEAR);
    expect(year.experienceYears).toBeGreaterThanOrEqual(5);
    expect(year).toMatchObject({ experienceDays: 2, annualDays: 27, totalDays: 27 });
    // 9 years prior → 10 or more → +4, but the cap of 30 holds base + extra + individual.
    p = await ok('PATCH', `/timeoff/employees/${id.emp}/profile`, { ...as(owner), body: { priorExperienceMonths: 108 } }, 200);
    year = p.entitlements.find((e: { year: number }) => e.year === YEAR);
    expect(year).toMatchObject({ experienceDays: 4, annualDays: 29, totalDays: 29 });
  });

  it('individual extra days need a reason and count toward the cap', async () => {
    const noReason = await call('PATCH', `/timeoff/employees/${id.emp}/entitlements/${YEAR}`, { ...as(owner), body: { individualDays: 3 } });
    expect(noReason.status).toBe(400);
    expect((await call('PATCH', `/timeoff/employees/${id.emp}/entitlements/${YEAR}`, { ...as(mgr), body: { individualDays: 3, individualReason: 'x' } })).status).toBe(403);
    const p = await ok('PATCH', `/timeoff/employees/${id.emp}/entitlements/${YEAR}`, { ...as(owner), body: { individualDays: 3, individualReason: 'Collective agreement: working conditions' } }, 200);
    // 25 + 4 + 3 = 32, capped at 30.
    expect(p.entitlements.find((e: { year: number }) => e.year === YEAR)).toMatchObject({ individualDays: 3, individualReason: 'Collective agreement: working conditions', annualDays: 30, totalDays: 30 });
    const cleared = await ok('PATCH', `/timeoff/employees/${id.emp}/entitlements/${YEAR}`, { ...as(owner), body: { individualDays: 0 } }, 200);
    expect(cleared.entitlements.find((e: { year: number }) => e.year === YEAR)).toMatchObject({ individualDays: 0, individualReason: null, totalDays: 29 });
  });

  it('editing a policy’s days recalculates the employees on it and says how many changed', async () => {
    const res = await ok('PATCH', `/timeoff/policies/${technicians.id}`, { ...as(owner), body: { baseDays: 26 } }, 200);
    expect(res.recalculated).toBe(1);
    expect((await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(emp))).entitlements.find((e: { year: number }) => e.year === YEAR)).toMatchObject({ baseDays: 26, totalDays: 30 });
    // A policy with entitlements can't be deleted even after its employees moved (their history needs it).
    await ok('PATCH', `/timeoff/employees/${id.emp}/profile`, { ...as(owner), body: { policyId: standard.id } }, 200);
    const del = await call('DELETE', `/timeoff/policies/${technicians.id}`, as(owner));
    expect(del.status).toBe(409);
    await ok('PATCH', `/timeoff/employees/${id.emp}/profile`, { ...as(owner), body: { policyId: technicians.id } }, 200);
  });

  it('exactly one policy is the default; employees without a profile row follow it', async () => {
    const made = await ok('POST', `/timeoff/policies/${technicians.id}/default`, as(owner), 200);
    expect(made.isDefault).toBe(true);
    const list = await ok('GET', '/timeoff/policies', as(owner));
    expect(list.filter((p: { isDefault: boolean }) => p.isDefault)).toHaveLength(1);
    expect(list.find((x: { id: string }) => x.id === technicians.id).employees).toBe(4);
    // mgr (no profile row) is on the new default; this year's row keeps the policy it was computed with.
    const m = await ok('GET', `/timeoff/employees/${id.mgr}/profile`, as(mgr));
    expect(m.policy.name).toBe('Technicians');
    await ok('POST', `/timeoff/policies/${standard.id}/default`, as(owner), 200);
  });

  it('keeps a history of the policy and of the employee’s profile and entitlement (AC4)', async () => {
    const policy = await ok('GET', `/timeoff/policies/${technicians.id}/history`, as(owner));
    const fields = policy.entries.map((e: { action: string; field: string | null }) => `${e.action}:${e.field ?? ''}`);
    expect(fields).toContain('created:');
    expect(fields).toContain('updated:baseDays');
    expect(fields).toContain('updated:name');
    expect(fields).toContain('updated:isDefault');
    expect(policy.entries[0].actor).toMatchObject({ userId: owner.userId });
    expect((await call('GET', `/timeoff/policies/${technicians.id}/history`, as(emp))).status).toBe(403);

    const mine = await ok('GET', `/timeoff/employees/${id.emp}/history`, as(emp));
    const kinds = mine.entries.map((e: { entityType: string; action: string; field: string | null }) => `${e.entityType}:${e.action}:${e.field ?? ''}`);
    expect(kinds).toContain('timeoff_profile:updated:policyId');
    expect(kinds).toContain('timeoff_profile:updated:priorExperienceMonths');
    expect(kinds).toContain('vacation_entitlement:updated:totalDays');
    expect(kinds).toContain('vacation_entitlement:updated:individualDays');
    const policyChange = mine.entries.find((e: { field: string | null }) => e.field === 'policyId');
    expect([policyChange.oldLabel, policyChange.newLabel]).toContain('Technicians');
    expect((await call('GET', `/timeoff/employees/${id.emp}/history`, as(mgr))).status).toBe(403);
    expect((await call('GET', `/timeoff/employees/${id.emp}/history`, as(peer))).status).toBe(403);
  });

  it('the daily job makes next year’s rows from 1 October', async () => {
    const before = await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${YEAR}-09-30T12:00:00Z` } }, 200);
    expect(before).toHaveProperty('changed');
    // Reading a profile makes next year's row too once the real date passed 1 October, so this
    // only holds while the test runs well before it.
    if (new Date().getUTCMonth() < 8) expect((await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(emp))).entitlements.some((e: { year: number }) => e.year === YEAR + 1)).toBe(false);
    await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${YEAR}-10-01T12:00:00Z` } }, 200);
    const p = await ok('GET', `/timeoff/employees/${id.emp}/profile`, as(emp));
    // Next year uses the employee's current policy (Technicians, 26 days) and one more year of experience.
    expect(p.entitlements.find((e: { year: number }) => e.year === YEAR + 1)).toMatchObject({ policy: { name: 'Technicians' }, baseDays: 26, monthsWorked: null });
    // Running it again changes nothing.
    expect((await ok('POST', '/dev/timeoff/daily', { ...as(owner), body: { now: `${YEAR}-10-01T12:00:00Z` } }, 200)).changed).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('another workspace sees only its own policies and none of these employees', async () => {
    const other = { token: otherOwner.token, tenant: otherTenant };
    const policies = await ok('GET', '/timeoff/policies', other);
    expect(policies).toHaveLength(1);
    expect(policies[0].name).toBe('Standard');
    expect((await call('GET', `/timeoff/employees/${id.emp}/profile`, other)).status).toBe(404);
    expect((await call('PATCH', `/timeoff/policies/${technicians.id}`, { ...other, body: { name: 'Stolen' } })).status).toBe(404);
    expect((await call('GET', '/timeoff/policies', { token: otherOwner.token, tenant })).status).toBe(403);
  });
});
