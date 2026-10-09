import { ForbiddenException, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { TASK_STATUSES, tenants } from '../../shared/database/schema';
import { zonedParts } from '../../shared/time/zoned-time';
import { type CallerAccess, PeopleAccess } from '../people';
import { buildReport, periodRange, REPORT_PERIODS, type ReportLeaf, reportCsv, type TimeReport } from './time-report';

const isoDate = z.iso.date();
const flag = z.enum(['true', 'false']).transform((v) => v === 'true');

export const TimeReportQuery = z
  .object({
    groupBy: z.enum(['project', 'person']).default('project'),
    period: z.enum(REPORT_PERIODS).default('all'),
    /** With `period=range`: the first and last day, both included. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    companyId: z.uuid().optional(),
    /** The project's kind (its project type). */
    projectTypeId: z.uuid().optional(),
    projectId: z.uuid().optional(),
    /** An org unit (department, team…): its people and those of the units below it. */
    unitId: z.uuid().optional(),
    leadUserId: z.uuid().optional(),
    employeeId: z.uuid().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    onlyOver80: flag.default(false),
  })
  .refine((q) => q.period !== 'range' || (q.from && q.to), { message: 'A range needs from and to', path: ['from'] })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'The range must end after it starts', path: ['to'] });
export type TimeReportQuery = z.infer<typeof TimeReportQuery>;

/**
 * The time report (CD-149, spec 10.2): logged and approved hours per project, stage, task and person
 * (or per person, project and task), against the hour limits, from aggregate queries on
 * `time_entries` (indexed by task and person), so it stays fast with 100,000 entries.
 *
 * Each viewer sees the people on tasks whose hours they may see: their own; as a project's lead,
 * everyone on it; as a manager, their direct and indirect reports; owners and admins everyone. The
 * totals only add up what they see. Export: owners and admins, project leads and managers.
 */
@Injectable()
export class TimeReportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly people: PeopleAccess,
  ) {}

  report(ctx: TenantContext, query: TimeReportQuery): Promise<TimeReport> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.people.of(ctx, tx);
      return this.build(tx, ctx, caller, query);
    });
  }

  csv(ctx: TenantContext, query: TimeReportQuery): Promise<string> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.people.of(ctx, tx);
      if (!(await this.canExport(tx, ctx, caller))) throw new ForbiddenException('Only admins, project leads and managers export the time report');
      return reportCsv(await this.build(tx, ctx, caller, query));
    });
  }

  private async canExport(tx: Tx, ctx: TenantContext, caller: CallerAccess): Promise<boolean> {
    if (caller.isAdmin || caller.reportIds.size > 0) return true;
    const { rows } = await tx.execute<{ lead: boolean }>(sql`select exists (select 1 from projects where lead_user_id = ${ctx.userId}) as lead`);
    return !!rows[0]?.lead;
  }

  private async build(tx: Tx, ctx: TenantContext, caller: CallerAccess, q: TimeReportQuery): Promise<TimeReport> {
    const [tenant] = await tx.select({ timezone: tenants.timezone, fiscal: tenants.fiscalYearStartMonth }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const today = zonedParts(new Date(), tenant?.timezone ?? 'UTC').date;
    const period = periodRange(q.period, today, tenant?.fiscal ?? 1, q.from, q.to);
    const leaves = await reportLeaves(tx, caller, ctx.userId, q, period);
    return buildReport(leaves, { groupBy: q.groupBy, period, onlyOver80: q.onlyOver80 });
  }
}

/**
 * One row per person and task the caller may see: current assignees and anyone with time on it.
 * Logged hours are every entry (draft, submitted, rejected and approved days), approved hours the
 * ones on approved days; time off and other non-task lines aren't time entries on tasks.
 *
 * Three plain queries joined here (the hours per person and task, the tasks, the people) rather
 * than one: a single big join depends on the planner's row estimates, which are far off for rows
 * added since the last ANALYZE, and then took seconds instead of milliseconds.
 */
export async function reportLeaves(tx: Tx, caller: CallerAccess, userId: string, q: Omit<TimeReportQuery, 'groupBy' | 'period' | 'onlyOver80'>, period: { from: string; to: string } | null): Promise<ReportLeaf[]> {
  const inPeriod = period ? sql`e.work_date between ${period.from}::date and ${period.to}::date` : sql`true`;
  const taskFilters = [
    q.companyId ? sql`pr.company_id = ${q.companyId}` : null,
    q.projectTypeId ? sql`pr.project_type_id = ${q.projectTypeId}` : null,
    q.projectId ? sql`pr.id = ${q.projectId}` : null,
    q.leadUserId ? sql`pr.lead_user_id = ${q.leadUserId}` : null,
    q.status ? sql`t.status = ${q.status}` : null,
  ].filter((f) => f !== null);
  const [hours, taskRows, people] = await Promise.all([
    tx.execute<{ task_id: string; employee_id: string; active: boolean; hour_limit: string | null; logged: number; approved: number; all_time: number }>(sql`
      with h as (
        select e.task_id, e.employee_id,
          sum(e.minutes)::int as all_time,
          coalesce(sum(e.minutes) filter (where ${inPeriod}), 0)::int as logged,
          coalesce(sum(e.minutes) filter (where ${inPeriod} and d.status = 'approved'), 0)::int as approved
        from time_entries e
        left join timesheet_days d on d.tenant_id = e.tenant_id and d.employee_id = e.employee_id and d.work_date = e.work_date
        where e.task_id is not null ${q.employeeId ? sql`and e.employee_id = ${q.employeeId}` : sql``}
        group by e.task_id, e.employee_id
      )
      select coalesce(a.task_id, h.task_id) as task_id, coalesce(a.employee_id, h.employee_id) as employee_id,
        coalesce(a.active, false) as active, a.hour_limit, coalesce(h.logged, 0) as logged, coalesce(h.approved, 0) as approved, coalesce(h.all_time, 0) as all_time
      from (select task_id, employee_id, active, hour_limit from task_assignments ${q.employeeId ? sql`where employee_id = ${q.employeeId}` : sql``}) a
      full join h on h.task_id = a.task_id and h.employee_id = a.employee_id
      where a.active or h.task_id is not null`),
    tx.execute<{
      id: string;
      number: number;
      name: string;
      status: string;
      project_id: string;
      project_name: string;
      project_code: string | null;
      lead_user_id: string | null;
      company_name: string;
      stage_id: string | null;
      stage_name: string | null;
      stage_position: number | null;
    }>(sql`
      select t.id, t.number, t.name, t.status, pr.id as project_id, pr.name as project_name, pr.code as project_code, pr.lead_user_id,
        c.name as company_name, s.id as stage_id, s.name as stage_name, s.position as stage_position
      from tasks t
      join projects pr on pr.id = t.project_id
      join companies c on c.id = pr.company_id
      left join project_stages s on s.id = t.stage_id
      ${taskFilters.length ? sql`where ${sql.join(taskFilters, sql` and `)}` : sql``}`),
    tx.execute<{ id: string; full_name: string }>(sql`
      select id, full_name from employees
      ${q.unitId ? sql`where unit_id in (with recursive u(id) as (select id from org_units where id = ${q.unitId} union select o.id from org_units o join u on o.parent_id = u.id) select id from u)` : sql``}`),
  ]);
  const tasks = new Map(taskRows.rows.map((t) => [t.id, t]));
  const names = new Map(people.rows.map((p) => [p.id, p.full_name]));
  const leaves: ReportLeaf[] = [];
  for (const h of hours.rows) {
    const t = tasks.get(h.task_id);
    const personName = names.get(h.employee_id);
    if (!t || personName === undefined) continue;
    // Their own hours; everyone's on projects they lead; their reports'; owners and admins everything.
    const visible = caller.isAdmin || t.lead_user_id === userId || h.employee_id === caller.employeeId || caller.reportIds.has(h.employee_id);
    if (!visible) continue;
    leaves.push({
      projectId: t.project_id,
      projectName: t.project_name,
      projectCode: t.project_code,
      companyName: t.company_name,
      stageId: t.stage_id,
      stageName: t.stage_name,
      stagePosition: t.stage_position,
      taskId: t.id,
      taskNumber: t.number,
      taskName: t.name,
      taskStatus: t.status,
      employeeId: h.employee_id,
      personName,
      active: h.active,
      limitMinutes: h.active && h.hour_limit != null ? Math.round(Number(h.hour_limit) * 60) : null,
      loggedMinutes: h.logged,
      approvedMinutes: h.approved,
      allTimeMinutes: h.all_time,
    });
  }
  return leaves;
}
