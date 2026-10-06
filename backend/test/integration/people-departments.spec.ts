/**
 * Departments and teams (CD-138, spec 6): who may change them (AC 6.4.1), uniqueness and delete
 * rules, an employee never in a team of another department (AC 6.4.2), moving a team moves its
 * members in the same transaction (AC 6.4.3), "Add people" with the prefilled manager, the team-lead
 * dialog "Make team members report to <lead>" (AC 6.4.4), heads and leads placed where they head
 * (CD-225) and live updates (AC 6.4.5). `hr` is a workspace admin (only Admins do HR work since
 * CD-225); `pay` holds a leftover Payroll row, which gives nothing.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn } from './helpers';
import { asTenantSql, grantRole, joinAsEmployee, START } from './people-helpers';

let owner: Session;
let hr: Session;
let pay: Session;
let mgr: Session;
let emp: Session;
let tenant: string;
const id = {} as Record<'owner' | 'hr' | 'pay' | 'mgr' | 'emp', string>;
const as = (s: Session = owner) => ({ token: s.token, tenant });

const person = async (firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
  (await ok('POST', '/people/employees', { ...as(), body: { firstName, lastName, employmentStartDate: START, ...extra } })).id as string;
const department = async (name: string, extra: Record<string, unknown> = {}, s: Session = hr) => (await ok('POST', '/people/departments', { ...as(s), body: { name, ...extra } })).id as string;
const team = async (departmentId: string, name: string, extra: Record<string, unknown> = {}, s: Session = hr) =>
  (await ok('POST', '/people/teams', { ...as(s), body: { departmentId, name, ...extra } })).team.id as string;
const row = async (employeeId: string) =>
  (await asTenantSql<{ department_id: string | null; team_id: string | null; manager_id: string | null }>(tenant, `select department_id, team_id, manager_id from employees where id = $1`, [employeeId]))[0]!;

beforeAll(async () => {
  [owner, hr, pay, mgr, emp] = (await Promise.all(['dt-owner', 'dt-hr', 'dt-pay', 'dt-mgr', 'dt-emp'].map((l) => signIn(l)))) as [Session, Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Departments');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  id.hr = await joinAsEmployee(owner, tenant, hr, 'admin');
  for (const [key, s] of [['pay', pay], ['mgr', mgr], ['emp', emp]] as const) id[key] = await joinAsEmployee(owner, tenant, s);
  await grantRole(tenant, id.pay, 'payroll');
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [id.emp], managerId: id.mgr } }, 200);
});

describe('who changes departments and teams (AC 6.4.1)', () => {
  it('Admins add, rename and delete; history keeps the old name', async () => {
    const d = await ok('POST', '/people/departments', { ...as(hr), body: { name: '  Service ', code: 'SRV', headEmployeeId: id.mgr } });
    // The head is put in the department (CD-225).
    expect(d).toMatchObject({ name: 'Service', code: 'SRV', headEmployeeId: id.mgr, headName: mgr.name, teams: 0, activeEmployees: 1 });
    const renamed = await ok('PATCH', `/people/departments/${d.id}`, { ...as(owner), body: { name: 'Field service', code: '' } });
    expect(renamed).toMatchObject({ name: 'Field service', code: null });
    const t = await ok('POST', '/people/teams', { ...as(owner), body: { departmentId: d.id, name: 'Service Belgrade', leadEmployeeId: id.mgr } });
    // The lead is put in the team; as the department's head they stay its head.
    expect(t).toMatchObject({ team: { name: 'Service Belgrade', departmentId: d.id, leadEmployeeId: id.mgr, leadName: mgr.name, leadOutside: false }, moved: 0 });
    expect(await row(id.mgr)).toMatchObject({ department_id: d.id, team_id: t.team.id });
    expect((await ok('PATCH', `/people/teams/${t.team.id}`, { ...as(hr), body: { name: 'Service BG' } })).team.name).toBe('Service BG');
    // Everyone reads them, with the counts.
    expect((await ok('GET', '/people/departments', as(emp))).find((x: { id: string }) => x.id === d.id)).toMatchObject({ name: 'Field service', teams: 1 });
    expect((await ok('GET', '/people/teams', as(emp))).find((x: { id: string }) => x.id === t.team.id)).toMatchObject({ name: 'Service BG' });

    const { entries } = await ok('GET', `/people/history?entityType=department&entityId=${d.id}`, as(hr));
    expect(entries.find((e: { field: string }) => e.field === 'name')).toMatchObject({ oldValue: 'Service', newValue: 'Field service' });

    await ok('DELETE', `/people/teams/${t.team.id}`, as(hr));
    await ok('DELETE', `/people/departments/${d.id}`, as(hr));
    expect((await ok('GET', '/people/departments', as(hr))).some((x: { id: string }) => x.id === d.id)).toBe(false);
  });

  it('Employees, Managers and a leftover Payroll row get 403 for every change', async () => {
    const d = await department('Locked');
    const t = await team(d, 'Locked team');
    const target = await person('Target', 'Person');
    for (const s of [emp, mgr, pay]) {
      const tries = [
        await call('POST', '/people/departments', { ...as(s), body: { name: 'Nope' } }),
        await call('PATCH', `/people/departments/${d}`, { ...as(s), body: { name: 'Nope' } }),
        await call('DELETE', `/people/departments/${d}`, as(s)),
        await call('GET', `/people/departments/${d}/usage`, as(s)),
        await call('POST', '/people/teams', { ...as(s), body: { departmentId: d, name: 'Nope' } }),
        await call('PATCH', `/people/teams/${t}`, { ...as(s), body: { name: 'Nope' } }),
        await call('DELETE', `/people/teams/${t}`, as(s)),
        await call('GET', `/people/teams/${t}/usage`, as(s)),
        await call('GET', `/people/teams/${t}/lead-preview?leadEmployeeId=${target}`, as(s)),
        await call('POST', '/people/assignments/preview', { ...as(s), body: { departmentId: d, employeeIds: [target] } }),
        await call('POST', '/people/assignments', { ...as(s), body: { departmentId: d, employeeIds: [target] } }),
        await call('POST', '/people/reporting-lines', { ...as(s), body: { employeeIds: [target], managerId: null } }),
      ];
      expect(tries.map((r) => r.status), s.name).toEqual(tries.map(() => 403));
    }
    expect((await row(target)).department_id).toBeNull();
  });

  it('only Admins put people, themselves included, in a department or team', async () => {
    const d = await department('Own dept');
    expect((await call('POST', '/people/assignments', { ...as(pay), body: { departmentId: d, employeeIds: [id.pay] } })).status).toBe(403);
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, employeeIds: [id.hr] } }, 200);
    await ok('POST', '/people/assignments', { ...as(owner), body: { departmentId: d, employeeIds: [id.owner] } }, 200);
    expect((await row(id.owner)).department_id).toBe(d);
    expect((await row(id.hr)).department_id).toBe(d);
  });
});

describe('uniqueness and validation (spec 6.2)', () => {
  it('department names (trimmed, any case) and codes are unique; team names within a department', async () => {
    const a = await department('Finance', { code: 'FIN' });
    const b = await department('Sales');
    const dup = await call('POST', '/people/departments', { ...as(hr), body: { name: ' finance ' } });
    expect(dup).toMatchObject({ status: 409, body: { message: 'A department with this name already exists' } });
    expect((await call('POST', '/people/departments', { ...as(hr), body: { name: 'Other', code: 'fin' } })).body.message).toBe('A department with this code already exists');
    expect((await call('PATCH', `/people/departments/${b}`, { ...as(hr), body: { name: 'FINANCE' } })).status).toBe(409);

    await team(a, 'North');
    expect((await call('POST', '/people/teams', { ...as(hr), body: { departmentId: a, name: 'north' } })).body.message).toBe('This department already has a team with this name');
    const southInB = await team(b, 'North'); // the same name in another department is fine
    // Moving it next to its namesake is refused, and nothing moves.
    expect((await call('PATCH', `/people/teams/${southInB}`, { ...as(hr), body: { departmentId: a } })).status).toBe(409);

    expect((await call('POST', '/people/departments', { ...as(hr), body: { name: 'x'.repeat(101) } })).status).toBe(400);
    expect((await call('POST', '/people/departments', { ...as(hr), body: { name: '   ' } })).status).toBe(400);
    expect((await call('POST', '/people/departments', { ...as(hr), body: { name: 'Long code', code: 'C'.repeat(21) } })).status).toBe(400);
    expect((await call('POST', '/people/teams', { ...as(hr), body: { departmentId: '00000000-0000-4000-8000-000000000000', name: 'Orphan' } })).status).toBe(400);
  });

  it('a head or lead must be an active employee', async () => {
    const left = await person('Gone', 'Head');
    await asTenantSql(tenant, `update employees set deactivated_at = now(), employment_end_date = current_date where id = $1`, [left]);
    const refused = await call('POST', '/people/departments', { ...as(hr), body: { name: 'Headless', headEmployeeId: left } });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('The department head must be an active employee: Gone Head has left the company');
    const d = await department('Headless');
    expect((await call('POST', '/people/teams', { ...as(hr), body: { departmentId: d, name: 'T', leadEmployeeId: '00000000-0000-4000-8000-000000000000' } })).status).toBe(400);
  });
});

describe('delete rules (spec 6.3)', () => {
  it('a department with teams is refused, naming them; a deleted team leaves its members in the department', async () => {
    const d = await department('Logistics');
    const t1 = await team(d, 'Trucks');
    await team(d, 'Warehouse');
    const ana = await person('Ana', 'Logistic');
    const bob = await person('Bob', 'Logistic');
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, teamId: t1, employeeIds: [ana, bob] } }, 200);

    const usage = await ok('GET', `/people/departments/${d}/usage`, as(hr));
    expect(usage).toMatchObject({ name: 'Logistics', usedBy: [], teams: [{ name: 'Trucks' }, { name: 'Warehouse' }] });
    expect(usage.members.map((m: { fullName: string }) => m.fullName)).toEqual(['Ana Logistic', 'Bob Logistic']);
    const refused = await call('DELETE', `/people/departments/${d}`, as(hr));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Logistics has 2 teams (Trucks, Warehouse). Delete them or move them to another department first.');

    expect((await ok('GET', `/people/teams/${t1}/usage`, as(hr))).members.map((m: { fullName: string }) => m.fullName)).toEqual(['Ana Logistic', 'Bob Logistic']);
    await ok('DELETE', `/people/teams/${t1}`, as(hr));
    expect(await row(ana)).toMatchObject({ department_id: d, team_id: null });

    const rest = (await ok('GET', `/people/departments/${d}/usage`, as(hr))).teams;
    await ok('DELETE', `/people/teams/${rest[0].id}`, as(hr));
    await ok('DELETE', `/people/departments/${d}`, as(hr));
    expect(await row(ana)).toMatchObject({ department_id: null, team_id: null });
    expect((await call('DELETE', `/people/departments/${d}`, as(hr))).status).toBe(404);
  });
});

describe('an employee never has a team of another department (AC 6.4.2)', () => {
  it('is refused by every path that sets a team, and by the database', async () => {
    const a = await department('Alpha dept');
    const b = await department('Beta dept');
    const teamB = await team(b, 'Beta team');
    const e = await person('Cross', 'Over', { departmentId: a });

    const card = await call('PATCH', `/people/employees/${e}`, { ...as(hr), body: { departmentId: a, teamId: teamB } });
    expect(card).toMatchObject({ status: 400, body: { message: 'The team belongs to another department' } });
    expect((await call('POST', '/people/employees', { ...as(hr), body: { firstName: 'New', lastName: 'Cross', employmentStartDate: START, departmentId: a, teamId: teamB } })).status).toBe(400);
    expect((await call('POST', '/people/assignments', { ...as(hr), body: { departmentId: a, teamId: teamB, employeeIds: [e] } })).body.message).toBe('The team belongs to another department');
    expect((await call('POST', '/people/assignments/preview', { ...as(hr), body: { departmentId: a, teamId: teamB, employeeIds: [e] } })).status).toBe(400);
    expect(await row(e)).toMatchObject({ department_id: a, team_id: null });

    // Even a direct write as the runtime role fails on the team-in-department key.
    await expect(asTenantSql(tenant, `update employees set team_id = $2 where id = $1`, [e, teamB])).rejects.toMatchObject({ code: '23503' });
    // Choosing only the team takes its department along.
    await ok('PATCH', `/people/employees/${e}`, { ...as(hr), body: { teamId: teamB } });
    expect(await row(e)).toMatchObject({ department_id: b, team_id: teamB });
    const [mismatch] = await asTenantSql<{ n: number }>(tenant, `select count(*)::int as n from employees e join teams t on t.id = e.team_id where t.department_id <> e.department_id`);
    expect(mismatch!.n).toBe(0);
  });
});

describe('moving a team (AC 6.4.3)', () => {
  it("moves its members' department in the same transaction, and counts them", async () => {
    const from = await department('Move from');
    const to = await department('Move to');
    const t = await team(from, 'Movers');
    const [x, y, z] = [await person('Mover', 'One'), await person('Mover', 'Two'), await person('Mover', 'Three')];
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: from, teamId: t, employeeIds: [x, y, z] } }, 200);
    await asTenantSql(tenant, `update employees set deactivated_at = now(), employment_end_date = current_date where id = $1`, [z]);

    const moved = await ok('PATCH', `/people/teams/${t}`, { ...as(hr), body: { departmentId: to } });
    expect(moved).toMatchObject({ team: { departmentId: to }, moved: 2 });
    for (const e of [x, y, z]) expect(await row(e)).toMatchObject({ department_id: to, team_id: t });
    const counts = await ok('GET', '/people/departments', as(hr));
    expect(counts.find((d: { id: string }) => d.id === from)).toMatchObject({ teams: 0, activeEmployees: 0 });
    expect(counts.find((d: { id: string }) => d.id === to)).toMatchObject({ teams: 1, activeEmployees: 2 });

    // A refused move (a team of that name is there already) moves nobody.
    await team(from, 'Movers');
    expect((await call('PATCH', `/people/teams/${t}`, { ...as(hr), body: { departmentId: from, name: 'Movers' } })).status).toBe(409);
    expect(await row(x)).toMatchObject({ department_id: to, team_id: t });
  });
});

describe('"Add people" (spec 6.3)', () => {
  it('shows where people move from and prefills the manager: the team lead, else the department head', async () => {
    const d = await department('Support', { headEmployeeId: id.mgr });
    const led = await team(d, 'Support A');
    const unled = await team(d, 'Support B');
    const lead = await person('Lea', 'Lead');
    await ok('PATCH', `/people/teams/${led}`, { ...as(hr), body: { leadEmployeeId: lead } });
    const other = await department('Elsewhere');
    const otherTeam = await team(other, 'Elsewhere team');
    const free = await person('Free', 'Agent');
    const managed = await person('Has', 'Manager', { managerId: id.owner });
    const mover = await person('Moving', 'Person');
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: other, teamId: otherTeam, employeeIds: [mover] } }, 200);

    const { employees } = await ok('POST', '/people/assignments/preview', { ...as(hr), body: { departmentId: d, teamId: led, employeeIds: [free, managed, mover, lead] } }, 200);
    const by = Object.fromEntries(employees.map((e: { id: string }) => [e.id, e]));
    expect(by[free]).toMatchObject({ moves: true, teamName: null, suggestedManagerId: lead, suggestedManagerName: 'Lea Lead' });
    expect(by[managed]).toMatchObject({ suggestedManagerId: null, managerName: owner.name });
    expect(by[mover]).toMatchObject({ moves: true, teamId: otherTeam, teamName: 'Elsewhere team', suggestedManagerId: lead });
    // The lead themselves gets the department head instead.
    expect(by[lead]).toMatchObject({ suggestedManagerId: id.mgr, suggestedManagerName: mgr.name });
    const toUnled = await ok('POST', '/people/assignments/preview', { ...as(hr), body: { departmentId: d, teamId: unled, employeeIds: [free] } }, 200);
    expect(toUnled.employees[0]).toMatchObject({ suggestedManagerId: id.mgr });

    // Saving with the suggestion as the user left it (changed for one, kept for another).
    const saved = await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, teamId: led, employeeIds: [free, mover], managers: { [free]: lead, [mover]: id.mgr } } }, 200);
    expect(saved).toMatchObject({ updated: 2 });
    expect(saved.managersChanged.sort()).toEqual([free, mover].sort());
    expect(await row(free)).toMatchObject({ department_id: d, team_id: led, manager_id: lead });
    expect(await row(mover)).toMatchObject({ department_id: d, team_id: led, manager_id: id.mgr });
    // Nobody else's manager changed by adding them.
    expect((await row(managed)).manager_id).toBe(id.owner);
  });

  it('adding to a department keeps a team of that department and drops a team of another', async () => {
    const d = await department('Keep dept');
    const t = await team(d, 'Keep team');
    const other = await department('Drop dept');
    const ot = await team(other, 'Drop team');
    const keep = await person('Keeps', 'Team');
    const drop = await person('Drops', 'Team');
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, teamId: t, employeeIds: [keep] } }, 200);
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: other, teamId: ot, employeeIds: [drop] } }, 200);
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, employeeIds: [keep, drop] } }, 200);
    expect(await row(keep)).toMatchObject({ department_id: d, team_id: t });
    expect(await row(drop)).toMatchObject({ department_id: d, team_id: null });
    // Managers only for the people being added.
    expect((await call('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, employeeIds: [keep], managers: { [drop]: id.mgr } } })).status).toBe(400);
  });
});

describe('team lead: "Make team members report to <lead>" (AC 6.4.4)', () => {
  it('changes only members without a manager or reporting to the previous lead, and respects the cycle rule', async () => {
    const d = await department('Lead dept');
    const t = await team(d, 'Lead team');
    const previous = await person('Prev', 'Lead');
    const lead = await person('New', 'Lead');
    const boss = await person('Big', 'Boss'); // in the team, no manager, and above the new lead
    const none = await person('No', 'Manager');
    const ofPrevious = await person('Of', 'Previous');
    const ofOther = await person('Of', 'Other');
    const outsider = await person('Not', 'Member');
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, teamId: t, employeeIds: [lead, boss, none, ofPrevious, ofOther] } }, 200);
    await ok('PATCH', `/people/teams/${t}`, { ...as(hr), body: { leadEmployeeId: previous } });
    await ok('POST', '/people/reporting-lines', { ...as(hr), body: { employeeIds: [ofPrevious], managerId: previous } }, 200);
    await ok('POST', '/people/reporting-lines', { ...as(hr), body: { employeeIds: [ofOther], managerId: id.mgr } }, 200);
    await ok('POST', '/people/reporting-lines', { ...as(hr), body: { employeeIds: [lead], managerId: boss } }, 200);

    // The previous lead was put in the team (CD-225) and has no manager, so they would report to the new lead too.
    expect(await row(previous)).toMatchObject({ department_id: d, team_id: t });
    const preview = await ok('GET', `/people/teams/${t}/lead-preview?leadEmployeeId=${lead}`, as(hr));
    expect(preview.members.map((m: { id: string }) => m.id).sort()).toEqual([none, ofPrevious, previous].sort());
    expect(preview.loops).toEqual([{ id: boss, fullName: 'Big Boss', message: 'This would create a loop: Big Boss → New Lead → Big Boss' }]);

    // Setting a lead alone changes nobody's manager.
    const quiet = await ok('PATCH', `/people/teams/${t}`, { ...as(hr), body: { leadEmployeeId: ofOther } });
    expect(quiet.reassigned).toEqual([]);
    expect((await row(none)).manager_id).toBeNull();
    await ok('PATCH', `/people/teams/${t}`, { ...as(hr), body: { leadEmployeeId: previous } });

    const saved = await ok('PATCH', `/people/teams/${t}`, { ...as(hr), body: { leadEmployeeId: lead, makeMembersReport: true } });
    expect(saved.team).toMatchObject({ leadEmployeeId: lead, leadOutside: false });
    expect(saved.reassigned.sort()).toEqual([none, ofPrevious, previous].sort());
    expect(saved.loops.map((l: { id: string }) => l.id)).toEqual([boss]);
    expect((await row(none)).manager_id).toBe(lead);
    expect((await row(ofPrevious)).manager_id).toBe(lead);
    expect((await row(ofOther)).manager_id).toBe(id.mgr);
    expect((await row(boss)).manager_id).toBeNull();
    expect((await row(lead)).manager_id).toBe(boss);
    expect((await row(outsider)).manager_id).toBeNull();
  });

  it("only Admins set a lead; an Admin may make themselves the members' manager that way", async () => {
    const d = await department('Self lead dept');
    const t = await team(d, 'Self lead team');
    const member = await person('Team', 'Member');
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, teamId: t, employeeIds: [member] } }, 200);
    expect((await call('PATCH', `/people/teams/${t}`, { ...as(pay), body: { leadEmployeeId: id.pay, makeMembersReport: true } })).status).toBe(403);
    expect((await row(member)).manager_id).toBeNull();
    await ok('PATCH', `/people/teams/${t}`, { ...as(hr), body: { leadEmployeeId: id.hr, makeMembersReport: true } });
    expect((await row(member)).manager_id).toBe(id.hr);
    expect(await row(id.hr)).toMatchObject({ department_id: d, team_id: t });
  });
});

describe('heads and leads belong where they head (CD-225)', () => {
  it('making someone head puts them in the department; a lead in the team and its department', async () => {
    const sales = await department('Head sales');
    const other = await department('Head other');
    const otherTeam = await team(other, 'Head other team');
    const ana = await person('Ana', 'Header', { departmentId: other, teamId: otherTeam });
    await ok('PATCH', `/people/departments/${sales}`, { ...as(hr), body: { headEmployeeId: ana } });
    expect(await row(ana)).toMatchObject({ department_id: sales, team_id: null });
    const { entries } = await ok('GET', `/people/history?entityType=employee&entityId=${ana}`, as(hr));
    expect(entries.map((e: { field: string | null }) => e.field)).toEqual(expect.arrayContaining(['departmentId', 'teamId']));

    const bo = await person('Bo', 'Leader');
    const created = await ok('POST', '/people/teams', { ...as(hr), body: { departmentId: sales, name: 'Head south', leadEmployeeId: bo } });
    expect(created.team.leadOutside).toBe(false);
    expect(await row(bo)).toMatchObject({ department_id: sales, team_id: created.team.id });

    const cy = await person('Cy', 'Founder');
    const fresh = await ok('POST', '/people/departments', { ...as(hr), body: { name: 'Head new', headEmployeeId: cy } });
    expect(fresh.activeEmployees).toBe(1);
    expect((await row(cy)).department_id).toBe(fresh.id);
    // The head is shown once: in the department, not in a team box (the chart reads team_id).
    expect((await ok('GET', '/people/employees', as(emp))).employees.find((e: { id: string }) => e.id === cy)).toMatchObject({ departmentId: fresh.id, teamId: null });
  });

  it('moving a head or lead elsewhere is a 409 heads_department until confirmed with clearHeadRoles', async () => {
    const service = await department('Move service');
    const sales = await department('Move sales');
    const st = await team(sales, 'Move sales team');
    const ana = await person('Ana', 'Mover');
    await ok('PATCH', `/people/departments/${sales}`, { ...as(hr), body: { headEmployeeId: ana } });

    // The card.
    const refused = await call('PATCH', `/people/employees/${ana}`, { ...as(hr), body: { departmentId: service } });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'heads_department', message: 'Ana Mover is head of Move sales. Moving them to Move service removes them as head of Move sales.' });
    expect((await row(ana)).department_id).toBe(sales);
    // Within the department (into one of its teams) they stay its head.
    await ok('PATCH', `/people/employees/${ana}`, { ...as(hr), body: { teamId: st } });
    const moved = await ok('PATCH', `/people/employees/${ana}`, { ...as(hr), body: { departmentId: service, clearHeadRoles: true } });
    expect(moved).toMatchObject({ departmentId: service, teamId: null, headsDepartments: [] });
    expect((await ok('GET', '/people/departments', as(hr))).find((x: { id: string }) => x.id === sales).headEmployeeId).toBeNull();

    // "Add people" and heading another department ask the same way.
    const bo = await person('Bo', 'Mover');
    await ok('PATCH', `/people/teams/${st}`, { ...as(hr), body: { leadEmployeeId: bo } });
    expect(await row(bo)).toMatchObject({ department_id: sales, team_id: st });
    const assign = await call('POST', '/people/assignments', { ...as(hr), body: { departmentId: service, employeeIds: [bo] } });
    expect(assign).toMatchObject({ status: 409, body: { code: 'heads_department', message: 'Bo Mover is lead of Move sales team. Moving them to Move service removes them as lead of Move sales team.' } });
    expect((await call('PATCH', `/people/departments/${service}`, { ...as(hr), body: { headEmployeeId: bo } })).status).toBe(409);
    expect((await row(bo)).team_id).toBe(st);
    await ok('PATCH', `/people/departments/${service}`, { ...as(hr), body: { headEmployeeId: bo, clearHeadRoles: true } });
    expect(await row(bo)).toMatchObject({ department_id: service, team_id: null });
    expect((await ok('GET', '/people/teams', as(hr))).find((x: { id: string }) => x.id === st).leadEmployeeId).toBeNull();
  });
});

describe('live updates (AC 6.4.5)', () => {
  const streams: { close: () => void }[] = [];
  afterAll(() => streams.forEach((s) => s.close()));

  it('other viewers get department, team and employee hints (ids only)', async () => {
    const stream = await openStream(emp);
    streams.push(stream);
    const d = await department('Live dept');
    await stream.waitFor((e) => e.type === 'department' && !!e.ids?.includes(d));
    const t = await team(d, 'Live team');
    await stream.waitFor((e) => e.type === 'team' && !!e.ids?.includes(t));
    const e = await person('Live', 'Member');
    await ok('POST', '/people/assignments', { ...as(hr), body: { departmentId: d, teamId: t, employeeIds: [e] } }, 200);
    await stream.waitFor((x) => x.type === 'employee' && !!x.ids?.includes(e));
    const to = await department('Live dept 2');
    stream.events.length = 0;
    await ok('PATCH', `/people/teams/${t}`, { ...as(hr), body: { departmentId: to } });
    await stream.waitFor((x) => x.type === 'team' && !!x.ids?.includes(t));
    await stream.waitFor((x) => x.type === 'employee' && !!x.ids?.includes(e));
    expect(JSON.stringify(stream.events)).not.toContain('Live dept');
  });
});

interface ChangeEvent {
  type: string;
  ids?: string[] | null;
}

/** The workspace's change stream as `s` sees it (like events.spec.ts). */
async function openStream(s: Session) {
  const abort = new AbortController();
  const res = await fetch(`${inject('apiUrl')}/api/events`, { headers: { authorization: `Bearer ${s.token}`, 'x-tenant-id': tenant }, signal: abort.signal });
  expect(res.status).toBe(200);
  const events: ChangeEvent[] = [];
  let ready = false;
  let buffer = '';
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (type === 'ready') ready = true;
          if (type === 'change' && data) events.push(JSON.parse(data) as ChangeEvent);
        }
      }
    } catch {
      // aborted
    }
  })();
  const waitFor = async (predicate: (e: ChangeEvent) => boolean, ms = 5_000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`No matching event within ${ms} ms; got ${JSON.stringify(events)}`);
  };
  const deadline = Date.now() + 5_000;
  while (!ready && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  expect(ready).toBe(true);
  return { events, waitFor, close: () => abort.abort() };
}
