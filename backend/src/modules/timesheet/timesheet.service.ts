import { type AbsenceLine, absencesIn, pendingAbsenceRegistry, refuseAbsenceDay } from './absences';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import {
  companies,
  employees,
  projects,
  taskAssignments,
  tasks,
  tenants,
  timeEntries,
  type TimesheetDayEventKind,
  timesheetDayEvents,
  timesheetDays,
  timesheetRows,
  type TimesheetDayStatus,
  timesheetWeeks,
  users,
  workOrders,
  workOrderTechnicians,
} from '../../shared/database/schema';
import { zonedDayStart, zonedParts } from '../../shared/time/zoned-time';
import { PeopleAccess } from '../people';
import { JobsService } from '../../shared/events/jobs.service';
import { hourLimitBlock, loggableTasks, loggableWorkOrders, type LogTimeRefusal, logTimeRefusal, type WorkOrderLogRefusal, workOrderLogRefusal } from '../projects';
import {
  addDays,
  copyPlan,
  type CopySourceRow,
  dayLimitRefusal,
  deadlineInstant,
  deadlineOf,
  type Employment,
  employed,
  endAfter,
  expectedMinutes,
  holidayMinutes,
  isoWeek,
  isRequired,
  mondayOf,
  resubmittableDays,
  spanMinutes,
  submittableDays,
  type TimesheetSettings,
  type WeekDay,
  weekDates,
  weekLabel,
  weekStatus,
  type WeekStatus,
} from './timesheet-rules';
import type { AddRow, CopyWeek, CreateEntry, SetCell, UpdateEntry } from './timesheet.schemas';
import { holidaysBetween, timesheetSettings } from './timesheet-settings';

export type RowKind = 'task' | 'work_order';

/** One cell: the person's hours on that row and day, the note when there is one entry, how many entries. */
export interface CellView {
  minutes: number;
  note: string | null;
  entries: number;
}

/** A row of the grid: a task or a work order. */
export interface RowView {
  key: string;
  kind: RowKind;
  id: string;
  /** "T-12" or "WO-1044". */
  code: string;
  name: string;
  /** "Company › Project", or the company of a work order without a project. */
  path: string;
  /** Why no new hours can go on it ("Task done", "Project closed", …), or null. */
  lockedReason: string | null;
  /** What the person may change: any day's hours, only hours already there (unassigned since, spec 4.4), or nothing. */
  edit: 'any' | 'existing' | 'none';
  /** The person's own hour limit on a task (CD-147) and all their hours on it, in minutes. */
  limit: { limitMinutes: number; loggedMinutes: number } | null;
  cells: Record<string, CellView>;
  minutes: number;
}

export interface DayView {
  date: string;
  status: TimesheetDayStatus;
  submittedAt: string | null;
  expectedMinutes: number;
  minutes: number;
  required: boolean;
  /** The person can change its hours: Draft or Rejected, within employment, not after the current week. */
  editable: boolean;
  /** A public holiday on a working day (CD-153): its name and the hours off; it lowers the expected hours. */
  holiday: { name: string; minutes: number } | null;
  /** A full-day absence (CD-170, spec 14.1): read-only, its hours count as entered, no task hours on the day. */
  absence: { kind: string; label: string; minutes: number } | null;
  /** Time off waiting for approval on the day, as a hint without hours ("Vacation pending"). */
  pendingAbsence: string | null;
  /**
   * What the approver should know (spec 14.3): "Changed after submission: Vacation added",
   * "Changed after approval: …", "Conflict: absence and task hours", "Missing hours after absence removed".
   */
  flags: string[];
  /** The approver's decision (CD-157): the latest comment, who returned or approved the day and when. */
  comment: string | null;
  returnedAt: string | null;
  returnedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  /** The day as it was approved (CD-159): expected and entered minutes at that moment. */
  approvedExpectedMinutes: number | null;
  approvedMinutes: number | null;
  /** The employee resubmitted the returned day (CD-158): when, and their reply to the comment. */
  resubmittedAt: string | null;
  reply: string | null;
}

export interface WeekView {
  weekStart: string;
  weekNumber: number;
  label: string;
  today: string;
  /** The Monday of the current week. */
  thisWeek: string;
  deadline: { date: string; time: string };
  settings: Pick<TimesheetSettings, 'dayMinutes' | 'maxDayMinutes' | 'timeFormat' | 'approvalMode'>;
  /** Null for a member without an employee record: nothing to enter. */
  employee: { id: string; name: string } | null;
  status: WeekStatus;
  statusLabel: string;
  /** Days Submit week would submit. */
  submittable: string[];
  /** Rejected days "Resubmit rejected days" sends again (CD-158). */
  resubmittable: string[];
  canRecall: boolean;
  /** Flags on the week (spec 5.2): first submitted after the deadline; submitted by the deadline job (CD-153). */
  late: boolean;
  autoSubmitted: boolean;
  /** A day of the week was submitted or resubmitted by an Admin on the employee's behalf (CD-317). */
  onBehalf: boolean;
  /** The week's deadline has passed (CD-155). */
  deadlinePassed: boolean;
  /** Days Submit week would submit that were never submitted, after the deadline: submitting one makes the week Late (spec 5.5). */
  lateIfSubmitted: string[];
  days: DayView[];
  rows: RowView[];
}

export interface PickerItem {
  kind: RowKind;
  id: string;
  code: string;
  name: string;
  path: string;
}

export interface Caller {
  employeeId: string | null;
  name: string;
  employment: Employment;
  today: string;
  settings: TimesheetSettings;
  /** The workspace's time zone and the moment of the request: whether the deadline has passed (CD-155). */
  timeZone: string;
  now: Date;
  /** An Admin acting for `employeeId`, not themselves (CD-317): the history shows it. */
  onBehalf?: boolean;
}

interface RowFacts {
  kind: RowKind;
  id: string;
  code: string;
  name: string;
  path: string;
  refusal: LogTimeRefusal | WorkOrderLogRefusal | 'project_closed' | null;
  limitMinutes: number | null;
}

const TASK_REASONS: Record<LogTimeRefusal, string> = {
  not_found: 'Not found',
  not_assigned: 'Not assigned to you any more',
  task_done: 'Task done',
  project_closed: 'Project closed',
  over_limit: 'Over your limit',
};
const WORK_ORDER_REASONS: Record<WorkOrderLogRefusal | 'project_closed', string> = {
  not_found: 'Not found',
  not_technician: 'You are not on it any more',
  completed: 'Work order completed',
  project_closed: 'Project closed',
};
const reasonOf = (f: RowFacts) => (f.refusal ? (f.kind === 'task' ? TASK_REASONS[f.refusal as LogTimeRefusal] : WORK_ORDER_REASONS[f.refusal as WorkOrderLogRefusal]) : null);

/** Why Copy last week skips a row, in the dialog's words ("#129 is closed"). */
const COPY_REASONS: Record<string, string> = {
  not_assigned: "you aren't assigned any more",
  task_done: 'is done',
  project_closed: 'is in a closed project',
  not_technician: "you aren't on it any more",
  completed: 'is completed',
  not_found: 'was deleted',
};

/** Refusing to log on a row: not yours is 403, closed or completed is 423 (spec 9.1, CD-277). */
function refusalError(f: RowFacts): HttpException {
  const reason = reasonOf(f) ?? 'Not allowed';
  if (f.refusal === 'not_found') return new NotFoundException(f.kind === 'task' ? 'Task not found' : 'Work order not found');
  if (f.refusal === 'not_assigned') return new ForbiddenException("You aren't assigned to this task");
  if (f.refusal === 'not_technician') return new ForbiddenException("You aren't a technician on this work order");
  if (f.refusal === 'project_closed') return new HttpException('Project is closed', 423);
  return new HttpException(reason, 423);
}

const keyOf = (kind: RowKind, id: string) => `${kind}:${id}`;
/** The members who returned or approved a day, by name (CD-157). */
const returner = alias(users, 'returner');
const approver = alias(users, 'approver');

/** One writer per person and day, so two tabs can't pass the daily maximum together. */
export const lockDay = (tx: Tx, employeeId: string, date: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${employeeId}:${date}`}, 0))`);

/** An entry as the entry endpoints answer (CD-276). */
export interface EntryView {
  id: string;
  date: string;
  minutes: number;
  note: string | null;
  startTime: string | null;
  endTime: string | null;
}
const entryView = (e: { id: string; workDate: string; minutes: number; note: string | null; startTime: string | null; endTime: string | null }): EntryView => ({
  id: e.id,
  date: e.workDate,
  minutes: e.minutes,
  note: e.note,
  startTime: e.startTime?.slice(0, 5) ?? null,
  endTime: e.endTime?.slice(0, 5) ?? null,
});

/** The minutes of an entry and its Start → End, from either. */
function resolveSpan(minutes: number | undefined, start: string | null, end: string | null) {
  if (start && end) {
    const span = spanMinutes(start.slice(0, 5), end.slice(0, 5));
    if (span === null) throw new BadRequestException('The end must be after the start, in steps of 15 minutes');
    return { minutes: span, startTime: start.slice(0, 5), endTime: end.slice(0, 5) };
  }
  if (minutes === undefined) throw new BadRequestException('Enter the hours first');
  return { minutes, startTime: null, endTime: null };
}

/** New hours on an entry with Start → End move its end; past midnight the times go. */
function keepSpan(start: string | null, minutes: number): { startTime: string | null; endTime: string | null } {
  const end = start ? endAfter(start.slice(0, 5), minutes) : null;
  return end ? { startTime: start!.slice(0, 5), endTime: end } : { startTime: null, endTime: null };
}
const pathOf = (company: string, project: string | null) => (project ? `${company} › ${project}` : company);

/**
 * The weekly timesheet (CD-152, spec sections 4 and 5): the caller's own hours per task or work order
 * and day, adding rows, Copy last week, Submit week and Recall. Who may log on a task or work order
 * is the projects module's rule (task-log.ts, work-order-log.ts); the lock on submitted and approved
 * days, completed work orders and closed projects is the trigger on time_entries. Settings come
 * from `timesheetSettings` (defaults until CD-153).
 */
@Injectable()
export class TimesheetService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly people: PeopleAccess,
    private readonly jobs: JobsService,
  ) {}

  /** Someone's hours on tasks changed (CD-149): the projects worker starts the task and updates their limit alert. */
  private async hoursChanged(tx: Tx, tenantId: string, employeeId: string, taskIds: (string | null)[]) {
    for (const taskId of new Set(taskIds)) if (taskId) await this.jobs.send('timesheet.task-hours-changed', { tenantId, taskId, employeeId }, tx);
  }

  /** Block mode (CD-149): refuses `minutes` more on a task past the person's hour limit; `except`: the entries the change replaces. */
  private async checkHourLimit(tx: Tx, tenantId: string, employeeId: string, taskId: string | null, minutes: number, except: string[] = []) {
    if (!taskId) return;
    const refusal = await hourLimitBlock(tx, tenantId, employeeId, taskId, minutes, except);
    if (refusal) throw new BadRequestException(refusal);
  }

  week(ctx: TenantContext, weekStart?: string, employeeId?: string): Promise<WeekView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx, employeeId);
      return readWeek(tx, caller, weekStart ?? mondayOf(caller.today));
    });
  }

  /** Read-only employee history; one Late flag counts once, including auto submissions. */
  employeeLate(ctx: TenantContext, employeeId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.people.of(ctx, tx);
      if (!access.canSeeEmployment(employeeId)) throw new ForbiddenException('You cannot see this employee\'s timesheet');
      const [employee] = await tx.select({ fullName: employees.fullName, timesheetRequired: employees.timesheetRequired,
        employmentStartDate: employees.employmentStartDate, employmentEndDate: employees.employmentEndDate })
        .from(employees).where(eq(employees.id, employeeId));
      if (!employee) throw new NotFoundException('Employee not found');
      if (!employee.timesheetRequired) return { applicable: false as const };
      const caller = await this.caller(ctx, tx);
      const thisWeek = mondayOf(caller.today);
      // Calendar twelve months, clamped to 28 Feb when today is 29 Feb.
      const year = Number(caller.today.slice(0, 4)) - 1;
      const anniversary = `${year}${caller.today.slice(4)}`;
      const from = caller.today.endsWith('-02-29') ? `${year}-02-28` : anniversary;
      const { rows } = await tx.execute<{ week_start: string; late_at: string; auto_submitted_at: string | null; first_submitted_at: string | null }>(sql`
        select w.week_start::text, w.late_at, w.auto_submitted_at,
          (select min(d.first_submitted_at) from timesheet_days d
           where d.employee_id = w.employee_id and d.work_date between w.week_start and w.week_start + 6) as first_submitted_at
        from timesheet_weeks w where w.employee_id = ${employeeId}
          and w.week_start between ${from}::date and ${thisWeek}::date and w.late_at is not null
        order by w.week_start desc`);
      const returned = await tx.execute<{ count: number }>(sql`
        select count(distinct date_trunc('week', work_date))::int as count from timesheet_days
        where employee_id = ${employeeId} and status = 'rejected'
          and date_trunc('week', work_date)::date between ${from}::date and ${thisWeek}::date`);
      const holidays = await holidaysBetween(tx, from, addDays(thisWeek, 45));
      const recent = rows.slice(0, 5).map((w) => {
        const deadline = deadlineOf(w.week_start, caller.settings, (d) => holidays.has(d));
        const first = w.first_submitted_at ? new Date(w.first_submitted_at) : null;
        const due = deadlineInstant(zonedDayStart(deadline.date, caller.timeZone), deadline.time);
        // In Day by day mode an earlier day may have gone in on time: measure when the
        // week actually became Late, not that earlier day's first submission.
        const hours = Math.max(0, Math.floor((new Date(w.late_at).getTime() - due.getTime()) / 3_600_000));
        return {
          weekStart: w.week_start, label: weekLabel(w.week_start), deadline,
          firstSubmittedAt: first?.toISOString() ?? null,
          autoSubmitted: !!w.auto_submitted_at,
          detail: w.auto_submitted_at ? 'Auto-submitted' : hours < 1 ? 'Less than 1 h late' : `${hours >= 24 ? `${Math.floor(hours / 24)} ${hours >= 48 ? 'days' : 'day'} ` : ''}${hours % 24} h late`,
        };
      });
      const lastWeek = addDays(thisWeek, -7);
      const employment: Employment = { start: employee.employmentStartDate, end: employee.employmentEndDate };
      // Last week wholly before their first day (a new starter) or after their last: nothing to
      // read, and the status says which rather than "No entry needed".
      const last = weekDates(lastWeek).some((d) => employed(d, employment))
        ? await readWeek(tx, { ...caller, employeeId, name: employee.fullName, employment }, lastWeek)
        : { weekStart: lastWeek, status: 'no_entry' as const, statusLabel: employment.start && lastWeek < employment.start ? 'Not yet employed' : 'Employment ended', late: false };
      return { applicable: true as const, from, through: caller.today, lateCount: rows.length,
        autoSubmittedCount: rows.filter((w) => w.auto_submitted_at).length,
        returnedWeekCount: returned.rows[0]?.count ?? 0,
        recent, lastWeek: { weekStart: last.weekStart, status: last.status, statusLabel: last.statusLabel, late: last.late } };
    });
  }

  /** What "+ Add task or work order" offers: tasks and work orders the caller can log on now. */
  loggable(ctx: TenantContext, employeeId?: string): Promise<PickerItem[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx, employeeId);
      if (!caller.employeeId) return [];
      const [taskRows, orderRows] = await Promise.all([loggableTasks(tx, caller.employeeId), loggableWorkOrders(tx, caller.employeeId)]);
      return [
        ...taskRows.map((t) => ({ kind: 'task' as const, id: t.id, code: `T-${t.number}`, name: t.name, path: pathOf(t.companyName, t.projectName) })),
        ...orderRows.map((w) => ({ kind: 'work_order' as const, id: w.id, code: `WO-${w.number}`, name: w.title, path: pathOf(w.companyName, w.projectName) })),
      ];
    });
  }

  /**
   * One cell: sets the caller's hours (0 clears them) and note on a task or work order and day.
   * Refused after the current week, above the daily maximum, on a row they can't log on (except
   * correcting hours already there, spec 4.4) and on a cell with several entries (made on the task
   * or work order page, CD-276). The trigger refuses locked days and closed rows.
   */
  setCell(ctx: TenantContext, input: SetCell): Promise<WeekView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx, input.employeeId);
        const employeeId = this.ownEmployee(caller);
        const kind: RowKind = input.taskId ? 'task' : 'work_order';
        const id = (input.taskId ?? input.workOrderId)!;
        if (input.date > caller.thisWeekEnd) throw new BadRequestException('Hours can be entered up to the end of this week');
        if (!employed(input.date, caller.employment)) throw new BadRequestException("You weren't employed on this day");
        await lockDay(tx, employeeId, input.date);
        const target = kind === 'task' ? eq(timeEntries.taskId, id) : eq(timeEntries.workOrderId, id);
        const mine = and(eq(timeEntries.employeeId, employeeId), eq(timeEntries.workDate, input.date));
        const existing = await tx
          .select({ id: timeEntries.id, minutes: timeEntries.minutes, note: timeEntries.note, startTime: timeEntries.startTime })
          .from(timeEntries)
          .where(and(mine, target));
        const [facts] = await rowFacts(tx, employeeId, kind === 'task' ? [id] : [], kind === 'work_order' ? [id] : []);
        if (!facts) throw new NotFoundException(kind === 'task' ? 'Task not found' : 'Work order not found');
        // Hours already there can be corrected after someone was unassigned (spec 4.4); new ones need the rule.
        const correcting = existing.length > 0 && (facts.refusal === 'not_assigned' || facts.refusal === 'not_technician');
        if (facts.refusal && !correcting) throw refusalError(facts);
        if (existing.length > 1) throw new ConflictException(`This day has ${existing.length} entries on ${facts.code}. Change them on its page.`);
        const entry = existing[0];
        const note = input.note === undefined ? (entry?.note ?? null) : input.note;
        if (input.minutes > (entry?.minutes ?? 0)) await refuseAbsenceDay(tx, employeeId, input.date);
        if (input.minutes === 0) {
          if (entry) await tx.delete(timeEntries).where(eq(timeEntries.id, entry.id));
        } else {
          const [{ total } = { total: 0 }] = await tx
            .select({ total: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
            .from(timeEntries)
            .where(and(mine, entry ? sql`${timeEntries.id} <> ${entry.id}` : undefined));
          const refusal = entry && input.minutes <= entry.minutes ? null : dayLimitRefusal(total, input.minutes, caller.settings);
          if (refusal) throw new BadRequestException(refusal);
          if (!entry || input.minutes > entry.minutes) await this.checkHourLimit(tx, ctx.tenantId, employeeId, input.taskId ?? null, input.minutes, entry ? [entry.id] : []);
          if (entry) await tx.update(timeEntries).set({ minutes: input.minutes, note, ...keepSpan(entry.startTime, input.minutes) }).where(eq(timeEntries.id, entry.id));
          else await tx.insert(timeEntries).values({ tenantId: ctx.tenantId, employeeId, workDate: input.date, taskId: input.taskId ?? null, workOrderId: input.workOrderId ?? null, minutes: input.minutes, note, createdByUserId: ctx.userId });
        }
        if (entry || input.minutes > 0) await this.hoursChanged(tx, ctx.tenantId, employeeId, [input.taskId ?? null]);
        return readWeek(tx, caller, mondayOf(input.date));
      })
      .catch(mapDbError);
  }

  /**
   * An entry from the task or work order page (CD-276), the caller's own: on a day up to the end of
   * this week, within employment and the daily maximum, on a task or work order they can log on now.
   * The lock trigger refuses submitted and approved days.
   */
  createEntry(ctx: TenantContext, input: CreateEntry): Promise<EntryView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const employeeId = this.ownEmployee(caller);
        const span = resolveSpan(input.minutes, input.startTime ?? null, input.endTime ?? null);
        this.checkDate(caller, input.date);
        await lockDay(tx, employeeId, input.date);
        const [facts] = await rowFacts(tx, employeeId, input.taskId ? [input.taskId] : [], input.workOrderId ? [input.workOrderId] : []);
        if (!facts) throw new NotFoundException(input.taskId ? 'Task not found' : 'Work order not found');
        if (facts.refusal) throw refusalError(facts);
        await refuseAbsenceDay(tx, employeeId, input.date);
        await this.checkDayLimit(tx, caller, employeeId, input.date, span.minutes, null);
        await this.checkHourLimit(tx, ctx.tenantId, employeeId, input.taskId ?? null, span.minutes);
        const [row] = await tx
          .insert(timeEntries)
          .values({
            tenantId: ctx.tenantId,
            employeeId,
            workDate: input.date,
            taskId: input.taskId ?? null,
            workOrderId: input.workOrderId ?? null,
            ...span,
            note: input.note ?? null,
            createdByUserId: ctx.userId,
          })
          .returning();
        await this.hoursChanged(tx, ctx.tenantId, employeeId, [input.taskId ?? null]);
        return entryView(row!);
      })
      .catch(mapDbError);
  }

  /** Changes the caller's own entry: date, hours or Start → End, note. Others' entries are 404. */
  updateEntry(ctx: TenantContext, id: string, input: UpdateEntry): Promise<EntryView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const employeeId = this.ownEmployee(caller);
        const entry = await this.ownEntry(tx, employeeId, id);
        const date = input.date ?? entry.workDate;
        let span: { minutes: number; startTime: string | null; endTime: string | null };
        if (input.startTime !== undefined || input.endTime !== undefined) {
          const start = input.startTime === undefined ? entry.startTime : input.startTime;
          const end = input.endTime === undefined ? entry.endTime : input.endTime;
          if ((start === null) !== (end === null)) throw new BadRequestException('Enter a start and an end');
          span = resolveSpan(input.minutes ?? entry.minutes, start, end);
        } else {
          const minutes = input.minutes ?? entry.minutes;
          span = { minutes, ...keepSpan(entry.startTime, minutes) };
        }
        if (date !== entry.workDate) this.checkDate(caller, date);
        for (const day of [...new Set([entry.workDate, date])].sort()) await lockDay(tx, employeeId, day);
        const [facts] = await rowFacts(tx, employeeId, entry.taskId ? [entry.taskId] : [], entry.workOrderId ? [entry.workOrderId] : []);
        // Hours already there can be corrected after someone was unassigned (spec 4.4); closed rows are the trigger's.
        if (facts?.refusal && facts.refusal !== 'not_assigned' && facts.refusal !== 'not_technician') throw refusalError(facts);
        if (date !== entry.workDate || span.minutes > entry.minutes) await refuseAbsenceDay(tx, employeeId, date);
        await this.checkDayLimit(tx, caller, employeeId, date, span.minutes, date === entry.workDate ? entry : null);
        if (span.minutes > entry.minutes) await this.checkHourLimit(tx, ctx.tenantId, employeeId, entry.taskId, span.minutes, [entry.id]);
        const [row] = await tx
          .update(timeEntries)
          .set({ workDate: date, ...span, ...(input.note !== undefined ? { note: input.note } : {}) })
          .where(eq(timeEntries.id, id))
          .returning();
        await this.hoursChanged(tx, ctx.tenantId, employeeId, [entry.taskId]);
        return entryView(row!);
      })
      .catch(mapDbError);
  }

  /** Removes the caller's own entry (the lock trigger refuses submitted and approved days). */
  removeEntry(ctx: TenantContext, id: string): Promise<void> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const employeeId = this.ownEmployee(caller);
        const entry = await this.ownEntry(tx, employeeId, id);
        await tx.delete(timeEntries).where(eq(timeEntries.id, id));
        await this.hoursChanged(tx, ctx.tenantId, employeeId, [entry.taskId]);
      })
      .catch(mapDbError);
  }

  private async ownEntry(tx: Tx, employeeId: string, id: string) {
    const [entry] = await tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.employeeId, employeeId)));
    if (!entry) throw new NotFoundException('Time entry not found');
    return entry;
  }

  private checkDate(caller: Caller & { thisWeekEnd: string }, date: string) {
    if (date > caller.thisWeekEnd) throw new BadRequestException('Hours can be entered up to the end of this week');
    if (!employed(date, caller.employment)) throw new BadRequestException("You weren't employed on this day");
  }

  /** The daily maximum for `minutes` more on `date`; lowering an entry already over it is fine. */
  private async checkDayLimit(tx: Tx, caller: Caller, employeeId: string, date: string, minutes: number, replacing: { id: string; minutes: number } | null) {
    if (replacing && minutes <= replacing.minutes) return;
    const [{ total } = { total: 0 }] = await tx
      .select({ total: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
      .from(timeEntries)
      .where(and(eq(timeEntries.employeeId, employeeId), eq(timeEntries.workDate, date), replacing ? sql`${timeEntries.id} <> ${replacing.id}` : undefined));
    const refusal = dayLimitRefusal(total, minutes, caller.settings);
    if (refusal) throw new BadRequestException(refusal);
  }

  /** "+ Add task or work order": an empty row in the week, for something the caller can log on now. */
  addRow(ctx: TenantContext, input: AddRow): Promise<WeekView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx, input.employeeId);
        const employeeId = this.ownEmployee(caller);
        const [facts] = await rowFacts(tx, employeeId, input.taskId ? [input.taskId] : [], input.workOrderId ? [input.workOrderId] : []);
        if (!facts) throw new NotFoundException(input.taskId ? 'Task not found' : 'Work order not found');
        if (facts.refusal) throw refusalError(facts);
        await tx
          .insert(timesheetRows)
          .values({ tenantId: ctx.tenantId, employeeId, weekStart: input.weekStart, taskId: input.taskId ?? null, workOrderId: input.workOrderId ?? null })
          .onConflictDoNothing();
        return readWeek(tx, caller, input.weekStart);
      })
      .catch(mapDbError);
  }

  /** What Copy last week would do (its dialog): the rows it copies and the ones it skips, with why. */
  copyPreview(ctx: TenantContext, weekStart: string, forEmployeeId?: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx, forEmployeeId);
      const employeeId = this.ownEmployee(caller);
      const plan = copyPlan(await this.copySource(tx, employeeId, weekStart), await this.copyTarget(tx, caller, employeeId, weekStart), false, caller.settings);
      return { fromWeek: isoWeek(addDays(weekStart, -7)), toWeek: isoWeek(weekStart), rows: plan.rows.length, skipped: plan.skippedRows };
    });
  }

  /** Copy last week (spec 4.7): rows, and with `hours` the hours into empty cells; never overwrites. */
  copy(ctx: TenantContext, input: CopyWeek) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx, input.employeeId);
        const employeeId = this.ownEmployee(caller);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${employeeId}:week:${input.weekStart}`}, 0))`);
        for (const date of weekDates(input.weekStart)) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${employeeId}:${date}`}, 0))`);
        const plan = copyPlan(
          await this.copySource(tx, employeeId, input.weekStart),
          await this.copyTarget(tx, caller, employeeId, input.weekStart),
          input.mode === 'hours',
          caller.settings,
        );
        const split = (key: string) => {
          const [kind, id] = key.split(':') as [RowKind, string];
          return { taskId: kind === 'task' ? id : null, workOrderId: kind === 'work_order' ? id : null };
        };
        if (plan.rows.length) {
          await tx
            .insert(timesheetRows)
            .values(plan.rows.map((key) => ({ tenantId: ctx.tenantId, employeeId, weekStart: input.weekStart, ...split(key) })))
            .onConflictDoNothing();
        }
        const cells = [];
        // Block mode (CD-149): hours that would take someone past their limit on a task aren't copied.
        const added = new Map<string, number>();
        // Nothing is copied onto a full-day absence (CD-170, spec 14.2).
        const away = (await absencesIn(tx, [employeeId], input.weekStart, addDays(input.weekStart, 6))).get(employeeId) ?? new Map();
        for (const c of plan.cells.filter((c) => employed(c.date, caller.employment) && !away.has(c.date))) {
          const { taskId } = split(c.key);
          if (taskId) {
            const more = (added.get(taskId) ?? 0) + c.minutes;
            if (await hourLimitBlock(tx, ctx.tenantId, employeeId, taskId, more)) continue;
            added.set(taskId, more);
          }
          cells.push(c);
        }
        if (cells.length) {
          await tx
            .insert(timeEntries)
            .values(cells.map((c) => ({ tenantId: ctx.tenantId, employeeId, workDate: c.date, ...split(c.key), minutes: c.minutes, createdByUserId: ctx.userId })));
        }
        await this.audit.record(tx, ctx, {
          action: 'timesheet.copied',
          entityType: 'employee',
          entityId: employeeId,
          data: { weekStart: input.weekStart, mode: input.mode, rows: plan.rows.length, cells: cells.length },
        });
        await this.hoursChanged(tx, ctx.tenantId, employeeId, [...added.keys()]);
        const week = await readWeek(tx, caller, input.weekStart);
        return { week, copiedRows: plan.rows.length, copiedCells: cells.length, skipped: plan.skippedRows, fullDays: plan.fullDays };
      })
      .catch(mapDbError);
  }

  /**
   * Submit week (spec 5.3 T1): every required Draft day of the week up to the current week becomes
   * Submitted; rows still without hours go (spec 4.4). Rejected days are resubmitted on their own
   * (CD-158).
   */
  submit(ctx: TenantContext, weekStart: string, date?: string, forEmployeeId?: string): Promise<WeekView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx, forEmployeeId);
        const employeeId = this.ownEmployee(caller);
        if (weekStart > mondayOf(caller.today)) throw new BadRequestException('A week can be submitted once it has started');
        // A single day (CD-156): only in Day by day mode, and only a day Submit week would submit.
        if (date && caller.settings.approvalMode !== 'day') throw new BadRequestException('This workspace approves whole weeks: submit the week');
        const before = await readWeek(tx, caller, weekStart);
        const days = date ? before.submittable.filter((d) => d === date) : before.submittable;
        if (days.length === 0) throw new BadRequestException(date ? 'That day has nothing to submit' : 'Nothing to submit in this week');
        await submitDays(tx, ctx.tenantId, employeeId, weekStart, days, ctx.userId, caller.now, { dropEmptyRows: !date, approvalMode: caller.settings.approvalMode, actorName: await actorNameOf(tx, ctx.userId) });
        // A required day submitted for the first time after the deadline makes the week Late, for good (spec 5.5).
        const late = days.some((d) => before.lateIfSubmitted.includes(d));
        if (late) await markLate(tx, ctx.tenantId, employeeId, weekStart, caller.now);
        await this.audit.record(tx, ctx, { action: 'timesheet.submitted', entityType: 'employee', entityId: employeeId, data: { weekStart, days, late, ...(caller.onBehalf ? { onBehalf: true } : {}) } });
        return readWeek(tx, caller, weekStart);
      })
      .catch(mapDbError);
  }

  /**
   * Resubmit (spec 5.3 T5, CD-158): the week's Rejected days (or one of them in Day by day mode) go
   * back to Submitted, with an optional reply the approver sees; the other days keep their status
   * and the Late flag never changes. The approvers are emailed.
   */
  resubmit(ctx: TenantContext, weekStart: string, date?: string, reply: string | null = null, forEmployeeId?: string): Promise<WeekView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx, forEmployeeId);
        const employeeId = this.ownEmployee(caller);
        if (date && caller.settings.approvalMode !== 'day') throw new BadRequestException('This workspace approves whole weeks: resubmit the rejected days together');
        const before = await readWeek(tx, caller, weekStart);
        const days = date ? before.resubmittable.filter((d) => d === date) : before.resubmittable;
        if (days.length === 0) throw new BadRequestException(date ? 'That day is not rejected' : 'Nothing to resubmit in this week');
        const changed = await tx
          .update(timesheetDays)
          .set({ status: 'submitted', submittedAt: caller.now, submittedByUserId: ctx.userId, resubmittedAt: caller.now, reply })
          .where(and(eq(timesheetDays.employeeId, employeeId), inArray(timesheetDays.workDate, days), eq(timesheetDays.status, 'rejected')))
          .returning({ date: timesheetDays.workDate });
        if (changed.length !== days.length) throw new ConflictException('This week changed, please review it again');
        const actor = { userId: ctx.userId, name: await actorNameOf(tx, ctx.userId) };
        await recordDayEvents(tx, { tenantId: ctx.tenantId, employeeId, dates: days, kind: 'resubmitted', actor, comment: reply, approvalMode: caller.settings.approvalMode });
        await this.audit.record(tx, ctx, { action: 'timesheet.resubmitted', entityType: 'employee', entityId: employeeId, data: { weekStart, days, ...(reply ? { reply } : {}), ...(caller.onBehalf ? { onBehalf: true } : {}) } });
        const approvers = await this.people.approversFor(ctx.tenantId, employeeId, weekStart, tx);
        for (const a of approvers?.approvers ?? []) {
          if (a.userId === ctx.userId) continue;
          await this.jobs.send(
            'timesheet.notice-email',
            {
              tenantId: ctx.tenantId,
              kind: 'resubmitted',
              weekStart,
              recipientUserId: a.userId,
              week: { weekStart, weekNumber: before.weekNumber, deadline: before.deadline, enteredMinutes: before.days.reduce((s, d) => s + d.minutes, 0), expectedMinutes: before.days.reduce((s, d) => s + d.expectedMinutes, 0), missing: [] },
              resubmitted: { days, reply, employeeId, employeeName: caller.name },
            },
            tx,
          );
        }
        return readWeek(tx, caller, weekStart);
      })
      .catch(mapDbError);
  }

  /** Recall (spec 5.3 T2): the week's Submitted days go back to Draft; approved and rejected days stay. */
  recall(ctx: TenantContext, weekStart: string): Promise<WeekView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const employeeId = this.ownEmployee(caller);
        // Back to Draft, keeping when each day was first submitted (CD-155).
        const recalled = await tx
          .update(timesheetDays)
          .set({ status: 'draft' })
          .where(and(eq(timesheetDays.employeeId, employeeId), between(timesheetDays.workDate, weekStart, addDays(weekStart, 6)), eq(timesheetDays.status, 'submitted')))
          .returning({ date: timesheetDays.workDate });
        if (recalled.length === 0) throw new BadRequestException('Nothing to recall in this week');
        const dates = recalled.map((r) => r.date).sort();
        await recordDayEvents(tx, { tenantId: ctx.tenantId, employeeId, dates, kind: 'recalled', actor: { userId: ctx.userId, name: await actorNameOf(tx, ctx.userId) }, approvalMode: caller.settings.approvalMode });
        await this.audit.record(tx, ctx, { action: 'timesheet.recalled', entityType: 'employee', entityId: employeeId, data: { weekStart, days: dates } });
        return readWeek(tx, caller, weekStart);
      })
      .catch(mapDbError);
  }

  private ownEmployee(caller: Caller): string {
    if (!caller.employeeId) throw new ForbiddenException("You don't have an employee record in this workspace, so there is no timesheet to fill in");
    return caller.employeeId;
  }

  /**
   * Who the timesheet is for: the caller's own employee record, or with `forEmployeeId` someone
   * else's (CD-317, spec 9.4): Admins only (403 otherwise), any employee of the workspace (404
   * when there is none), marked `onBehalf` so every action says so in the history.
   */
  private async caller(ctx: TenantContext, tx: Tx, forEmployeeId?: string): Promise<Caller & { thisWeekEnd: string }> {
    const access = await this.people.of(ctx, tx);
    const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const now = new Date();
    const timeZone = tenant?.timezone ?? 'UTC';
    const today = zonedParts(now, timeZone).date;
    const settings = await timesheetSettings(tx, ctx.tenantId);
    const onBehalf = !!forEmployeeId && forEmployeeId !== access.employeeId;
    if (onBehalf && !access.isAdmin) throw new ForbiddenException('Only Admins can enter time for someone else');
    const employeeId = onBehalf ? forEmployeeId! : access.employeeId;
    let name = '';
    let employment: Employment = { start: null, end: null };
    if (employeeId) {
      const [e] = await tx
        .select({ name: employees.fullName, start: employees.employmentStartDate, end: employees.employmentEndDate })
        .from(employees)
        .where(eq(employees.id, employeeId));
      if (!e && onBehalf) throw new NotFoundException('Employee not found');
      name = e?.name ?? '';
      employment = { start: e?.start ?? null, end: e?.end ?? null };
    }
    return { employeeId, name, employment, today, settings, timeZone, now, onBehalf, thisWeekEnd: addDays(mondayOf(today), 6) };
  }

  /** Last week's rows (entries and added rows), with why each can't be copied. */
  private async copySource(tx: Tx, employeeId: string, weekStart: string): Promise<CopySourceRow[]> {
    const from = addDays(weekStart, -7);
    const [entries, added] = await Promise.all([
      tx
        .select({ date: timeEntries.workDate, taskId: timeEntries.taskId, workOrderId: timeEntries.workOrderId, minutes: timeEntries.minutes })
        .from(timeEntries)
        .where(and(eq(timeEntries.employeeId, employeeId), between(timeEntries.workDate, from, addDays(from, 6)))),
      tx
        .select({ taskId: timesheetRows.taskId, workOrderId: timesheetRows.workOrderId })
        .from(timesheetRows)
        .where(and(eq(timesheetRows.employeeId, employeeId), eq(timesheetRows.weekStart, from))),
    ]);
    const all = [...entries, ...added];
    const facts = await rowFacts(
      tx,
      employeeId,
      [...new Set(all.flatMap((e) => (e.taskId ? [e.taskId] : [])))],
      [...new Set(all.flatMap((e) => (e.workOrderId ? [e.workOrderId] : [])))],
    );
    return facts
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1) || a.code.localeCompare(b.code, undefined, { numeric: true }))
      .map((f) => {
        const minutes: Record<string, number> = {};
        for (const e of entries) if ((f.kind === 'task' ? e.taskId : e.workOrderId) === f.id) minutes[e.date] = (minutes[e.date] ?? 0) + e.minutes;
        const label = f.kind === 'task' ? `task ${f.code}` : f.code;
        return { key: keyOf(f.kind, f.id), label, refusal: f.refusal ? COPY_REASONS[f.refusal] ?? 'is closed' : null, minutes };
      });
  }

  private async copyTarget(tx: Tx, caller: Caller, employeeId: string, weekStart: string) {
    const sunday = addDays(weekStart, 6);
    const [entries, dayRows] = await Promise.all([
      tx
        .select({ date: timeEntries.workDate, taskId: timeEntries.taskId, workOrderId: timeEntries.workOrderId, minutes: timeEntries.minutes })
        .from(timeEntries)
        .where(and(eq(timeEntries.employeeId, employeeId), between(timeEntries.workDate, weekStart, sunday))),
      tx
        .select({ date: timesheetDays.workDate, status: timesheetDays.status })
        .from(timesheetDays)
        .where(and(eq(timesheetDays.employeeId, employeeId), between(timesheetDays.workDate, weekStart, sunday))),
    ]);
    const cells = new Map<string, number>();
    const dayMinutes: Record<string, number> = {};
    for (const e of entries) {
      const key = `${e.taskId ? keyOf('task', e.taskId) : keyOf('work_order', e.workOrderId!)}|${e.date}`;
      cells.set(key, (cells.get(key) ?? 0) + e.minutes);
      dayMinutes[e.date] = (dayMinutes[e.date] ?? 0) + e.minutes;
    }
    return {
      monday: weekStart,
      lastDate: addDays(mondayOf(caller.today), 6),
      cellMinutes: (key: string, date: string) => cells.get(`${key}|${date}`) ?? 0,
      dayMinutes,
      dayStatus: Object.fromEntries(dayRows.map((d) => [d.date, d.status])),
    };
  }
}

/** The facts about tasks and work orders for one person: names, paths, whether they can log on them, their limit. */
export async function rowFacts(tx: Tx, employeeId: string, taskIds: string[], orderIds: string[]): Promise<RowFacts[]> {
  const facts: RowFacts[] = [];
  if (taskIds.length) {
    const rows = await tx
      .select({
        id: tasks.id,
        number: tasks.number,
        name: tasks.name,
        status: tasks.status,
        projectName: projects.name,
        projectStatus: projects.status,
        companyName: companies.name,
        active: taskAssignments.active,
        hourLimit: taskAssignments.hourLimit,
      })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(companies, eq(companies.id, projects.companyId))
      .leftJoin(taskAssignments, and(eq(taskAssignments.taskId, tasks.id), eq(taskAssignments.employeeId, employeeId)))
      .where(inArray(tasks.id, taskIds));
    for (const r of rows) {
      facts.push({
        kind: 'task',
        id: r.id,
        code: `T-${r.number}`,
        name: r.name,
        path: pathOf(r.companyName, r.projectName),
        refusal: logTimeRefusal({ taskStatus: r.status, projectStatus: r.projectStatus, assignment: r.active === null ? null : { active: r.active } }),
        limitMinutes: r.active && r.hourLimit != null ? Math.round(r.hourLimit * 60) : null,
      });
    }
  }
  if (orderIds.length) {
    const rows = await tx
      .select({
        id: workOrders.id,
        number: workOrders.number,
        title: workOrders.title,
        status: workOrders.status,
        companyName: companies.name,
        projectName: projects.name,
        projectStatus: projects.status,
        technician: workOrderTechnicians.employeeId,
      })
      .from(workOrders)
      .innerJoin(companies, eq(companies.id, workOrders.companyId))
      .leftJoin(projects, eq(projects.id, workOrders.projectId))
      .leftJoin(workOrderTechnicians, and(eq(workOrderTechnicians.workOrderId, workOrders.id), eq(workOrderTechnicians.employeeId, employeeId)))
      .where(inArray(workOrders.id, orderIds));
    for (const r of rows) {
      const refusal = workOrderLogRefusal({ status: r.status, isTechnician: r.technician !== null });
      facts.push({
        kind: 'work_order',
        id: r.id,
        code: `WO-${r.number}`,
        name: r.title,
        path: pathOf(r.companyName, r.projectName),
        refusal: refusal ?? (r.projectStatus && r.projectStatus !== 'open' ? 'project_closed' : null),
        limitMinutes: null,
      });
    }
  }
  return facts;
}

export async function readWeek(tx: Tx, caller: Caller, monday: string): Promise<WeekView> {
  const dates = weekDates(monday);
  const sunday = dates[6]!;
  const lastDate = addDays(mondayOf(caller.today), 6);
  const settings = caller.settings;
  // The week's holidays, and those a deadline in the next weeks may move past.
  const holidays = await holidaysBetween(tx, monday, addDays(monday, 45));
  const deadline = deadlineOf(monday, settings, (d) => holidays.has(d));
  const deadlinePassed = deadlineInstant(zonedDayStart(deadline.date, caller.timeZone), deadline.time) <= caller.now;
  const base = {
    weekStart: monday,
    weekNumber: isoWeek(monday),
    label: weekLabel(monday),
    today: caller.today,
    thisWeek: mondayOf(caller.today),
    deadline,
    settings: { dayMinutes: settings.dayMinutes, maxDayMinutes: settings.maxDayMinutes, timeFormat: settings.timeFormat, approvalMode: settings.approvalMode },
  };
  const employeeId = caller.employeeId;
  if (!employeeId) {
    return { ...base, employee: null, status: 'no_entry', statusLabel: 'No entry needed', submittable: [], resubmittable: [], canRecall: false, late: false, autoSubmitted: false, onBehalf: false, deadlinePassed, lateIfSubmitted: [], days: [], rows: [] };
  }
  const [entries, added, dayRows, [flags], onBehalfRows] = await Promise.all([
    tx
      .select({ date: timeEntries.workDate, taskId: timeEntries.taskId, workOrderId: timeEntries.workOrderId, minutes: timeEntries.minutes, note: timeEntries.note })
      .from(timeEntries)
      .where(and(eq(timeEntries.employeeId, employeeId), between(timeEntries.workDate, monday, sunday))),
    tx
      .select({ taskId: timesheetRows.taskId, workOrderId: timesheetRows.workOrderId, createdAt: timesheetRows.createdAt })
      .from(timesheetRows)
      .where(and(eq(timesheetRows.employeeId, employeeId), eq(timesheetRows.weekStart, monday))),
    tx
      .select({
        date: timesheetDays.workDate,
        status: timesheetDays.status,
        submittedAt: timesheetDays.submittedAt,
        firstSubmittedAt: timesheetDays.firstSubmittedAt,
        comment: timesheetDays.comment,
        returnedAt: timesheetDays.returnedAt,
        returnedBy: returner.displayName,
        approvedAt: timesheetDays.approvedAt,
        approvedBy: approver.displayName,
        approvedExpectedMinutes: timesheetDays.approvedExpectedMinutes,
        approvedMinutes: timesheetDays.approvedMinutes,
        resubmittedAt: timesheetDays.resubmittedAt,
        reply: timesheetDays.reply,
      })
      .from(timesheetDays)
      .leftJoin(returner, eq(returner.id, timesheetDays.returnedByUserId))
      .leftJoin(approver, eq(approver.id, timesheetDays.approvedByUserId))
      .where(and(eq(timesheetDays.employeeId, employeeId), between(timesheetDays.workDate, monday, sunday))),
    tx
      .select({ lateAt: timesheetWeeks.lateAt, autoSubmittedAt: timesheetWeeks.autoSubmittedAt })
      .from(timesheetWeeks)
      .where(and(eq(timesheetWeeks.employeeId, employeeId), eq(timesheetWeeks.weekStart, monday))),
    // Submitted by someone other than the employee's own account (CD-317): an Admin on their behalf.
    tx.execute<{ on_behalf: boolean }>(sql`
      select exists(select 1 from timesheet_day_events e join employees p on p.id = e.employee_id
        where e.employee_id = ${employeeId} and e.work_date between ${monday} and ${sunday}
          and e.kind in ('submitted', 'resubmitted') and e.actor_user_id is not null
          and (p.user_id is null or p.user_id <> e.actor_user_id)) as on_behalf`),
  ]);
  const [absences, pending, absenceEvents] = await Promise.all([
    absencesIn(tx, [employeeId], monday, sunday).then((m) => m.get(employeeId) ?? new Map<string, AbsenceLine>()),
    pendingAbsenceRegistry.pendingIn(tx, employeeId, monday, sunday),
    tx
      .select({ date: timesheetDayEvents.workDate, kind: timesheetDayEvents.kind, comment: timesheetDayEvents.comment })
      .from(timesheetDayEvents)
      .where(and(eq(timesheetDayEvents.employeeId, employeeId), between(timesheetDayEvents.workDate, monday, sunday)))
      .orderBy(asc(timesheetDayEvents.createdAt)),
  ]);
  const taskIds = [...new Set([...entries, ...added].flatMap((e) => (e.taskId ? [e.taskId] : [])))];
  const orderIds = [...new Set([...entries, ...added].flatMap((e) => (e.workOrderId ? [e.workOrderId] : [])))];
  const facts = await rowFacts(tx, employeeId, taskIds, orderIds);
  const limited = facts.filter((f) => f.limitMinutes != null).map((f) => f.id);
  const logged = new Map<string, number>();
  if (limited.length) {
    const sums = await tx
      .select({ taskId: timeEntries.taskId, minutes: sql<number>`sum(${timeEntries.minutes})::int` })
      .from(timeEntries)
      .where(and(eq(timeEntries.employeeId, employeeId), inArray(timeEntries.taskId, limited)))
      .groupBy(timeEntries.taskId);
    for (const s of sums) logged.set(s.taskId!, s.minutes);
  }

  const rows = new Map<string, RowView>();
  for (const f of facts) {
    rows.set(keyOf(f.kind, f.id), {
      key: keyOf(f.kind, f.id),
      kind: f.kind,
      id: f.id,
      code: f.code,
      name: f.name,
      path: f.path,
      lockedReason: reasonOf(f),
      edit: !f.refusal ? 'any' : f.refusal === 'not_assigned' || f.refusal === 'not_technician' ? 'existing' : 'none',
      limit: f.limitMinutes != null ? { limitMinutes: f.limitMinutes, loggedMinutes: logged.get(f.id) ?? 0 } : null,
      cells: {},
      minutes: 0,
    });
  }
  const perDay: Record<string, number> = {};
  for (const e of entries) {
    const row = rows.get(e.taskId ? keyOf('task', e.taskId) : keyOf('work_order', e.workOrderId!));
    if (!row) continue;
    const cell = (row.cells[e.date] ??= { minutes: 0, note: null, entries: 0 });
    cell.minutes += e.minutes;
    cell.entries += 1;
    cell.note = cell.entries === 1 ? e.note : null;
    row.minutes += e.minutes;
    perDay[e.date] = (perDay[e.date] ?? 0) + e.minutes;
  }

  const statusOf = new Map(dayRows.map((d) => [d.date, d]));
  const days: DayView[] = dates.map((date) => {
    const holiday = holidays.get(date);
    const off = holidayMinutes(date, settings, holiday);
    const expected = expectedMinutes(date, settings, caller.employment, holiday);
    const absence = absences.get(date) ?? null;
    const taskMinutes = perDay[date] ?? 0;
    // An absence's hours count as entered (spec 14.1): the day needs no task hours.
    const minutes = taskMinutes + (absence?.minutes ?? 0);
    const status = statusOf.get(date)?.status ?? 'draft';
    return {
      holiday: holiday && off > 0 ? { name: holiday.name, minutes: off } : null,
      absence: absence ? { kind: absence.kind, label: absence.label, minutes: absence.minutes } : null,
      pendingAbsence: absence ? null : (pending.get(date) ?? null),
      flags: absenceFlags(status, absenceEvents.filter((e) => e.date === date), !!absence, taskMinutes, expected),
      date,
      status,
      submittedAt: statusOf.get(date)?.submittedAt?.toISOString() ?? null,
      comment: statusOf.get(date)?.comment ?? null,
      returnedAt: statusOf.get(date)?.returnedAt?.toISOString() ?? null,
      returnedBy: statusOf.get(date)?.returnedBy ?? null,
      approvedAt: statusOf.get(date)?.approvedAt?.toISOString() ?? null,
      approvedBy: statusOf.get(date)?.approvedBy ?? null,
      approvedExpectedMinutes: statusOf.get(date)?.approvedExpectedMinutes ?? null,
      approvedMinutes: statusOf.get(date)?.approvedMinutes ?? null,
      resubmittedAt: statusOf.get(date)?.resubmittedAt?.toISOString() ?? null,
      reply: statusOf.get(date)?.reply ?? null,
      expectedMinutes: expected,
      minutes,
      required: isRequired(expected, minutes),
      editable: (status === 'draft' || status === 'rejected') && date <= lastDate && employed(date, caller.employment),
    };
  });
  const weekDays: WeekDay[] = days.map((d) => ({ date: d.date, status: d.status, required: d.required, minutes: d.minutes }));
  const { status, label } = weekStatus(weekDays);
  const submittable = submittableDays(weekDays, caller.today);
  // Tasks first, then work orders; each by its path, then its number.
  const ordered = [...rows.values()].sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1) || a.path.localeCompare(b.path) || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
  return {
    ...base,
    employee: { id: employeeId, name: caller.name },
    status,
    statusLabel: label,
    submittable,
    resubmittable: resubmittableDays(weekDays),
    canRecall: days.some((d) => d.status === 'submitted'),
    deadlinePassed,
    lateIfSubmitted: deadlinePassed ? submittable.filter((d) => !statusOf.get(d)?.firstSubmittedAt) : [],
    late: !!flags?.lateAt,
    autoSubmitted: !!flags?.autoSubmittedAt,
    onBehalf: !!onBehalfRows.rows[0]?.on_behalf,
    days,
    rows: ordered,
  };
}

/** The week is Late from `now` on (spec 5.5): set once, never cleared or moved. */
export async function markLate(tx: Tx, tenantId: string, employeeId: string, weekStart: string, now: Date) {
  await tx
    .insert(timesheetWeeks)
    .values({ tenantId, employeeId, weekStart, lateAt: now })
    .onConflictDoUpdate({
      target: [timesheetWeeks.tenantId, timesheetWeeks.employeeId, timesheetWeeks.weekStart],
      set: { lateAt: sql`coalesce(${timesheetWeeks.lateAt}, excluded.late_at)` },
    });
}

/** Who acts, as the history names them (CD-157): the member's display name now, kept as it was. */
export async function actorNameOf(tx: Tx, userId: string): Promise<string | null> {
  const [u] = await tx.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
  return u?.name ?? null;
}

export interface DayEvents {
  tenantId: string;
  employeeId: string;
  dates: string[];
  kind: TimesheetDayEventKind;
  /** Null user: the deadline job. */
  actor: { userId: string | null; name: string | null };
  comment?: string | null;
  approvalMode: TimesheetSettings['approvalMode'];
}

/** Writes one history row per day (spec 9.5; `timesheet_day_events` is append-only). */
export async function recordDayEvents(tx: Tx, e: DayEvents): Promise<void> {
  if (!e.dates.length) return;
  await tx.insert(timesheetDayEvents).values(
    e.dates.map((workDate) => ({ tenantId: e.tenantId, employeeId: e.employeeId, workDate, kind: e.kind, actorUserId: e.actor.userId, actorName: e.actor.name, comment: e.comment ?? null, approvalMode: e.approvalMode })),
  );
}

/**
 * Submits `days` of one person's week (spec 5.3 T1): they become Submitted (only Draft ones; a
 * Rejected or Approved day is left alone) and, for the whole week, rows still without hours go
 * (spec 4.4). `userId` null: the deadline job (CD-153). Each day gets a history row (CD-157).
 */
export async function submitDays(
  tx: Tx,
  tenantId: string,
  employeeId: string,
  weekStart: string,
  days: string[],
  userId: string | null,
  now: Date,
  opts: { dropEmptyRows?: boolean; approvalMode: TimesheetSettings['approvalMode']; actorName?: string | null },
) {
  // A single day (CD-156) leaves the week's empty rows: the rest of the week isn't done.
  if (opts.dropEmptyRows !== false) await tx.execute(sql`
    delete from timesheet_rows r where r.employee_id = ${employeeId} and r.week_start = ${weekStart}
      and not exists (select 1 from time_entries e where e.employee_id = r.employee_id and e.work_date between ${weekStart} and ${addDays(weekStart, 6)}
        and (e.task_id = r.task_id or e.work_order_id = r.work_order_id))`);
  if (!days.length) return;
  await tx
    .insert(timesheetDays)
    .values(days.map((workDate) => ({ tenantId, employeeId, workDate, status: 'submitted' as const, submittedAt: now, submittedByUserId: userId, firstSubmittedAt: now })))
    .onConflictDoUpdate({
      target: [timesheetDays.tenantId, timesheetDays.employeeId, timesheetDays.workDate],
      set: { status: 'submitted', submittedAt: now, submittedByUserId: userId, firstSubmittedAt: sql`coalesce(${timesheetDays.firstSubmittedAt}, excluded.first_submitted_at)` },
      setWhere: sql`${timesheetDays.status} = 'draft'`,
    });
  await recordDayEvents(tx, { tenantId, employeeId, dates: days, kind: userId ? 'submitted' : 'auto_submitted', actor: { userId, name: opts.actorName ?? null }, approvalMode: opts.approvalMode });
}

/**
 * What the approver should know about a day's absence (spec 14.3), from its history: changes the
 * time off module made since the day was last submitted or approved, a locked day carrying both an
 * absence and task hours, and a locked day left without hours after its absence was removed.
 */
export function absenceFlags(status: TimesheetDayStatus, events: readonly { kind: string; comment: string | null }[], hasAbsence: boolean, taskMinutes: number, expected: number): string[] {
  const flags: string[] = [];
  let last = -1;
  events.forEach((e, i) => {
    if (e.kind !== 'absence_changed') last = i;
  });
  const since = events.slice(last + 1).filter((e) => e.kind === 'absence_changed' && e.comment);
  if (since.length && (status === 'submitted' || status === 'approved')) flags.push(`Changed after ${status === 'submitted' ? 'submission' : 'approval'}: ${since.map((e) => e.comment).join(', ')}`);
  if (status === 'approved' && hasAbsence && taskMinutes > 0) flags.push('Conflict: absence and task hours');
  if (status === 'approved' && !hasAbsence && taskMinutes === 0 && expected > 0 && since.some((e) => e.comment!.endsWith('removed'))) flags.push('Missing hours after absence removed');
  return flags;
}
