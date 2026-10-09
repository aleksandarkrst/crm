/**
 * The project Report tab and the Workload report (CD-261): estimates against logged time by stage
 * and by person (a task's estimate shared by its people), the summary, and remaining hours per
 * person and week across open projects.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember, createTenant, ok, type Session, signIn } from './helpers';
import { accessOf, asTenantSql } from './people-helpers';

interface Stats {
  tasks: number;
  doneTasks: number;
  estimateMinutes: number;
  loggedMinutes: number;
  remainingMinutes: number;
  donePercent: number;
  variancePercent: number | null;
}
interface Report {
  summary: Stats & { budgetMinutes: number | null };
  stages: (Stats & { name: string })[];
  people: (Stats & { employeeId: string; openTasks: number })[];
}
interface Workload {
  weeks: string[];
  teams: { name: string; rows: { employeeId: string; cells: number[]; projects: string[] }[] }[];
}

let owner: Session;
let ana: Session;
let tenant: string;
let anaId: string;
let ownerId: string;
let projectId: string;

const as = (s: Session = owner) => ({ token: s.token, tenant });
const entry = (employeeId: string, taskId: string, minutes: number) =>
  asTenantSql(tenant, `insert into time_entries (tenant_id, employee_id, task_id, work_date, minutes) values ($1, $2, $3, '2025-06-02', $4)`, [tenant, employeeId, taskId, minutes]);

beforeAll(async () => {
  [owner, ana] = await Promise.all([signIn('pr-owner'), signIn('pr-ana')]);
  tenant = await createTenant(owner, 'Project report');
  await addMember(owner, tenant, ana, 'member');
  anaId = (await accessOf(ana, tenant)).employeeId;
  ownerId = (await accessOf(owner, tenant)).employeeId;
  const company = await ok<{ id: string }>('POST', '/crm/companies', { ...as(), body: { name: 'Kovin Pančevo' } });
  const [type] = await ok<{ id: string; stages: { id: string; name: string }[] }[]>('GET', '/project-types', as());
  projectId = (await ok<{ id: string }>('POST', '/projects', { ...as(), body: { name: 'Service contract 2026', code: 'SC-26', projectTypeId: type!.id, companyId: company.id, budgetHours: 100 } })).id;
  const [first, second] = type!.stages;
  const task = async (name: string, stageId: string, estimateHours: number, assigneeIds: string[]) =>
    (await ok<{ id: string }>('POST', '/tasks', { ...as(), body: { projectId, name, stageId, estimateHours, assigneeIds } })).id;
  // Done: 10 h estimate shared by Ana and the owner; Ana 6 h, the owner 4 h. Open: 6 h, Ana, 1 h logged.
  const done = await task('Survey', first!.id, 10, [anaId, ownerId]);
  const open = await task('Repair', second!.id, 6, [anaId]);
  await entry(anaId, done, 360);
  await entry(ownerId, done, 240);
  await entry(anaId, open, 60);
  await ok('PATCH', `/tasks/${done}`, { ...as(), body: { status: 'done' } });
});

describe('the Report tab', () => {
  it('by stage and the summary', async () => {
    const r = await ok<Report>('GET', `/projects/${projectId}/report`, as(ana));
    expect(r.stages.map((s) => [s.tasks, s.doneTasks, s.estimateMinutes, s.loggedMinutes, s.remainingMinutes])).toEqual([
      [1, 1, 600, 600, 0],
      [1, 0, 360, 60, 300],
    ]);
    expect(r.summary).toMatchObject({ tasks: 2, estimateMinutes: 960, loggedMinutes: 660, remainingMinutes: 300, donePercent: 63, variancePercent: 0, budgetMinutes: 6000 });
  });

  it('by person: shared estimates, own hours, vs estimate on finished tasks', async () => {
    const r = await ok<Report>('GET', `/projects/${projectId}/report`, as());
    const a = r.people.find((p) => p.employeeId === anaId)!;
    const o = r.people.find((p) => p.employeeId === ownerId)!;
    expect([a.openTasks, a.estimateMinutes, a.loggedMinutes, a.remainingMinutes, a.variancePercent]).toEqual([1, 660, 420, 300, 20]);
    expect([o.openTasks, o.estimateMinutes, o.loggedMinutes, o.variancePercent]).toEqual([0, 300, 240, -20]);
  });

  it('answers 404 for a project that does not exist', async () => {
    await ok('GET', '/projects/00000000-0000-4000-8000-000000000000/report', as(), 404);
  });
});

describe('Workload', () => {
  it("shows Ana's remaining hours on the open task, this week, with the project's code", async () => {
    const w = await ok<Workload>('GET', '/workload', as(ana));
    expect(w.weeks).toHaveLength(8);
    const row = w.teams.flatMap((t) => t.rows).find((r) => r.employeeId === anaId)!;
    expect(row.cells[0]).toBe(300); // no dates: all of it lands this week
    expect(row.cells.slice(1).every((c) => c === 0)).toBe(true);
    expect(row.projects).toEqual(['SC-26']);
    // The owner's only task is done: nothing left.
    expect(w.teams.flatMap((t) => t.rows).find((r) => r.employeeId === ownerId)).toBeUndefined();
  });
});
