/**
 * Organization levels and units (CD-226; departments and teams before, CD-138): levels (rename,
 * reorder, add, remove only when empty), units (create, rename, move with the parent-level and
 * loop rules, delete rules, leads), the automatic managers (unit set, manager set, lead set, CEO
 * set) through the card, the bulk actions, "Add people" and the chart's drag, moving a lead (409
 * heads_unit), who may change what (Admins only), the conversion of departments and teams, and
 * live updates. `hr` is a workspace admin; `emp` and `mgr` are members.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { call, createTenant, ok, type Session, signIn } from './helpers';
import { addEmployee, asTenantSql, joinAsEmployee } from './people-helpers';

let owner: Session;
let hr: Session;
let mgr: Session;
let emp: Session;
let tenant: string;
const id = {} as Record<'owner' | 'hr' | 'mgr' | 'emp', string>;
const as = (s: Session = owner, t = tenant) => ({ token: s.token, tenant: t });

interface Level {
  id: string;
  name: string;
  position: number;
  units: number;
}
interface Unit {
  id: string;
  levelId: string;
  parentId: string | null;
  name: string;
  leadEmployeeId: string | null;
  members: number;
  units: number;
}

const person = (firstName: string, lastName: string, extra: Record<string, unknown> = {}, t = tenant) => addEmployee(owner, t, { firstName, lastName, ...extra });
const levels = async (t = tenant) => (await ok<Level[]>('GET', '/people/org-levels', as(owner, t))).sort((a, b) => a.position - b.position);
const units = async (t = tenant) => ok<Unit[]>('GET', '/people/org-units', as(owner, t));
const unitOf = async (unitId: string, t = tenant) => (await units(t)).find((u) => u.id === unitId)!;
const createUnit = async (levelId: string, name: string, extra: Record<string, unknown> = {}, t = tenant) =>
  (await ok('POST', '/people/org-units', { ...as(hr, t), body: { levelId, name, ...extra } })).unit as Unit;
const card = async (who: string, t = tenant) => ok('GET', `/people/employees/${who}`, as(owner, t));
const row = async (who: string, t = tenant) =>
  (await asTenantSql<{ unit_id: string | null; manager_id: string | null }>(t, `select unit_id, manager_id from employees where id = $1`, [who]))[0]!;

beforeAll(async () => {
  [owner, hr, mgr, emp] = (await Promise.all(['ou-owner', 'ou-hr', 'ou-mgr', 'ou-emp'].map((l) => signIn(l)))) as [Session, Session, Session, Session];
  tenant = await createTenant(owner, 'Org units');
  id.owner = (await ok('GET', '/people/access', as(owner))).employeeId;
  id.hr = await joinAsEmployee(owner, tenant, hr, 'admin');
  id.mgr = await joinAsEmployee(owner, tenant, mgr);
  id.emp = await joinAsEmployee(owner, tenant, emp);
});

describe('levels (Settings → Employees)', () => {
  it('start as Department and Team; Admins add (up to five), rename and reorder; members only read', async () => {
    const t = await createTenant(owner, 'Levels');
    expect((await levels(t)).map((l) => [l.name, l.position])).toEqual([
      ['Department', 1],
      ['Team', 2],
    ]);
    // A new level on top: the others move down.
    const added = await ok<Level[]>('POST', '/people/org-levels', { ...as(owner, t), body: { name: ' Sector ', position: 1 } });
    expect(added.map((l) => l.name)).toEqual(['Sector', 'Department', 'Team']);
    const [sector, department, team] = added;
    expect((await call('POST', '/people/org-levels', { ...as(owner, t), body: { name: 'sector' } })).status).toBe(409);
    await ok('PATCH', `/people/org-levels/${department!.id}`, { ...as(owner, t), body: { name: 'Division' } });
    await ok('POST', '/people/org-levels', { ...as(owner, t), body: { name: 'Squad' } });
    expect((await levels(t)).map((l) => l.name)).toEqual(['Sector', 'Division', 'Team', 'Squad']);
    const reordered = await ok<Level[]>('PUT', '/people/org-levels/order', { ...as(owner, t), body: { ids: (await levels(t)).map((l) => l.id).reverse() } });
    expect(reordered.map((l) => l.name)).toEqual(['Squad', 'Team', 'Division', 'Sector']);
    // Every level once.
    expect((await call('PUT', '/people/org-levels/order', { ...as(owner, t), body: { ids: [sector!.id] } })).status).toBe(400);
    await ok('POST', '/people/org-levels', { ...as(owner, t), body: { name: 'Pod' } });
    const sixth = await call('POST', '/people/org-levels', { ...as(owner, t), body: { name: 'Too many' } });
    expect(sixth.status).toBe(409);
    expect(sixth.body.message).toBe('A workspace has at most 5 levels');
    // Removing an empty level moves the ones below up.
    const after = await ok<Level[]>('DELETE', `/people/org-levels/${team!.id}`, as(owner, t), 200);
    expect(after.map((l) => [l.name, l.position])).toEqual([
      ['Squad', 1],
      ['Division', 2],
      ['Sector', 3],
      ['Pod', 4],
    ]);
  });

  it('a level with units can not be removed, the last level neither, and a reorder must keep parents above', async () => {
    const t = await createTenant(owner, 'Levels kept');
    const [department, team] = await levels(t);
    const sales = (await ok('POST', '/people/org-units', { ...as(owner, t), body: { levelId: department!.id, name: 'Sales' } })).unit.id as string;
    await ok('POST', '/people/org-units', { ...as(owner, t), body: { levelId: team!.id, parentId: sales, name: 'North' } });
    const refused = await call('DELETE', `/people/org-levels/${team!.id}`, as(owner, t));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Team has 1 unit. Delete them or move them first.');
    const upside = await call('PUT', '/people/org-levels/order', { ...as(owner, t), body: { ids: [team!.id, department!.id] } });
    expect(upside.status).toBe(409);
    expect(upside.body.message).toBe('North is inside Sales, so Team must stay below Department. Move the unit first.');
    const extra = (await ok<Level[]>('POST', '/people/org-levels', { ...as(owner, t), body: { name: 'Extra' } })).find((l) => l.name === 'Extra')!;
    await ok('DELETE', `/people/org-levels/${extra.id}`, as(owner, t), 200);
    // The last level stays.
    const only = await createTenant(owner, 'One level');
    const [first, second] = await levels(only);
    await ok('DELETE', `/people/org-levels/${second!.id}`, as(owner, only), 200);
    const last = await call('DELETE', `/people/org-levels/${first!.id}`, as(owner, only));
    expect(last.status).toBe(409);
    expect(last.body.message).toBe('Keep at least one level');
  });

  it('only Admins change levels; every member reads them', async () => {
    const [department] = await levels();
    expect((await ok<Level[]>('GET', '/people/org-levels', as(emp))).length).toBe(2);
    for (const s of [emp, mgr]) {
      expect((await call('POST', '/people/org-levels', { ...as(s), body: { name: 'Nope' } })).status).toBe(403);
      expect((await call('PATCH', `/people/org-levels/${department!.id}`, { ...as(s), body: { name: 'Nope' } })).status).toBe(403);
      expect((await call('PUT', '/people/org-levels/order', { ...as(s), body: { ids: [department!.id] } })).status).toBe(403);
      expect((await call('DELETE', `/people/org-levels/${department!.id}`, as(s))).status).toBe(403);
    }
  });
});

describe('units', () => {
  it('Admins create, rename, move and delete; the parent must be of a higher level; history keeps the old name', async () => {
    const [department, team] = await levels();
    const service = await createUnit(department!.id, '  Service ', { code: 'SRV' });
    expect(service).toMatchObject({ name: 'Service', parentId: null, leadEmployeeId: null, members: 0, units: 0 });
    const north = await createUnit(team!.id, 'North', { parentId: service.id });
    expect(north.parentId).toBe(service.id);
    // Same name in the same parent: 409; elsewhere fine.
    expect((await call('POST', '/people/org-units', { ...as(hr), body: { levelId: team!.id, parentId: service.id, name: 'NORTH' } })).status).toBe(409);
    const other = await createUnit(department!.id, 'Logistics');
    await createUnit(team!.id, 'North', { parentId: other.id });
    // A Department inside a Team, or a Team inside a Team: refused.
    const wrong = await call('POST', '/people/org-units', { ...as(hr), body: { levelId: department!.id, parentId: north.id, name: 'Upside' } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe('A Department can only be inside a unit of a higher level: North is a Team');
    // Moving a unit inside itself or a unit inside it: refused.
    const loop = await call('PATCH', `/people/org-units/${service.id}`, { ...as(hr), body: { parentId: north.id } });
    expect(loop.status).toBe(400);
    expect(loop.body.message).toBe("A unit can't be inside itself or one of its own units");
    // Rename and move a team to another department.
    await ok('PATCH', `/people/org-units/${north.id}`, { ...as(hr), body: { name: 'North field' } });
    const moved = await ok('PATCH', `/people/org-units/${north.id}`, { ...as(hr), body: { parentId: (await createUnit(department!.id, 'Field')).id } });
    expect(moved.unit).toMatchObject({ name: 'North field' });
    const { entries } = await ok('GET', `/people/history?entityType=org_unit&entityId=${north.id}`, as(hr));
    expect(entries.find((e: { field: string }) => e.field === 'name')).toMatchObject({ oldValue: 'North', newValue: 'North field' });
    expect(entries.find((e: { field: string }) => e.field === 'parentId')).toMatchObject({ oldLabel: 'Service', newLabel: 'Field' });
    // Everyone reads them.
    expect((await ok<Unit[]>('GET', '/people/org-units', as(emp))).some((u) => u.id === north.id)).toBe(true);
  });

  it('a unit with units inside can not be deleted (naming them); otherwise its members end up without a unit', async () => {
    const [department, team] = await levels();
    const ops = await createUnit(department!.id, 'Operations');
    const a = await createUnit(team!.id, 'Alpha', { parentId: ops.id });
    await createUnit(team!.id, 'Beta', { parentId: ops.id });
    const refused = await call('DELETE', `/people/org-units/${ops.id}`, as(hr));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Operations has 2 units (Alpha and Beta). Move or delete them first.');
    const member = await person('Ana', 'Alpha', { unitId: a.id });
    const usage = await ok('GET', `/people/org-units/${a.id}/usage`, as(hr));
    expect(usage).toMatchObject({ name: 'Alpha', units: [], usedBy: [], members: [{ id: member, fullName: 'Ana Alpha' }] });
    await ok('DELETE', `/people/org-units/${a.id}`, as(hr));
    expect(await row(member)).toMatchObject({ unit_id: null });
    expect((await units()).some((u) => u.id === a.id)).toBe(false);
  });

  it('only Admins change units and put people in them', async () => {
    const [department] = await levels();
    const u = await createUnit(department!.id, 'Locked');
    const target = await person('Target', 'Person');
    for (const s of [emp, mgr]) {
      const tries = [
        await call('POST', '/people/org-units', { ...as(s), body: { levelId: department!.id, name: 'Nope' } }),
        await call('PATCH', `/people/org-units/${u.id}`, { ...as(s), body: { name: 'Nope' } }),
        await call('DELETE', `/people/org-units/${u.id}`, as(s)),
        await call('GET', `/people/org-units/${u.id}/usage`, as(s)),
        await call('GET', `/people/org-units/${u.id}/lead-preview?leadEmployeeId=${target}`, as(s)),
        await call('POST', '/people/assignments', { ...as(s), body: { unitId: u.id, employeeIds: [target] } }),
        await call('PATCH', `/people/employees/${target}`, { ...as(s), body: { unitId: u.id } }),
        await call('POST', '/people/employees/bulk', { ...as(s), body: { employeeIds: [target], unitId: u.id } }),
      ];
      expect(tries.map((r) => r.status)).toEqual(tries.map(() => 403));
    }
    expect(await row(target)).toMatchObject({ unit_id: null });
  });
});

describe('automatic managers (CD-226)', () => {
  // A workspace with only a CEO: Sales (lead Lena) → Inside (lead Ivo); Service has no lead.
  let ws: string;
  const p = {} as Record<'ceo' | 'lena' | 'ivo' | 'nora' | 'olja' | 'pera' | 'raka' | 'sava' | 'tea', string>;
  const u = {} as Record<'sales' | 'inside' | 'service', string>;
  let levelIds: string[];
  const asWs = (s: Session = owner) => as(s, ws);

  beforeAll(async () => {
    ws = await createTenant(owner, 'Org rules');
    levelIds = (await levels(ws)).map((l) => l.id);
    for (const [key, first] of [
      ['ceo', 'Cera'],
      ['lena', 'Lena'],
      ['ivo', 'Ivo'],
      ['nora', 'Nora'],
      ['olja', 'Olja'],
      ['pera', 'Pera'],
      ['raka', 'Raka'],
      ['sava', 'Sava'],
      ['tea', 'Tea'],
    ] as const) {
      p[key] = await person(first, 'Rules', {}, ws);
    }
    await ok('PATCH', '/workspace', { ...asWs(), body: { ceoEmployeeId: p.ceo } });
  });

  it('a new lead joins the unit and reports to the nearest lead above, else the CEO (the issue: a CEO-only org)', async () => {
    const sales = await ok('POST', '/people/org-units', { ...asWs(), body: { levelId: levelIds[0], name: 'Sales', leadEmployeeId: p.lena } });
    u.sales = sales.unit.id;
    expect(sales.unit.leadEmployeeId).toBe(p.lena);
    expect(await row(p.lena, ws)).toEqual({ unit_id: u.sales, manager_id: p.ceo });
    expect(sales.managersChanged).toEqual([p.lena]);
    const inside = await ok('POST', '/people/org-units', { ...asWs(), body: { levelId: levelIds[1], parentId: u.sales, name: 'Inside', leadEmployeeId: p.ivo } });
    u.inside = inside.unit.id;
    expect(await row(p.ivo, ws)).toEqual({ unit_id: u.inside, manager_id: p.lena });
    u.service = (await ok('POST', '/people/org-units', { ...asWs(), body: { levelId: levelIds[0], name: 'Service' } })).unit.id;
    expect((await card(p.lena, ws)).leadsUnit).toEqual({ id: u.sales, name: 'Sales' });
  });

  it("setting a unit makes its lead the manager, else the nearest lead above, else the CEO (the card)", async () => {
    const saved = await ok('PATCH', `/people/employees/${p.nora}`, { ...asWs(), body: { unitId: u.inside } });
    expect(saved).toMatchObject({ unitId: u.inside, unitName: 'Inside', managerId: p.ivo });
    await ok('PATCH', `/people/employees/${p.olja}`, { ...asWs(), body: { unitId: u.service } });
    expect(await row(p.olja, ws)).toEqual({ unit_id: u.service, manager_id: p.ceo });
    // Explicit wins: unit and manager in one change keep both.
    await ok('PATCH', `/people/employees/${p.pera}`, { ...asWs(), body: { unitId: u.inside, managerId: p.lena } });
    expect(await row(p.pera, ws)).toEqual({ unit_id: u.inside, manager_id: p.lena });
  });

  it('setting a manager puts the person in the unit the manager leads, else the manager’s own unit', async () => {
    await ok('PATCH', `/people/employees/${p.raka}`, { ...asWs(), body: { managerId: p.lena } });
    expect(await row(p.raka, ws)).toEqual({ unit_id: u.sales, manager_id: p.lena });
    await ok('PATCH', `/people/employees/${p.raka}`, { ...asWs(), body: { managerId: p.nora } });
    expect(await row(p.raka, ws)).toEqual({ unit_id: u.inside, manager_id: p.nora });
    // A loop is refused, naming it.
    const loop = await call('PATCH', `/people/employees/${p.ivo}`, { ...asWs(), body: { managerId: p.raka } });
    expect(loop.status).toBe(409);
    expect(loop.body).toMatchObject({ code: 'reporting_loop', message: 'This would create a loop: Ivo Rules → Raka Rules → Nora Rules → Ivo Rules' });
  });

  it('the same rules in bulk, "Add people" and the chart’s drag (a person dropped on a person)', async () => {
    // Bulk "Set unit": each gets the unit's lead.
    expect((await ok('POST', '/people/employees/bulk', { ...asWs(), body: { employeeIds: [p.sava, p.tea], unitId: u.sales } }, 200)).updated).toBe(2);
    expect(await row(p.sava, ws)).toEqual({ unit_id: u.sales, manager_id: p.lena });
    // Drag Tea onto Ivo: Ivo becomes the manager, Tea joins Inside.
    await ok('POST', '/people/employees/bulk', { ...asWs(), body: { employeeIds: [p.tea], managerId: p.ivo } }, 200);
    expect(await row(p.tea, ws)).toEqual({ unit_id: u.inside, manager_id: p.ivo });
    // "Add people" to Service (no lead): the CEO, except where a manager is given.
    const added = await ok('POST', '/people/assignments', { ...asWs(), body: { unitId: u.service, employeeIds: [p.sava, p.tea], managers: { [p.tea]: p.olja } } }, 200);
    expect(added.updated).toBe(2);
    expect(await row(p.sava, ws)).toEqual({ unit_id: u.service, manager_id: p.ceo });
    expect(await row(p.tea, ws)).toEqual({ unit_id: u.service, manager_id: p.olja });
    // "Set manager" (reporting lines) follows the manager's unit too.
    expect((await ok('POST', '/people/reporting-lines', { ...asWs(), body: { employeeIds: [p.sava], managerId: p.ivo } }, 200)).changed).toEqual([p.sava]);
    expect(await row(p.sava, ws)).toEqual({ unit_id: u.inside, manager_id: p.ivo });
  });

  it('a new lead: members who reported to the previous lead or nobody follow; the preview shows it', async () => {
    // Inside: Ivo (lead), Nora → Ivo, Raka → Nora, Pera → Lena, Sava → Ivo. Make Nora the lead.
    await ok('PATCH', `/people/employees/${p.raka}`, { ...asWs(), body: { managerId: null } });
    const preview = await ok('GET', `/people/org-units/${u.inside}/lead-preview?leadEmployeeId=${p.nora}`, asWs());
    expect(preview).toMatchObject({ managerId: p.lena, managerName: 'Lena Rules', loops: [], leavesUnit: null });
    expect(preview.members.map((m: { id: string }) => m.id).sort()).toEqual([p.raka, p.sava].sort());
    const saved = await ok('PATCH', `/people/org-units/${u.inside}`, { ...asWs(), body: { leadEmployeeId: p.nora } });
    expect(saved.unit.leadEmployeeId).toBe(p.nora);
    expect(await row(p.nora, ws)).toEqual({ unit_id: u.inside, manager_id: p.lena });
    expect((await row(p.sava, ws)).manager_id).toBe(p.nora);
    expect((await row(p.raka, ws)).manager_id).toBe(p.nora);
    // Pera reported to someone else: unchanged. Ivo (the previous lead) keeps his manager.
    expect((await row(p.pera, ws)).manager_id).toBe(p.lena);
    expect(await row(p.ivo, ws)).toEqual({ unit_id: u.inside, manager_id: p.lena });
  });

  it('a lead moved away (or made lead of another unit) is a 409 heads_unit until confirmed', async () => {
    const away = await call('PATCH', `/people/employees/${p.nora}`, { ...asWs(), body: { unitId: u.service } });
    expect(away.status).toBe(409);
    expect(away.body).toMatchObject({ code: 'heads_unit', message: 'Nora Rules is lead of Inside. Moving them to Service removes them as lead of Inside.' });
    const lead = await call('PATCH', `/people/org-units/${u.service}`, { ...asWs(), body: { leadEmployeeId: p.nora } });
    expect(lead.status).toBe(409);
    expect(lead.body.code).toBe('heads_unit');
    expect((await unitOf(u.inside, ws)).leadEmployeeId).toBe(p.nora);
    const preview = await ok('GET', `/people/org-units/${u.service}/lead-preview?leadEmployeeId=${p.nora}`, asWs());
    expect(preview.leavesUnit).toEqual({ id: u.inside, name: 'Inside' });
    await ok('PATCH', `/people/org-units/${u.service}`, { ...asWs(), body: { leadEmployeeId: p.nora, clearLeadRoles: true } });
    expect((await unitOf(u.inside, ws)).leadEmployeeId).toBeNull();
    expect(await row(p.nora, ws)).toEqual({ unit_id: u.service, manager_id: p.ceo });
    // Olja had no other manager than the CEO, not the previous lead: unchanged.
    expect((await row(p.olja, ws)).manager_id).toBe(p.ceo);
  });

  it('a new CEO reports to nobody and manages the top leads who had no manager or the previous CEO', async () => {
    await ok('PATCH', `/people/employees/${p.lena}`, { ...asWs(), body: { managerId: null } });
    // Tea (→ Olja → Cera) is above nobody in Sales.
    await ok('PATCH', '/workspace', { ...asWs(), body: { ceoEmployeeId: p.tea } });
    // The CEO reports to nobody (CD-228: the card showed Olja while the chart showed Tea on top).
    expect((await row(p.tea, ws)).manager_id).toBeNull();
    expect((await row(p.lena, ws)).manager_id).toBe(p.tea);
    // Nora (lead of Service) reported to the previous CEO: she follows the new one (CD-228).
    expect((await row(p.nora, ws)).manager_id).toBe(p.tea);
  });
});

describe('departments and teams become units (drizzle/0049)', () => {
  it('keeps ids, names, codes and leads; members get their team, else their department; leads join their unit', async () => {
    const t = await createTenant(owner, 'Conversion');
    const people = {} as Record<'head' | 'lead' | 'both' | 'member' | 'loose' | 'leaving', string>;
    for (const key of ['head', 'lead', 'both', 'member', 'loose', 'leaving'] as const) people[key] = await person(key[0]!.toUpperCase() + key.slice(1), 'Old', {}, t);
    const [d1] = await asTenantSql<{ id: string }>(t, `insert into departments (tenant_id, name, code, head_employee_id) values ($1, 'Sales', 'SLS', $2) returning id`, [t, people.head]);
    const [d2] = await asTenantSql<{ id: string }>(t, `insert into departments (tenant_id, name, head_employee_id) values ($1, 'Service', $2) returning id`, [t, people.both]);
    const [t1] = await asTenantSql<{ id: string }>(t, `insert into teams (tenant_id, department_id, name, lead_employee_id) values ($1, $2, 'North', $3) returning id`, [t, d1!.id, people.lead]);
    // Led by the head of Service as well: a person leads one unit, so this team gets no lead.
    const [t2] = await asTenantSql<{ id: string }>(t, `insert into teams (tenant_id, department_id, name, lead_employee_id) values ($1, $2, 'Repairs', $3) returning id`, [t, d2!.id, people.both]);
    await asTenantSql(t, `update employees set department_id = $2, team_id = $3 where id = $1`, [people.member, d1!.id, t1!.id]);
    await asTenantSql(t, `update employees set department_id = $2, team_id = $3 where id = $1`, [people.both, d2!.id, t2!.id]);
    await asTenantSql(t, `update employees set department_id = $2 where id = $1`, [people.loose, d2!.id]);
    await asTenantSql(
      t,
      `update employees set employment_end_date = current_date + 30, deactivation_plan = $2 where id = $1`,
      [people.leaving, JSON.stringify({ reportsManagerId: null, teamLeads: [{ teamId: t1!.id, employeeId: people.member }], departmentHeads: [], byUserId: owner.userId })],
    );

    await asTenantSql(t, `select people_units_from_departments($1)`, [t]);
    // Twice changes nothing.
    await asTenantSql(t, `select people_units_from_departments($1)`, [t]);

    const [department, team] = await levels(t);
    expect([department!.name, team!.name]).toEqual(['Department', 'Team']);
    const all = await units(t);
    expect(all.map((u) => [u.id, u.name, u.levelId, u.parentId, u.leadEmployeeId]).sort()).toEqual(
      [
        [d1!.id, 'Sales', department!.id, null, people.head],
        [d2!.id, 'Service', department!.id, null, people.both],
        [t1!.id, 'North', team!.id, d1!.id, people.lead],
        [t2!.id, 'Repairs', team!.id, d2!.id, null],
      ].sort(),
    );
    expect((await asTenantSql<{ code: string }>(t, `select code from org_units where id = $1`, [d1!.id]))[0]!.code).toBe('SLS');
    expect((await row(people.member, t)).unit_id).toBe(t1!.id);
    expect((await row(people.loose, t)).unit_id).toBe(d2!.id);
    // A head is in the unit they lead (they were in Repairs).
    expect((await row(people.both, t)).unit_id).toBe(d2!.id);
    expect((await row(people.lead, t)).unit_id).toBe(t1!.id);
    expect((await row(people.head, t)).unit_id).toBe(d1!.id);
    // Scheduled deactivations get unitLeads; the old keys stay for a rolled-back release.
    const [plan] = await asTenantSql<{ plan: Record<string, unknown> }>(t, `select deactivation_plan as plan from employees where id = $1`, [people.leaving]);
    expect(plan!.plan).toMatchObject({ unitLeads: [{ unitId: t1!.id, employeeId: people.member }], teamLeads: [{ teamId: t1!.id, employeeId: people.member }], departmentHeads: [] });
    // The old tables are untouched.
    expect((await asTenantSql(t, `select id from departments`)).length).toBe(2);
  });
});

describe('live updates', () => {
  const streams: { close: () => void }[] = [];
  afterAll(() => streams.forEach((s) => s.close()));

  it('other viewers get org_level, org_unit and employee hints (ids only)', async () => {
    const stream = await openStream(emp);
    streams.push(stream);
    const [department] = await levels();
    await ok('PATCH', `/people/org-levels/${department!.id}`, { ...as(hr), body: { name: 'Department' } });
    await stream.waitFor((e) => e.type === 'org_level' && !!e.ids?.includes(department!.id));
    const live = await createUnit(department!.id, 'Live unit');
    await stream.waitFor((e) => e.type === 'org_unit' && !!e.ids?.includes(live.id));
    const e = await person('Live', 'Member');
    await ok('POST', '/people/assignments', { ...as(hr), body: { unitId: live.id, employeeIds: [e] } }, 200);
    await stream.waitFor((x) => x.type === 'employee' && !!x.ids?.includes(e));
    expect(JSON.stringify(stream.events)).not.toContain('Live unit');
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
