/**
 * Reporting lines (CD-139, spec 7): loops refused on every path, also under concurrent bulk and
 * team-lead changes (AC 7.6.1), manager scope on trees of depth 1 to 10 right after a change
 * (AC 7.6.3), who may change them (AC 7.6.5), the "New manager" and "New direct report" emails
 * (spec 10.2) and the "Manager has no account" data issue (spec 7.5).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { call, createTenant, eventually, mailTo, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql, grantRole, joinAsEmployee, START } from './people-helpers';

let owner: Session;
let hr: Session;
let pay: Session;
let mgr: Session;
let emp: Session;
let peer: Session;
let tenant: string;
const id = {} as Record<'owner' | 'hr' | 'pay' | 'mgr' | 'emp' | 'peer', string>;
const as = (s: Session = owner) => ({ token: s.token, tenant });

const person = async (firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
  (await ok('POST', '/people/employees', { ...as(), body: { firstName, lastName, employmentStartDate: START, ...extra } })).id as string;
const setManager = (employeeIds: string[], managerId: string | null, s: Session = hr) => call('POST', '/people/reporting-lines', { ...as(s), body: { employeeIds, managerId } });
const managerOf = async (employeeId: string) => (await asTenantSql<{ manager_id: string | null }>(tenant, `select manager_id from employees where id = $1`, [employeeId]))[0]!.manager_id;
const scopeOf = async (managerId: string) =>
  (await ok('GET', `/people/employees?managerId=${managerId}&managerScope=indirect`, as(hr))).employees.map((e: { id: string }) => e.id).sort() as string[];
const subjects = async (s: Session) => (await mailTo(s, s.email)).map((m) => m.subject);

beforeAll(async () => {
  [owner, hr, pay, mgr, emp, peer] = (await Promise.all(['rl-owner', 'rl-hr', 'rl-pay', 'rl-mgr', 'rl-emp', 'rl-peer'].map((l) => signIn(l)))) as [
    Session,
    Session,
    Session,
    Session,
    Session,
    Session,
  ];
  tenant = await createTenant(owner, 'Reporting lines');
  id.owner = (await accessOf(owner, tenant)).employeeId;
  for (const [key, s] of [['hr', hr], ['pay', pay], ['mgr', mgr], ['emp', emp], ['peer', peer]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  await grantRole(tenant, id.hr, 'administration');
  await grantRole(tenant, id.pay, 'payroll');
});

describe('loops (AC 7.6.1)', () => {
  it('a bulk change is all or nothing: a loop anywhere refuses it, naming the loop', async () => {
    const a = await person('Ana', 'Bulk');
    const b = await person('Bora', 'Bulk', { managerId: a });
    const c = await person('Ceca', 'Bulk', { managerId: b });
    const d = await person('Dule', 'Bulk');
    const res = await setManager([d, a], c);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'reporting_loop', message: 'This would create a loop: Ana Bulk → Ceca Bulk → Bora Bulk → Ana Bulk' });
    expect(await managerOf(d)).toBeNull();
    const self = await setManager([d], d);
    expect(self).toMatchObject({ status: 400, body: { message: "An employee can't report to themselves" } });
    expect((await setManager([d, c], a)).body).toEqual({ changed: [d, c] });
  });

  it('is checked against the lines the same bulk change has set already', async () => {
    const x = await person('Xavi', 'Seq');
    const y = await person('Yana', 'Seq', { managerId: x });
    // y → (none) then x → y: fine. x → y while y → x: a loop.
    expect((await setManager([x], y)).status).toBe(409);
    expect((await setManager([y], null)).status).toBe(200);
    expect((await setManager([x], y)).status).toBe(200);
  });

  it('holds under concurrent bulk and team-lead changes: never both directions', async () => {
    const dept = (await ok('POST', '/people/departments', { ...as(hr), body: { name: 'Race dept' } })).id as string;
    for (let round = 0; round < 3; round++) {
      // Bulk vs bulk.
      const p = await person('Race', `P${round}`);
      const q = await person('Race', `Q${round}`);
      const bulk = await Promise.all([setManager([p], q), setManager([q], p)]);
      expect(bulk.map((r) => r.status).sort()).toEqual([200, 409]);
      expect([await managerOf(p), await managerOf(q)].filter(Boolean)).toHaveLength(1);

      // Bulk vs the team-lead dialog: x → y in bulk while y's team gets lead x with "report to the lead".
      const x = await person('Lead', `X${round}`);
      const y = await person('Member', `Y${round}`);
      const team = (await ok('POST', '/people/teams', { ...as(hr), body: { departmentId: dept, name: `Race team ${round}` } })).team.id as string;
      await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: dept, teamId: team, employeeIds: [y] } }, 200);
      const [viaBulk, viaLead] = await Promise.all([
        setManager([x], y),
        call('PATCH', `/people/teams/${team}`, { ...as(owner), body: { leadEmployeeId: x, makeMembersReport: true } }),
      ]);
      expect(viaLead.status).toBe(200);
      const [mx, my] = [await managerOf(x), await managerOf(y)];
      expect(mx === y && my === x).toBe(false);
      // Whichever came second saw the first: the bulk was refused, or the lead dialog skipped y as a loop.
      if (viaBulk.status === 200) expect(viaLead.body.loops.map((l: { id: string }) => l.id)).toEqual([y]);
      else expect(viaBulk.status).toBe(409);
    }
  });
});

describe('manager scope (AC 7.6.3)', () => {
  it('is right for trees of depth 1 to 10, right after each change', async () => {
    // mgr → c1 → c2 → … → c10, built one level at a time.
    const chain: string[] = [];
    for (let depth = 1; depth <= 10; depth++) {
      const e = await person('Chain', `Level${depth}`);
      expect((await setManager([e], depth === 1 ? id.mgr : chain.at(-1)!)).status).toBe(200);
      chain.push(e);
      const access = await accessOf(mgr, tenant);
      expect(access.directReportIds).toEqual([chain[0]]);
      expect([...access.reportIds].sort()).toEqual([...chain].sort());
      expect(access.roles).toContain('manager');
      // Everyone in the chain sees exactly the levels below them.
      for (let i = 0; i < chain.length; i++) expect(await scopeOf(chain[i]!)).toEqual(chain.slice(i + 1).sort());
    }
    // Moving level 5 (and so 6–10) elsewhere shrinks the scope at once.
    await setManager([chain[4]!], id.owner);
    expect([...(await accessOf(mgr, tenant)).reportIds].sort()).toEqual(chain.slice(0, 4).sort());
    expect(await scopeOf(chain[0]!)).toEqual(chain.slice(1, 4).sort());
    expect(await scopeOf(id.owner)).toEqual(expect.arrayContaining(chain.slice(4)));
    // Removing the only direct report removes the Manager role.
    await setManager([chain[0]!], null);
    const after = await accessOf(mgr, tenant);
    expect(after.reportIds).toEqual([]);
    expect(after.roles).not.toContain('manager');
  });
});

describe('who changes reporting lines (AC 7.6.5)', () => {
  it('Administration and Admins only; nobody but an Admin changes their own or becomes a manager themselves', async () => {
    const e = await person('Someone', 'Else');
    for (const s of [emp, mgr, pay]) {
      expect((await setManager([e], id.mgr, s)).status, s.name).toBe(403);
      expect((await call('PATCH', `/people/employees/${e}`, { ...as(s), body: { managerId: id.mgr } })).status, s.name).toBe(403);
    }
    const own = await setManager([id.hr], id.mgr, hr);
    expect(own).toMatchObject({ status: 403, body: { message: 'Only an Admin can change their own manager' } });
    expect((await call('PATCH', `/people/employees/${id.hr}`, { ...as(hr), body: { managerId: id.mgr } })).status).toBe(403);
    expect((await setManager([e], id.hr, hr)).body.message).toBe("Only an Admin can make themselves someone's manager");
    expect(await managerOf(e)).toBeNull();
    expect(await managerOf(id.hr)).toBeNull();
    // Administration sets others; an Admin may set their own and make themselves a manager.
    expect((await setManager([e], id.mgr, hr)).status).toBe(200);
    expect((await setManager([id.owner], id.mgr, owner)).status).toBe(200);
    expect((await setManager([e], id.owner, owner)).status).toBe(200);
    await setManager([id.owner], null, owner);
  });

  it('refuses people who left, and unknown ids', async () => {
    const gone = await person('Gone', 'Already');
    await asTenantSql(tenant, `update employees set deactivated_at = now(), employment_end_date = current_date where id = $1`, [gone]);
    expect((await setManager([gone], id.mgr)).body.message).toBe('Gone Already has left the company');
    expect((await setManager(['00000000-0000-4000-8000-000000000000'], id.mgr)).status).toBe(400);
    expect((await setManager([id.emp], gone)).status).toBe(400);
  });
});

describe('"New manager" and "New direct report" emails (spec 10.2)', () => {
  it('go to the employee and the new manager when someone else changes it in the app, if they want them', async () => {
    // From the card (single), by Administration.
    await ok('PATCH', `/people/employees/${id.emp}`, { ...as(hr), body: { managerId: id.mgr } });
    const toEmp = await eventually(async () => (await mailTo(emp, emp.email)).find((m) => m.subject.startsWith('Your new manager in')), '"New manager" email');
    expect(toEmp.subject).toMatch(new RegExp(`^Your new manager in Reporting lines .+: ${mgr.name}$`));
    expect(toEmp.text).toContain(`${hr.name} changed who you report to`);
    expect(toEmp.text).toContain(`/people/${id.mgr}`);
    const toMgr = await eventually(async () => (await mailTo(mgr, mgr.email)).find((m) => m.subject.startsWith('New direct report in')), '"New direct report" email');
    expect(toMgr.subject).toMatch(new RegExp(`: ${emp.name}$`));
    expect(toMgr.text).toContain(`${hr.name} made ${emp.name} your direct report`);
    // Directory facts only: never personal details.
    expect(toMgr.text).not.toMatch(/@example\.test/);

    // Bulk: peer and emp → owner. The owner made the change, so gets no "New direct report".
    await ok('POST', '/people/reporting-lines', { ...as(owner), body: { employeeIds: [id.peer, id.emp], managerId: id.owner } }, 200);
    await eventually(async () => (await subjects(peer)).some((s) => s.startsWith('Your new manager in')), 'bulk "New manager" to peer');
    await eventually(async () => (await subjects(emp)).filter((s) => s.startsWith('Your new manager in')).length === 2, 'bulk "New manager" to emp');

    // emp turns "Org changes" off (read when sending); removing a manager emails nobody.
    await ok('PATCH', '/profile', { ...as(emp), body: { notifyOrgChanges: false } });
    await setManager([id.emp], id.pay);
    await setManager([id.peer], null);
    // A marker last: the worker takes the jobs in order, so once it arrived the others have run.
    await setManager([id.peer], id.mgr);
    await eventually(async () => (await subjects(peer)).filter((s) => s.startsWith('Your new manager in')).length === 2, 'marker email');
    await ok('PATCH', '/profile', { ...as(emp), body: { notifyOrgChanges: true } });
    expect((await subjects(emp)).filter((s) => s.startsWith('Your new manager in'))).toHaveLength(2);
    // pay (the new manager) still wanted theirs.
    await eventually(async () => (await subjects(pay)).some((s) => s.startsWith('New direct report in') && s.endsWith(`: ${emp.name}`)), 'direct report email to pay');
    // The owner made the bulk change themselves: no "New direct report" for emp or peer.
    expect((await subjects(owner)).some((s) => s.startsWith('New direct report in') && (s.endsWith(`: ${emp.name}`) || s.endsWith(`: ${peer.name}`)))).toBe(false);
  });

  it("are sent by the list's bulk \"Set manager\" too", async () => {
    const count = async () => (await subjects(peer)).filter((s) => s.startsWith('Your new manager in')).length;
    const before = await count();
    await ok('POST', '/people/employees/bulk', { ...as(hr), body: { employeeIds: [id.peer], managerId: id.owner } }, 200);
    await eventually(async () => (await count()) === before + 1, 'bulk "New manager" to peer');
    await eventually(async () => (await subjects(owner)).some((s) => s.startsWith('New direct report in') && s.endsWith(`: ${peer.name}`)), '"New direct report" to the owner');
  });

  it('are queued only for in-app changes: a direct database write (like the import) sends nothing', async () => {
    const before = (await subjects(peer)).length;
    await asTenantSql(tenant, `update employees set manager_id = $2 where id = $1`, [id.peer, id.pay]);
    await setManager([id.emp], id.mgr); // a marker, queued after the write
    await eventually(async () => (await subjects(emp)).filter((s) => s.startsWith('Your new manager in')).length === 3, 'marker email');
    expect((await subjects(peer)).length).toBe(before);
  });
});

describe('"Manager has no account" (spec 7.5)', () => {
  it('is a data issue for HR while the manager has no app account, and on the card', async () => {
    const boss = await person('Pending', 'Boss');
    const report = await person('Waits', 'Approval');
    await setManager([report], boss);
    const issues = async () => (await ok('GET', '/people/employees?issues=manager_no_account', as(hr))).employees.map((e: { id: string }) => e.id) as string[];
    expect(await issues()).toContain(report);
    expect(await issues()).not.toContain(id.emp); // their manager has an account
    const card = await ok('GET', `/people/employees/${report}`, as(hr));
    expect(card.manager).toMatchObject({ id: boss, hasAccount: false });
    expect(card.hr.dataIssues).toContain('manager_no_account');
    expect(card.approvals).toMatchObject({ kind: 'admins', reason: 'manager_no_account' });
    await setManager([report], id.mgr);
    expect(await issues()).not.toContain(report);
    // Only HR filters by data issues.
    expect((await call('GET', '/people/employees?issues=manager_no_account', as(mgr))).status).toBe(403);
  });
});
