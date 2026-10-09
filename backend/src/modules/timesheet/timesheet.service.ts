import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { and, between, eq, inArray, sql } from 'drizzle-orm';
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
  timesheetDays,
  timesheetRows,
  type TimesheetDayStatus,
  timesheetWeeks,
  workOrders,
  workOrderTechnicians,
} from '../../shared/database/schema';
import { zonedParts } from '../../shared/time/zoned-time';
import { PeopleAccess } from '../people';
import { loggableTasks, loggableWorkOrders, type LogTimeRefusal, logTimeRefusal, type WorkOrderLogRefusal, workOrderLogRefusal } from '../projects';
import {
  addDays,
  copyPlan,
  type CopySourceRow,
  dayLimitRefusal,
  deadlineOf,
  type Employment,
  employed,
  endAfter,
  expectedMinutes,
  holidayMinutes,
  isoWeek,
  isRequired,
  mondayOf,
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
  canRecall: boolean;
  /** Flags on the week (spec 5.2): first submitted after the deadline; submitted by the deadline job (CD-153). */
  late: boolean;
  autoSubmitted: boolean;
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

/** One writer per person and day, so two tabs can't pass the daily maximum together. */
const lockDay = (tx: Tx, employeeId: string, date: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${employeeId}:${date}`}, 0))`);

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
  ) {}

  week(ctx: TenantContext, weekStart?: string): Promise<WeekView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      return readWeek(tx, caller, weekStart ?? mondayOf(caller.today));
    });
  }

  /** What "+ Add task or work order" offers: tasks and work orders the caller can log on now. */
  loggable(ctx: TenantContext): Promise<PickerItem[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
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
        const caller = await this.caller(ctx, tx);
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
        if (input.minutes === 0) {
          if (entry) await tx.delete(timeEntries).where(eq(timeEntries.id, entry.id));
        } else {
          const [{ total } = { total: 0 }] = await tx
            .select({ total: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
            .from(timeEntries)
            .where(and(mine, entry ? sql`${timeEntries.id} <> ${entry.id}` : undefined));
          const refusal = entry && input.minutes <= entry.minutes ? null : dayLimitRefusal(total, input.minutes, caller.settings);
          if (refusal) throw new BadRequestException(refusal);
          if (entry) await tx.update(timeEntries).set({ minutes: input.minutes, note, ...keepSpan(entry.startTime, input.minutes) }).where(eq(timeEntries.id, entry.id));
          else await tx.insert(timeEntries).values({ tenantId: ctx.tenantId, employeeId, workDate: input.date, taskId: input.taskId ?? null, workOrderId: input.workOrderId ?? null, minutes: input.minutes, note, createdByUserId: ctx.userId });
        }
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
        await this.checkDayLimit(tx, caller, employeeId, input.date, span.minutes, null);
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
        await this.checkDayLimit(tx, caller, employeeId, date, span.minutes, date === entry.workDate ? entry : null);
        const [row] = await tx
          .update(timeEntries)
          .set({ workDate: date, ...span, ...(input.note !== undefined ? { note: input.note } : {}) })
          .where(eq(timeEntries.id, id))
          .returning();
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
        await this.ownEntry(tx, employeeId, id);
        await tx.delete(timeEntries).where(eq(timeEntries.id, id));
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
        const caller = await this.caller(ctx, tx);
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
  copyPreview(ctx: TenantContext, weekStart: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const caller = await this.caller(ctx, tx);
      const employeeId = this.ownEmployee(caller);
      const plan = copyPlan(await this.copySource(tx, employeeId, weekStart), await this.copyTarget(tx, caller, employeeId, weekStart), false, caller.settings);
      return { fromWeek: isoWeek(addDays(weekStart, -7)), toWeek: isoWeek(weekStart), rows: plan.rows.length, skipped: plan.skippedRows };
    });
  }

  /** Copy last week (spec 4.7): rows, and with `hours` the hours into empty cells; never overwrites. */
  copy(ctx: TenantContext, input: CopyWeek) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
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
        const cells = plan.cells.filter((c) => employed(c.date, caller.employment));
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
  submit(ctx: TenantContext, weekStart: string, date?: string): Promise<WeekView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const caller = await this.caller(ctx, tx);
        const employeeId = this.ownEmployee(caller);
        if (weekStart > mondayOf(caller.today)) throw new BadRequestException('A week can be submitted once it has started');
        // A single day (CD-156): only in Day by day mode, and only a day Submit week would submit.
        if (date && caller.settings.approvalMode !== 'day') throw new BadRequestException('This workspace approves whole weeks: submit the week');
        const before = await readWeek(tx, caller, weekStart);
        const days = date ? before.submittable.filter((d) => d === date) : before.submittable;
        if (days.length === 0) throw new BadRequestException(date ? 'That day has nothing to submit' : 'Nothing to submit in this week');
        await submitDays(tx, ctx.tenantId, employeeId, weekStart, days, ctx.userId, new Date(), { dropEmptyRows: !date });
        await this.audit.record(tx, ctx, { action: 'timesheet.submitted', entityType: 'employee', entityId: employeeId, data: { weekStart, days } });
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
        const recalled = await tx
          .delete(timesheetDays)
          .where(and(eq(timesheetDays.employeeId, employeeId), between(timesheetDays.workDate, weekStart, addDays(weekStart, 6)), eq(timesheetDays.status, 'submitted')))
          .returning({ date: timesheetDays.workDate });
        if (recalled.length === 0) throw new BadRequestException('Nothing to recall in this week');
        await this.audit.record(tx, ctx, { action: 'timesheet.recalled', entityType: 'employee', entityId: employeeId, data: { weekStart, days: recalled.map((r) => r.date).sort() } });
        return readWeek(tx, caller, weekStart);
      })
      .catch(mapDbError);
  }

  private ownEmployee(caller: Caller): string {
    if (!caller.employeeId) throw new ForbiddenException("You don't have an employee record in this workspace, so there is no timesheet to fill in");
    return caller.employeeId;
  }

  private async caller(ctx: TenantContext, tx: Tx): Promise<Caller & { thisWeekEnd: string }> {
    const access = await this.people.of(ctx, tx);
    const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const today = zonedParts(new Date(), tenant?.timezone ?? 'UTC').date;
    const settings = await timesheetSettings(tx, ctx.tenantId);
    let name = '';
    let employment: Employment = { start: null, end: null };
    if (access.employeeId) {
      const [e] = await tx
        .select({ name: employees.fullName, start: employees.employmentStartDate, end: employees.employmentEndDate })
        .from(employees)
        .where(eq(employees.id, access.employeeId));
      name = e?.name ?? '';
      employment = { start: e?.start ?? null, end: e?.end ?? null };
    }
    return { employeeId: access.employeeId, name, employment, today, settings, thisWeekEnd: addDays(mondayOf(today), 6) };
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
  const base = {
    weekStart: monday,
    weekNumber: isoWeek(monday),
    label: weekLabel(monday),
    today: caller.today,
    thisWeek: mondayOf(caller.today),
    deadline: deadlineOf(monday, settings, (d) => holidays.has(d)),
    settings: { dayMinutes: settings.dayMinutes, maxDayMinutes: settings.maxDayMinutes, timeFormat: settings.timeFormat, approvalMode: settings.approvalMode },
  };
  const employeeId = caller.employeeId;
  if (!employeeId) {
    return { ...base, employee: null, status: 'no_entry', statusLabel: 'No entry needed', submittable: [], canRecall: false, late: false, autoSubmitted: false, days: [], rows: [] };
  }
  const [entries, added, dayRows, [flags]] = await Promise.all([
    tx
      .select({ date: timeEntries.workDate, taskId: timeEntries.taskId, workOrderId: timeEntries.workOrderId, minutes: timeEntries.minutes, note: timeEntries.note })
      .from(timeEntries)
      .where(and(eq(timeEntries.employeeId, employeeId), between(timeEntries.workDate, monday, sunday))),
    tx
      .select({ taskId: timesheetRows.taskId, workOrderId: timesheetRows.workOrderId, createdAt: timesheetRows.createdAt })
      .from(timesheetRows)
      .where(and(eq(timesheetRows.employeeId, employeeId), eq(timesheetRows.weekStart, monday))),
    tx
      .select({ date: timesheetDays.workDate, status: timesheetDays.status, submittedAt: timesheetDays.submittedAt })
      .from(timesheetDays)
      .where(and(eq(timesheetDays.employeeId, employeeId), between(timesheetDays.workDate, monday, sunday))),
    tx
      .select({ lateAt: timesheetWeeks.lateAt, autoSubmittedAt: timesheetWeeks.autoSubmittedAt })
      .from(timesheetWeeks)
      .where(and(eq(timesheetWeeks.employeeId, employeeId), eq(timesheetWeeks.weekStart, monday))),
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
    const minutes = perDay[date] ?? 0;
    const status = statusOf.get(date)?.status ?? 'draft';
    return {
      holiday: holiday && off > 0 ? { name: holiday.name, minutes: off } : null,
      date,
      status,
      submittedAt: statusOf.get(date)?.submittedAt?.toISOString() ?? null,
      expectedMinutes: expected,
      minutes,
      required: isRequired(expected, minutes),
      editable: (status === 'draft' || status === 'rejected') && date <= lastDate && employed(date, caller.employment),
    };
  });
  const weekDays: WeekDay[] = days.map((d) => ({ date: d.date, status: d.status, required: d.required, minutes: d.minutes }));
  const { status, label } = weekStatus(weekDays);
  // Tasks first, then work orders; each by its path, then its number.
  const ordered = [...rows.values()].sort(
    (a, b) => (a.kind === b.kind ? 0 : a.kind === 'task' ? -1 : 1) || a.path.localeCompare(b.path) || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );
  return {
    ...base,
    employee: { id: employeeId, name: caller.name },
    status,
    statusLabel: label,
    submittable: submittableDays(weekDays, caller.today),
    canRecall: days.some((d) => d.status === 'submitted'),
    late: !!flags?.lateAt,
    autoSubmitted: !!flags?.autoSubmittedAt,
    days,
    rows: ordered,
  };
}

/**
 * Submits `days` of one person's week (spec 5.3 T1): they become Submitted (only Draft ones; a
 * Rejected or Approved day is left alone) and, for the whole week, rows still without hours go
 * (spec 4.4). `userId` null: the deadline job (CD-153).
 */
export async function submitDays(tx: Tx, tenantId: string, employeeId: string, weekStart: string, days: string[], userId: string | null, now: Date, opts: { dropEmptyRows?: boolean } = {}) {
  // A single day (CD-156) leaves the week's empty rows: the rest of the week isn't done.
  if (opts.dropEmptyRows !== false) await tx.execute(sql`
    delete from timesheet_rows r where r.employee_id = ${employeeId} and r.week_start = ${weekStart}
      and not exists (select 1 from time_entries e where e.employee_id = r.employee_id and e.work_date between ${weekStart} and ${addDays(weekStart, 6)}
        and (e.task_id = r.task_id or e.work_order_id = r.work_order_id))`);
  if (!days.length) return;
  await tx
    .insert(timesheetDays)
    .values(days.map((workDate) => ({ tenantId, employeeId, workDate, status: 'submitted' as const, submittedAt: now, submittedByUserId: userId })))
    .onConflictDoUpdate({
      target: [timesheetDays.tenantId, timesheetDays.employeeId, timesheetDays.workDate],
      set: { status: 'submitted', submittedAt: now, submittedByUserId: userId },
      setWhere: sql`${timesheetDays.status} = 'draft'`,
    });
}
