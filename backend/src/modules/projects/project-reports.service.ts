import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { tenants } from '../../shared/database/schema';
import { zonedParts } from '../../shared/time/zoned-time';
import { type ProjectReport, projectReport, type ReportTask, shareOf, workloadCells, type WorkloadTask } from './project-report';

const WEEKS = 8;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

export interface WorkloadRow {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  /** Remaining minutes per week, in the order of `weeks`. */
  cells: number[];
  /** The open projects they have open tasks on: code, or name without one. */
  projects: string[];
}

export interface Workload {
  /** Mondays: this week and the next seven. */
  weeks: string[];
  teams: { name: string; rows: WorkloadRow[] }[];
}

/**
 * The project's Report tab and the Workload report (CD-261, design v2 §2, §9): estimates against
 * logged time, from the tasks, their people and `time_entries`. Every member reads both, like the
 * projects themselves.
 */
@Injectable()
export class ProjectReportsService {
  constructor(private readonly database: DatabaseService) {}

  report(ctx: TenantContext, projectId: string): Promise<ProjectReport> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const { rows: projectRows } = await tx.execute<{ status: string; budget_hours: string | null; end_date: string | null; project_type_id: string }>(
        sql`select status, budget_hours, end_date::text, project_type_id from projects where id = ${projectId}`,
      );
      const project = projectRows[0];
      if (!project) throw new NotFoundException('Project not found');
      const { rows: stages } = await tx.execute<{ id: string; name: string; position: number }>(
        sql`select id, name, position from project_stages where project_type_id = ${project.project_type_id}`,
      );
      const tasks = await reportTasks(tx, sql`t.project_id = ${projectId}`);
      const ids = [...new Set(tasks.flatMap((t) => [...t.assigneeIds, ...t.logged.keys()]))];
      const people = await names(tx, ids);
      return projectReport({
        tasks,
        stages,
        people: new Map([...people].map(([id, p]) => [id, p.name])),
        today: await today(tx, ctx.tenantId),
        budgetHours: project.budget_hours == null ? null : Number(project.budget_hours),
        endDate: project.end_date,
        open: project.status === 'open',
      });
    });
  }

  workload(ctx: TenantContext): Promise<Workload> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const now = await today(tx, ctx.tenantId);
      const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(mondayOf(now), i * 7));
      const tasks = await reportTasks(tx, sql`t.status <> 'done' and p.status = 'open'`);
      const perPerson = new Map<string, { work: WorkloadTask[]; projects: Set<string> }>();
      for (const t of tasks) {
        for (const id of t.assigneeIds) {
          const mine = perPerson.get(id) ?? { work: [], projects: new Set<string>() };
          mine.work.push({ startDate: t.startDate, dueDate: t.dueDate, remainingMinutes: Math.max(shareOf(t, id) - (t.logged.get(id) ?? 0), 0) });
          mine.projects.add(t.projectLabel);
          perPerson.set(id, mine);
        }
      }
      const people = await names(tx, [...perPerson.keys()]);
      const teams = new Map<string, WorkloadRow[]>();
      for (const [id, mine] of perPerson) {
        const p = people.get(id);
        if (!p) continue;
        const row = { employeeId: id, name: p.name, jobTitle: p.jobTitle, cells: workloadCells(mine.work, weeks, now), projects: [...mine.projects].sort() };
        teams.set(p.team ?? '', [...(teams.get(p.team ?? '') ?? []), row]);
      }
      return {
        weeks,
        teams: [...teams.entries()]
          .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
          .map(([name, rows]) => ({ name: name || 'No team', rows: rows.sort((a, b) => a.name.localeCompare(b.name)) })),
      };
    });
  }
}

async function today(tx: Tx, tenantId: string): Promise<string> {
  const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  return zonedParts(new Date(), tenant?.timezone ?? 'UTC').date;
}

/** The tasks matching `where` (aliases `t` and `p`), with their current people and everyone's logged minutes. */
async function reportTasks(tx: Tx, where: ReturnType<typeof sql>): Promise<(ReportTask & { projectLabel: string })[]> {
  const { rows } = await tx.execute<{
    id: string;
    stage_id: string | null;
    status: string;
    start_date: string | null;
    due_date: string | null;
    estimate_hours: string | null;
    project_label: string;
    assignees: string[] | null;
    logged: Record<string, number> | null;
  }>(sql`
    select t.id, t.stage_id, t.status, t.start_date::text, t.due_date::text, t.estimate_hours, coalesce(p.code, p.name) as project_label,
      (select array_agg(a.employee_id::text) from task_assignments a where a.task_id = t.id and a.active) as assignees,
      (select jsonb_object_agg(x.employee_id, x.minutes) from (select e.employee_id, sum(e.minutes)::int as minutes from time_entries e where e.task_id = t.id group by e.employee_id) x) as logged
    from tasks t join projects p on p.id = t.project_id
    where ${where}`);
  return rows.map((r) => ({
    id: r.id,
    stageId: r.stage_id,
    status: r.status,
    startDate: r.start_date,
    dueDate: r.due_date,
    estimateMinutes: r.estimate_hours == null ? null : Math.round(Number(r.estimate_hours) * 60),
    assigneeIds: r.assignees ?? [],
    logged: new Map(Object.entries(r.logged ?? {})),
    projectLabel: r.project_label,
  }));
}

async function names(tx: Tx, ids: string[]): Promise<Map<string, { name: string; jobTitle: string | null; team: string | null }>> {
  if (!ids.length) return new Map();
  const { rows } = await tx.execute<{ id: string; full_name: string; job_title: string | null; team: string | null }>(sql`
    select e.id, e.full_name, e.job_title, u.name as team from employees e left join org_units u on u.id = e.unit_id
    where e.id = any(${`{${ids.join(',')}}`}::uuid[])`);
  return new Map(rows.map((r) => [r.id, { name: r.full_name, jobTitle: r.job_title, team: r.team }]));
}
