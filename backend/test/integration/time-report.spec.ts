/**
 * Effective time and hour limits (CD-149, CD-248, CD-250): a task starts on its first entry; "Hour
 * limit almost reached" and "Hour limit reached" go once per crossing (to the person and the lead,
 * the reached one also to their manager) and again after dropping below; raising a limit clears the
 * alert at once; Block mode refuses hours past a limit with the hours left, also after a switch
 * from Warn; the time report's totals by level, entry states (a deleted entry, a line that isn't a
 * task), period, removed people and who sees what; the CSV export; the job handler on its own.
 * The performance target (TC 16) is test/performance/time-report.spec.ts.
 */
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { addMember, call, createTenant, eventually, mailTo, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

interface Node {
  kind: string;
  id: string;
  name: string;
  code: string | null;
  notAssigned?: boolean;
  limitMinutes: number | null;
  loggedMinutes: number;
  approvedMinutes: number;
  allTimeMinutes: number;
  remainingMinutes: number | null;
  usedPercent: number | null;
  flag: string | null;
  children: Node[];
}
interface Report {
  rows: Node[];
  total: Node;
}

let owner: Session;
let ana: Session;
let marko: Session;
let lena: Session;
let jovan: Session;
let vesna: Session;
let tenant: string;
const ids = {} as Record<'ana' | 'marko' | 'lena' | 'jovan', string>;
let companyId: string;
let projectId: string;
let task: { id: string; number: number };
let week: string;

const as = (s: Session = owner) => ({ token: s.token, tenant });
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const cell = (s: Session, day: number, minutes: number, taskId = task.id) => call('PUT', '/timesheet/cells', { ...as(s), body: { date: addDays(week, day), taskId, minutes } });
const level = async (employeeId = ids.ana, taskId = task.id) => (await asTenantSql<{ level: number }>(tenant, 'select level from task_limit_alerts where task_id = $1 and employee_id = $2', [taskId, employeeId]))[0]?.level ?? 0;
const reachLevel = (want: number) => eventually(async () => (await level()) === want || null, `alert level ${want}`);
const subjects = async (s: Session, prefix: string) => (await mailTo(owner, s.email)).filter((m) => m.subject === `${prefix}: T-${task.number} Hydraulic leak`);
const mailsReach = (s: Session, prefix: string, count: number) => eventually(async () => (await subjects(s, prefix)).length >= count || null, `${count}× "${prefix}" to ${s.name}`);
const report = (s: Session, query = '') => ok<Report>('GET', `/time-report?projectId=${projectId}${query}`, as(s));
const flat = (nodes: Node[]): Node[] => nodes.flatMap((n) => [n, ...flat(n.children)]);
/** Ana's row on the project as she sees it (her own hours only). */
const anaRow = async () => flat((await report(ana)).rows).find((n) => n.kind === 'person' && n.id === ids.ana)!;

beforeAll(async () => {
  [owner, ana, marko, lena, jovan, vesna] = await Promise.all([signIn('tr-owner'), signIn('tr-ana'), signIn('tr-marko'), signIn('tr-lena'), signIn('tr-jovan'), signIn('tr-vesna')]);
  tenant = await createTenant(owner, 'Time report');
  for (const s of [ana, marko, lena, jovan, vesna]) await addMember(owner, tenant, s, 'member');
  for (const [key, s] of [['ana', ana], ['marko', marko], ['lena', lena], ['jovan', jovan]] as const) ids[key] = (await accessOf(s, tenant)).employeeId;
  await asTenantSql(tenant, `update employees set employment_start_date = '2024-01-01', work_type = 'both'`);
  // Marko manages Ana; Lena leads the project; Vesna has nothing to do with it.
  await ok('POST', '/people/reporting-lines', { ...as(), body: { employeeIds: [ids.ana], managerId: ids.marko } }, 200);
  companyId = (await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Kovin Pančevo' } })).id;
  const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Service contract 2026', projectTypeId: type!.id, companyId, leadUserId: lena.userId } })).id;
  task = await ok<{ id: string; number: number }>('POST', '/tasks', { ...as(), body: { projectId, name: 'Hydraulic leak', assigneeIds: [ids.ana, ids.marko] } });
  await ok('PATCH', `/tasks/${task.id}/assignees/${ids.ana}`, { ...as(), body: { hourLimit: 10 } });
  week = (await ok<{ thisWeek: string }>('GET', '/timesheet/week', as(ana))).thisWeek;
});

describe('hour limit alerts (Warn mode)', () => {
  it('the first entry starts the task (TC 17)', async () => {
    expect((await ok<{ status: string }>('GET', `/tasks/${task.id}`, as())).status).toBe('todo');
    expect((await cell(ana, 0, 450)).status).toBe(200); // 7.5 h of 10
    await eventually(async () => (await ok<{ status: string }>('GET', `/tasks/${task.id}`, as())).status === 'in_progress' || null, 'task in progress');
    expect(await level()).toBe(0);
  });

  it('80 % sends "almost reached" to her and the lead once (TC 7)', async () => {
    await cell(ana, 1, 30); // 8 h
    await reachLevel(80);
    await mailsReach(ana, 'Hour limit almost reached', 1);
    await mailsReach(lena, 'Hour limit almost reached', 1);
    await cell(ana, 1, 60); // 8.5 h: nothing more
    expect((await subjects(marko, 'Hour limit almost reached')).length).toBe(0);
  });

  it('100 % sends "reached" to her, the lead and her manager; over it is saved in Warn mode (TC 8, 11)', async () => {
    await cell(ana, 2, 90); // 10 h
    await reachLevel(100);
    for (const s of [ana, lena, marko]) await mailsReach(s, 'Hour limit reached', 1);
    const atLimit = await anaRow();
    expect([atLimit.remainingMinutes, atLimit.usedPercent, atLimit.flag]).toEqual([0, 100, 'reached']);
    expect((await cell(ana, 3, 90)).status).toBe(200); // 11.5 h
    const me = await anaRow();
    expect([me.allTimeMinutes, me.remainingMinutes, me.flag]).toEqual([690, -90, 'over']);
    const mail = (await subjects(marko, 'Hour limit reached'))[0]!;
    expect(mail.text).toContain(`has logged 10 h of their 10 h limit on T-${task.number} Hydraulic leak`);
  });

  it('dropping below and crossing again sends again (TC 9)', async () => {
    await cell(ana, 2, 0);
    await cell(ana, 3, 0); // 8.5 h: back to 80, nothing sent
    await reachLevel(80);
    await cell(ana, 0, 360); // 7 h
    await reachLevel(0);
    await cell(ana, 0, 450); // 8.5 h again
    await reachLevel(80);
    await mailsReach(ana, 'Hour limit almost reached', 2);
    await mailsReach(lena, 'Hour limit almost reached', 2);
    expect((await subjects(ana, 'Hour limit reached')).length).toBe(1);
  }, 60_000);

  it('raising a limit clears the alert at once (TC 10)', async () => {
    await ok('PATCH', `/tasks/${task.id}/assignees/${ids.ana}`, { ...as(), body: { hourLimit: 20 } });
    expect(await level()).toBe(0);
    await ok('PATCH', `/tasks/${task.id}/assignees/${ids.ana}`, { ...as(), body: { hourLimit: 10 } });
    expect(await level()).toBe(80);
  });

  it('turning "Hour limit warnings" off stops them', async () => {
    await ok('PATCH', '/profile', { ...as(lena), body: { notifyHourLimits: false } });
    expect((await ok<{ notifyHourLimits: boolean }>('GET', '/profile', as(lena))).notifyHourLimits).toBe(false);
  });
});

describe('Block mode', () => {
  beforeAll(async () => {
    await ok('PATCH', '/workspace', { ...as(), body: { hourLimitMode: 'block' } });
  });

  it('refuses hours past the limit with what is left; up to the limit saves (TC 12, 14)', async () => {
    expect((await ok<{ hourLimitMode: string }>('GET', '/workspace', as())).hourLimitMode).toBe('block');
    const refused = await call('PUT', '/timesheet/cells', { ...as(ana), body: { date: addDays(week, 4), taskId: task.id, minutes: 120 } });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain(`You have 1.5 h left on T-${task.number} (limit 10 h). Ask ${lena.name} to raise your limit.`);
    const entry = await call('POST', '/timesheet/entries', { ...as(ana), body: { date: addDays(week, 4), taskId: task.id, minutes: 120 } });
    expect(entry.status).toBe(400);
    expect((await cell(ana, 4, 90)).status).toBe(200); // exactly 10 h
    expect((await cell(ana, 5, 15)).status).toBe(400); // nothing left
    expect((await cell(ana, 4, 60)).status).toBe(200); // lowering is fine
  });

  it("someone without a limit isn't blocked (TC 13)", async () => {
    expect((await cell(marko, 0, 600)).status).toBe(200);
  });

  it('Warn again saves past the limit', async () => {
    await ok('PATCH', '/workspace', { ...as(), body: { hourLimitMode: 'warn' } });
    expect((await cell(ana, 5, 120)).status).toBe(200); // 11.5 h
  });

  it('switching to Block keeps the entries already over the limit; only lowering them is allowed (TC 14)', async () => {
    expect(await anaRow()).toMatchObject({ allTimeMinutes: 690, flag: 'over' });
    await ok('PATCH', '/workspace', { ...as(), body: { hourLimitMode: 'block' } });
    expect(await anaRow()).toMatchObject({ allTimeMinutes: 690, flag: 'over' });
    const refused = await cell(ana, 6, 15);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain(`You have 0 h left on T-${task.number} (limit 10 h).`);
    expect((await cell(ana, 5, 60)).status).toBe(200); // 10.5 h: still over, still saved
    expect(await anaRow()).toMatchObject({ allTimeMinutes: 630, flag: 'over' });
    await ok('PATCH', '/workspace', { ...as(), body: { hourLimitMode: 'warn' } });
  });
});

describe('the time report', () => {
  let task2: string;

  beforeAll(async () => {
    task2 = (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId, name: 'Pump service', assigneeIds: [ids.ana, ids.jovan] } })).id;
    // Ana: 2 h draft, 1 h submitted, 1 h returned, 3 h approved, long ago; Jovan 4 h, then removed.
    const days = ['2025-03-03', '2025-03-04', '2025-03-05', '2025-03-06'];
    await asTenantSql(
      tenant,
      `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes) select $1, $2, $3, d.day::date, d.m from unnest($4::text[], $5::int[]) as d(day, m)`,
      [tenant, ids.ana, task2, days, [120, 60, 60, 180]],
    );
    await asTenantSql(
      tenant,
      `insert into timesheet_days (tenant_id, employee_id, work_date, status) select $1, $2, d.day::date, d.s from unnest($3::text[], $4::text[]) as d(day, s)`,
      [tenant, ids.ana, days.slice(1), ['submitted', 'rejected', 'approved']],
    );
    await asTenantSql(tenant, `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes) values ($1, $2, $3, '2025-03-03', 240)`, [tenant, ids.jovan, task2]);
    await ok('DELETE', `/tasks/${task2}/assignees/${ids.jovan}`, as(), 200);
  });

  const pump = (r: Report) => flat(r.rows).find((n) => n.kind === 'task' && n.id === task2)!;

  it('logged counts every state, approved only approved days; a removed person stays (TC 2, 4)', async () => {
    const t = pump(await report(owner));
    expect([t.loggedMinutes, t.approvedMinutes]).toEqual([660, 180]);
    const anaRow = t.children.find((c) => c.id === ids.ana)!;
    expect([anaRow.loggedMinutes, anaRow.approvedMinutes]).toEqual([420, 180]);
    expect(t.children.find((c) => c.id === ids.jovan)).toMatchObject({ loggedMinutes: 240, notAssigned: true });
  });

  it('a deleted entry adds nothing (TC 2)', async () => {
    const entry = await ok<{ id: string }>('POST', '/timesheet/entries', { ...as(ana), body: { date: addDays(week, 6), taskId: task2, minutes: 240 } });
    expect(pump(await report(owner)).loggedMinutes).toBe(900);
    await ok('DELETE', `/timesheet/entries/${entry.id}`, as(ana));
    expect(pump(await report(owner)).loggedMinutes).toBe(660);
  });

  it("a line that isn't a task adds hours to no task (TC 5)", async () => {
    // The timesheet's only non-task lines so far are work orders (time off, sick leave and trips
    // are separate rows in milestone 15); like them, a work order's hours are time entries without a task.
    const before = await report(owner);
    const order = await ok<{ id: string }>('POST', '/work-orders', { ...as(), body: { title: 'Site visit, Kovin', companyId, technicianIds: [ids.ana], durationHours: 8 } });
    await ok('PUT', '/timesheet/cells', { ...as(ana), body: { date: addDays(week, 6), workOrderId: order.id, minutes: 480 } });
    const [nonTask] = await asTenantSql<{ count: string }>(tenant, `select count(*) from time_entries where employee_id = $1 and task_id is null`, [ids.ana]);
    expect(Number(nonTask!.count)).toBe(1);
    const after = await report(owner);
    expect([after.total.loggedMinutes, after.total.allTimeMinutes]).toEqual([before.total.loggedMinutes, before.total.allTimeMinutes]);
    expect(flat(after.rows).filter((n) => n.kind === 'person' && n.id === ids.ana).map((n) => n.allTimeMinutes)).toEqual(
      flat(before.rows).filter((n) => n.kind === 'person' && n.id === ids.ana).map((n) => n.allTimeMinutes),
    );
    expect((await ok<{ total: { logged: number } }>('GET', `/tasks/${task2}/hours`, as())).total.logged).toBe(11);
  });

  it('adds tasks up into the phase and the project (TC 1)', async () => {
    const r = await report(owner);
    expect(r.rows.map((p) => p.id)).toEqual([projectId]);
    const [p] = r.rows;
    const sum = (nodes: Node[]) => nodes.reduce((a, n) => a + n.loggedMinutes, 0);
    const tasks = flat(p!.children).filter((n) => n.kind === 'task');
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    for (const t of tasks) expect(t.loggedMinutes, t.name).toBe(sum(t.children));
    const stages = p!.children.filter((n) => n.kind === 'stage');
    expect(stages.length).toBeGreaterThan(0);
    for (const s of stages) expect(s.loggedMinutes, s.name).toBe(sum(s.children));
    expect(p!.loggedMinutes).toBe(sum(tasks));
    expect(r.total.loggedMinutes).toBe(p!.loggedMinutes);
  });

  it('a period narrows Logged and Approved, not Remaining (TC 3)', async () => {
    const r = await report(owner, '&period=range&from=2025-03-05&to=2025-03-31');
    expect([pump(r).loggedMinutes, pump(r).approvedMinutes]).toEqual([240, 180]);
    const leak = flat(r.rows).find((n) => n.kind === 'person' && n.id === ids.ana && n.loggedMinutes === 0 && n.limitMinutes === 600)!;
    expect(leak.remainingMinutes).not.toBeNull();
    expect((await call('GET', '/time-report?period=range', as())).status).toBe(400);
  });

  it('the person view adds up each person across tasks (TC 1)', async () => {
    const r = await ok<Report>('GET', `/time-report?groupBy=person&projectId=${projectId}`, as());
    expect(r.rows.map((p) => p.name).sort()).toEqual([ana.name, jovan.name, marko.name].sort());
    const a = r.rows.find((p) => p.id === ids.ana)!;
    expect(a.children[0]!.children.map((t) => t.code)).toEqual([`T-${task.number}`, expect.stringMatching(/^T-\d+$/)]);
  });

  it('each viewer sees only the people they may (TC 6)', async () => {
    const people = async (s: Session) => [...new Set(flat((await report(s)).rows).filter((n) => n.kind === 'person').map((n) => n.id))].sort();
    expect(await people(owner)).toEqual([ids.ana, ids.jovan, ids.marko].sort());
    expect(await people(lena)).toEqual([ids.ana, ids.jovan, ids.marko].sort()); // the lead: everyone on the project
    expect(await people(marko)).toEqual([ids.ana, ids.marko].sort()); // himself and his report
    expect(await people(ana)).toEqual([ids.ana]);
    expect(await people(jovan)).toEqual([ids.jovan]); // only his own removed line
    const anaTotal = (await report(ana)).total.allTimeMinutes;
    expect(anaTotal).toBeLessThan((await report(owner)).total.allTimeMinutes);
    // Someone with no relation to the project sees nothing, and can't export.
    expect(await people(vesna)).toEqual([]);
    expect((await report(vesna)).total.allTimeMinutes).toBe(0);
    expect((await call('GET', `/time-report/csv?projectId=${projectId}`, as(vesna))).status).toBe(403);
  });

  it('only over 80 % keeps the people at or above it', async () => {
    const r = await report(owner, '&onlyOver80=true');
    expect(flat(r.rows).filter((n) => n.kind === 'person').map((n) => n.id)).toEqual([ids.ana]);
  });

  it('CSV for admins, leads and managers, with a BOM and the same rows (TC 15)', async () => {
    expect((await call('GET', `/time-report/csv?projectId=${projectId}`, as(ana))).status).toBe(403);
    for (const s of [owner, lena, marko]) {
      const res = await fetch(`${inject('apiUrl')}/api/time-report/csv?projectId=${projectId}`, { headers: { authorization: `Bearer ${s.token}`, 'x-tenant-id': tenant } });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/csv');
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
      expect(text.startsWith('﻿Project,Phase,Task,Person,')).toBe(true);
      if (s === owner) expect(text).toContain('Not assigned any more');
    }
  });

  it('the CSV has the screen rows and totals, and guards a cell starting with "=" (TC 15)', async () => {
    // A second project, named like a formula, with an hour of Ana's.
    const [type] = await ok<{ id: string }[]>('GET', '/project-types', as());
    const pricing = await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: '=2+2 Pricing', projectTypeId: type!.id, companyId, leadUserId: lena.userId } });
    const quote = await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId: pricing.id, name: 'Quote', assigneeIds: [ids.ana] } });
    await asTenantSql(tenant, `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes) values ($1, $2, $3, '2025-03-10', 60)`, [tenant, ids.ana, quote.id]);
    const screen = await ok<Report>('GET', '/time-report', as());
    const res = await fetch(`${inject('apiUrl')}/api/time-report/csv`, { headers: { authorization: `Bearer ${owner.token}`, 'x-tenant-id': tenant } });
    const lines = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer()).slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(flat(screen.rows).length + 2); // header, every row of the screen, Total
    expect(lines.some((l) => l.startsWith("'=2+2 Pricing,"))).toBe(true);
    expect(lines.filter((l) => l.startsWith('='))).toEqual([]);
    const hours = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);
    const total = lines[lines.length - 1]!.split(',');
    expect(total[0]).toBe('Total');
    expect([total[6], total[7]]).toEqual([hours(screen.total.loggedMinutes), hours(screen.total.approvedMinutes)]);
    expect(screen.total.loggedMinutes).toBe(flat(screen.rows).filter((n) => n.kind === 'person').reduce((a, n) => a + n.loggedMinutes, 0));
  });
});

describe('the job handler (TC 17)', () => {
  // The job sent directly with pg-boss, for an entry written straight to the table (no job yet), as
  // the Timesheet's writes send it.
  let boss: PgBoss;
  let bossError: Error | null = null;

  beforeAll(async () => {
    boss = new PgBoss({ connectionString: inject('databaseUrl'), schema: 'pgboss', createSchema: false, supervise: false, schedule: false });
    boss.on('error', (err) => {
      bossError ??= err;
    });
    await boss.start();
  });
  afterAll(async () => {
    await boss?.stop({ graceful: false });
    expect(bossError).toBeNull();
  });

  it(
    '"timesheet.task-hours-changed" starts an Open task on its first entry and updates the alert state',
    async () => {
      const t = await ok<{ id: string; number: number }>('POST', '/tasks', { ...as(), body: { projectId, name: 'Fixture job', assigneeIds: [ids.ana] } });
      await ok('PATCH', `/tasks/${t.id}/assignees/${ids.ana}`, { ...as(), body: { hourLimit: 1 } });
      await asTenantSql(tenant, `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes) values ($1, $2, $3, '2025-03-11', 60)`, [tenant, ids.ana, t.id]);
      const status = async () => (await ok<{ status: string }>('GET', `/tasks/${t.id}`, as())).status;
      expect([await status(), await level(ids.ana, t.id)]).toEqual(['todo', 0]);
      await boss.send('timesheet.task-hours-changed', { tenantId: tenant, taskId: t.id, employeeId: ids.ana });
      await eventually(async () => (await status()) === 'in_progress' || null, 'task in progress');
      await eventually(async () => (await level(ids.ana, t.id)) === 100 || null, 'alert level 100');
      await eventually(async () => (await mailTo(owner, ana.email)).some((m) => m.subject === `Hour limit reached: T-${t.number} Fixture job`) || null, '"Hour limit reached" for the fixture job');
    },
    60_000, // three worker hops polled in turn
  );
});
