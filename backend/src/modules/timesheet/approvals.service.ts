import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, between, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employees, tasks, tenants, timeEntries, timesheetDayEvents, timesheetDays, type TimesheetDayStatus, timesheetWeeks, workOrders } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { zonedDayStart, zonedParts } from '../../shared/time/zoned-time';
import { type CallerAccess, PeopleAccess } from '../people';
import { approvableDays, type ApprovalRight, approvalRight, type ApprovalTarget, type DayPick, returnableDays, unlockableDays } from './approval-rules';
import { callerFor } from './deadlines';
import { addDays, deadlineInstant, deadlineOf, expectedMinutes, isoWeek, isRequired, mondayOf, submittableDays, type TimesheetSettings, type WeekDay, weekDates, weekLabel, weekStatus, type WeekStatus } from './timesheet-rules';
import { actorNameOf, readWeek, recordDayEvents, type WeekView } from './timesheet.service';
import { holidaysBetween, timesheetSettings } from './timesheet-settings';

/** One employee's week on the Approvals list (CD-157, design `#cd-157`). */
export interface ApprovalRow {
  employee: { id: string; name: string; jobTitle: string | null };
  /** What the caller may do with it: approve and return, the same as an Admin override, or only look. */
  right: ApprovalRight;
  status: WeekStatus;
  statusLabel: string;
  late: boolean;
  autoSubmitted: boolean;
  days: { date: string; status: TimesheetDayStatus; required: boolean; minutes: number }[];
  enteredMinutes: number;
  expectedMinutes: number;
  /** Required days never submitted that Submit week would send: "Not submitted" after the deadline. */
  missing: string[];
  /** Submitted days waiting for the approver (of them, the ones resubmitted after a return, CD-158), and days returned to the employee. */
  waiting: number;
  resubmitted: number;
  returned: number;
  /** Approve week is possible now (Whole week mode: no required Draft or Rejected day left). */
  approvable: boolean;
  /** A day was submitted or resubmitted by an Admin on the employee's behalf (CD-317). */
  onBehalf: boolean;
}

export interface ApprovalsView {
  weekStart: string;
  weekNumber: number;
  label: string;
  thisWeek: string;
  deadline: { date: string; time: string };
  deadlinePassed: boolean;
  approvalMode: TimesheetSettings['approvalMode'];
  timeFormat: TimesheetSettings['timeFormat'];
  rows: ApprovalRow[];
}

/** One person's week for their approver: the week as the Timesheet shows it, and what the caller may do. */
export interface ApproverWeek {
  week: WeekView;
  right: ApprovalRight;
  /** Days the caller submitted or resubmitted on the employee's behalf (CD-317): someone else must approve them. */
  enteredByMe: string[];
}

/** An entry as the history trigger snapshots it (`timesheet_entry_json`, drizzle/0091). */
interface EntrySnapshot {
  employeeId: string;
  date: string;
  taskId: string | null;
  workOrderId: string | null;
  minutes: number;
  note: string | null;
}

/** The week's history (spec 9.5): status events and entry changes, oldest first. */
export interface WeekHistory {
  events: { date: string; kind: string; actorName: string | null; onBehalf: boolean; comment: string | null; approvalMode: 'week' | 'day'; at: string }[];
  changes: { at: string; actorName: string | null; onBehalf: boolean; date: string; action: 'created' | 'updated' | 'deleted'; field: string | null; from: unknown; to: unknown; row: string; minutes: number; note: string | null }[];
}

const manager = alias(employees, 'manager');

/**
 * Approvals (CD-157, spec 8): the list of the weeks the caller approves (direct reports; every
 * employee for Admins, who may also override a manager, recorded), one person's week, Approve and
 * Return. Who approves is `approvalRight` (approval-rules.ts), resolved now, never stored; each
 * decision writes the days, their history (`timesheet_day_events`) and the audit log, and a return
 * emails the employee. The lock trigger on time_entries then refuses changes to approved days.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly people: PeopleAccess,
  ) {}

  private async context(tx: Tx, tenantId: string) {
    const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const timeZone = tenant?.timezone ?? 'UTC';
    const now = new Date();
    return { settings: await timesheetSettings(tx, tenantId), timeZone, now, today: zonedParts(now, timeZone).date };
  }

  /**
   * The employees whose weeks the caller sees: Admins every active employee with a required
   * timesheet, managers their direct and indirect reports; with their reporting line for the rule.
   * People without an app account are listed too: an Admin enters their time on their behalf (CD-317).
   */
  private async visible(tx: Tx, access: CallerAccess) {
    const ids = access.isAdmin ? null : [...access.reportIds];
    if (ids && ids.length === 0) return [];
    return tx
      .select({
        id: employees.id,
        name: employees.fullName,
        jobTitle: employees.jobTitle,
        userId: employees.userId,
        start: employees.employmentStartDate,
        end: employees.employmentEndDate,
        managerId: employees.managerId,
        managerActive: sql<boolean>`${manager.deactivatedAt} is null`,
        managerHasAccount: sql<boolean>`${manager.userId} is not null`,
      })
      .from(employees)
      .leftJoin(manager, eq(manager.id, employees.managerId))
      .where(and(isNull(employees.deactivatedAt), eq(employees.timesheetRequired, true), ids ? inArray(employees.id, ids) : undefined))
      .orderBy(employees.fullName);
  }

  private right(access: CallerAccess, e: ApprovalTarget): ApprovalRight {
    return approvalRight({ employeeId: access.employeeId, isAdmin: access.isAdmin }, e);
  }

  /** The week's days `userId` submitted or resubmitted for `employeeId` (CD-317): their own account's submissions don't count. */
  private async enteredBy(tx: Tx, employeeId: string, monday: string, userId: string): Promise<string[]> {
    const rows = await tx
      .select({ date: timesheetDayEvents.workDate })
      .from(timesheetDayEvents)
      .innerJoin(employees, eq(employees.id, timesheetDayEvents.employeeId))
      .where(
        and(
          eq(timesheetDayEvents.employeeId, employeeId),
          between(timesheetDayEvents.workDate, monday, addDays(monday, 6)),
          inArray(timesheetDayEvents.kind, ['submitted', 'resubmitted']),
          eq(timesheetDayEvents.actorUserId, userId),
          or(isNull(employees.userId), ne(employees.userId, userId)),
        ),
      );
    return [...new Set(rows.map((r) => r.date))].sort();
  }

  /** The list for one week (the latest whose deadline passed, by default): one row per employee, from three queries. */
  list(ctx: TenantContext, week?: string): Promise<ApprovalsView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.people.of(ctx, tx);
      const { settings, timeZone, now, today } = await this.context(tx, ctx.tenantId);
      const thisWeek = mondayOf(today);
      const holidays = await holidaysBetween(tx, addDays(thisWeek, -14), addDays(thisWeek, 45));
      const dueOf = (monday: string) => deadlineOf(monday, settings, (d) => holidays.has(d));
      const passed = (monday: string) => deadlineInstant(zonedDayStart(dueOf(monday).date, timeZone), dueOf(monday).time) <= now;
      const monday = week ?? (passed(thisWeek) ? thisWeek : addDays(thisWeek, -7));
      const sunday = addDays(monday, 6);
      const weekHolidays = week ? await holidaysBetween(tx, monday, sunday) : holidays;

      const people = await this.visible(tx, access);
      const ids = people.map((p) => p.id);
      const [sums, dayRows, flags] = ids.length
        ? await Promise.all([
            tx
              .select({ employeeId: timeEntries.employeeId, date: timeEntries.workDate, minutes: sql<number>`sum(${timeEntries.minutes})::int` })
              .from(timeEntries)
              .where(and(inArray(timeEntries.employeeId, ids), between(timeEntries.workDate, monday, sunday)))
              .groupBy(timeEntries.employeeId, timeEntries.workDate),
            tx
              .select({ employeeId: timesheetDays.employeeId, date: timesheetDays.workDate, status: timesheetDays.status, resubmittedAt: timesheetDays.resubmittedAt })
              .from(timesheetDays)
              .where(and(inArray(timesheetDays.employeeId, ids), between(timesheetDays.workDate, monday, sunday))),
            tx
              .select({ employeeId: timesheetWeeks.employeeId, lateAt: timesheetWeeks.lateAt, autoSubmittedAt: timesheetWeeks.autoSubmittedAt })
              .from(timesheetWeeks)
              .where(and(inArray(timesheetWeeks.employeeId, ids), eq(timesheetWeeks.weekStart, monday))),
          ])
        : [[], [], []];
      const minutesOf = new Map(sums.map((s) => [`${s.employeeId}:${s.date}`, s.minutes]));
      const statusOf = new Map(dayRows.map((d) => [`${d.employeeId}:${d.date}`, d.status]));
      const resubmittedOf = new Set(dayRows.filter((d) => d.status === 'submitted' && d.resubmittedAt).map((d) => `${d.employeeId}:${d.date}`));
      const flagsOf = new Map(flags.map((f) => [f.employeeId, f]));
      // Weeks with a day submitted by someone other than the employee's own account (CD-317).
      const onBehalfIds = new Set(
        ids.length
          ? (
              await tx
                .select({ employeeId: timesheetDayEvents.employeeId })
                .from(timesheetDayEvents)
                .innerJoin(employees, eq(employees.id, timesheetDayEvents.employeeId))
                .where(
                  and(
                    inArray(timesheetDayEvents.employeeId, ids),
                    between(timesheetDayEvents.workDate, monday, sunday),
                    inArray(timesheetDayEvents.kind, ['submitted', 'resubmitted']),
                    isNotNull(timesheetDayEvents.actorUserId),
                    or(isNull(employees.userId), ne(employees.userId, timesheetDayEvents.actorUserId)),
                  ),
                )
            ).map((r) => r.employeeId)
          : [],
      );

      const rows: ApprovalRow[] = people.map((p) => {
        const employment = { start: p.start, end: p.end };
        const days: (WeekDay & { expected: number })[] = weekDates(monday).map((date) => {
          const minutes = minutesOf.get(`${p.id}:${date}`) ?? 0;
          const expected = expectedMinutes(date, settings, employment, weekHolidays.get(date));
          return { date, status: statusOf.get(`${p.id}:${date}`) ?? 'draft', required: isRequired(expected, minutes), minutes, expected };
        });
        const { status, label } = weekStatus(days);
        const flag = flagsOf.get(p.id);
        return {
          employee: { id: p.id, name: p.name, jobTitle: p.jobTitle },
          right: this.right(access, { employeeId: p.id, managerId: p.managerId, managerActive: p.managerActive, managerHasAccount: p.managerHasAccount }),
          status,
          statusLabel: label,
          late: !!flag?.lateAt,
          autoSubmitted: !!flag?.autoSubmittedAt,
          onBehalf: onBehalfIds.has(p.id),
          days: days.map((d) => ({ date: d.date, status: d.status, required: d.required, minutes: d.minutes })),
          enteredMinutes: days.reduce((a, d) => a + d.minutes, 0),
          expectedMinutes: days.reduce((a, d) => a + d.expected, 0),
          missing: submittableDays(days, today),
          waiting: days.filter((d) => d.status === 'submitted').length,
          resubmitted: days.filter((d) => resubmittedOf.has(`${p.id}:${d.date}`)).length,
          returned: days.filter((d) => d.status === 'rejected').length,
          approvable: 'dates' in approvableDays(days, settings.approvalMode),
        };
      });
      const due = dueOf(monday);
      return { weekStart: monday, weekNumber: isoWeek(monday), label: weekLabel(monday), thisWeek, deadline: due, deadlinePassed: passed(monday), approvalMode: settings.approvalMode, timeFormat: settings.timeFormat, rows };
    });
  }

  /** One person's week as their approver sees it (design `#cd-157b`); 403 for anyone outside the caller's reports. */
  personWeek(ctx: TenantContext, employeeId: string, week?: string): Promise<ApproverWeek> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.people.of(ctx, tx);
      const [p] = await this.target(tx, access, employeeId);
      const { settings, timeZone, now, today } = await this.context(tx, ctx.tenantId);
      const view = await readWeek(tx, await callerFor(tx, employeeId, today, settings, timeZone, now), week ?? mondayOf(today));
      return { week: view, right: this.right(access, p), enteredByMe: await this.enteredBy(tx, employeeId, view.weekStart, ctx.userId) };
    });
  }

  /** The employee, when the caller may see their week; 404 when there is no such employee, 403 outside the caller's reports. */
  private async target(tx: Tx, access: CallerAccess, employeeId: string) {
    const [p] = await tx
      .select({
        employeeId: employees.id,
        name: employees.fullName,
        userId: employees.userId,
        managerId: employees.managerId,
        managerActive: sql<boolean>`${manager.deactivatedAt} is null`,
        managerHasAccount: sql<boolean>`${manager.userId} is not null`,
      })
      .from(employees)
      .leftJoin(manager, eq(manager.id, employees.managerId))
      .where(eq(employees.id, employeeId));
    if (!p) throw new NotFoundException('Employee not found');
    if (!access.isAdmin && !access.reportIds.has(employeeId) && !access.isSelf(employeeId)) throw new ForbiddenException("You cannot see this employee's timesheet");
    return [p] as const;
  }

  /** Approve (spec 5.3 T3): the week, or chosen days in Day by day mode. The lock trigger keeps them from changing. */
  approve(ctx: TenantContext, employeeId: string, weekStart: string, dates?: string[]): Promise<ApproverWeek> {
    return this.decide(ctx, employeeId, weekStart, 'approve', (days, settings) => approvableDays(days, settings.approvalMode, dates));
  }

  /** Return (spec 5.3 T4; the design's Reject): the chosen Submitted days, or all of them, with a required comment. The employee is emailed. */
  return(ctx: TenantContext, employeeId: string, weekStart: string, comment: string, dates?: string[]): Promise<ApproverWeek> {
    return this.decide(ctx, employeeId, weekStart, 'return', (days) => returnableDays(days, dates), comment);
  }

  /**
   * Admin unlock (spec 9.2, CD-159): approved days go back to the employee as Rejected with the
   * reason as the comment (T6); the Late flag stays. Admins only, never their own days. The
   * employee and whoever approved the days are emailed; the audit log has `timesheet.day_unlocked`.
   */
  unlock(ctx: TenantContext, employeeId: string, weekStart: string, reason: string, dates?: string[]): Promise<ApproverWeek> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.people.of(ctx, tx);
        if (!access.isAdmin) throw new ForbiddenException('Only Admins can unlock approved days');
        const [p] = await this.target(tx, access, employeeId);
        if (access.isSelf(employeeId)) throw new ForbiddenException('You cannot unlock your own days');
        const { settings, timeZone, now, today } = await this.context(tx, ctx.tenantId);
        const caller = await callerFor(tx, employeeId, today, settings, timeZone, now);
        const before = await readWeek(tx, caller, weekStart);
        const pick = unlockableDays(
          before.days.map((d) => ({ date: d.date, status: d.status, required: d.required, minutes: d.minutes })),
          dates,
        );
        if ('error' in pick) throw new BadRequestException(pick.error);
        const approvers = await tx
          .select({ userId: timesheetDays.approvedByUserId })
          .from(timesheetDays)
          .where(and(eq(timesheetDays.employeeId, employeeId), inArray(timesheetDays.workDate, pick.dates), isNotNull(timesheetDays.approvedByUserId)));
        const changed = await tx
          .update(timesheetDays)
          .set({ status: 'rejected', returnedAt: now, returnedByUserId: ctx.userId, comment: reason, resubmittedAt: null, reply: null, approvedAt: null, approvedByUserId: null, approvedExpectedMinutes: null, approvedMinutes: null })
          .where(and(eq(timesheetDays.employeeId, employeeId), inArray(timesheetDays.workDate, pick.dates), eq(timesheetDays.status, 'approved')))
          .returning({ date: timesheetDays.workDate });
        if (changed.length !== pick.dates.length) throw new ConflictException('This week changed, please review it again');
        const days = pick.dates.slice().sort();
        const actor = { userId: ctx.userId, name: await actorNameOf(tx, ctx.userId) };
        await recordDayEvents(tx, { tenantId: ctx.tenantId, employeeId, dates: days, kind: 'unlocked', actor, comment: reason, approvalMode: settings.approvalMode });
        await this.audit.record(tx, ctx, { action: 'timesheet.day_unlocked', entityType: 'employee', entityId: employeeId, data: { weekStart, days, reason } });
        const recipients = new Set<string>([...approvers.map((a) => a.userId!), ...(p.userId ? [p.userId] : [])]);
        recipients.delete(ctx.userId);
        for (const recipientUserId of recipients) {
          await this.jobs.send(
            'timesheet.notice-email',
            {
              tenantId: ctx.tenantId,
              kind: 'unlocked',
              weekStart,
              recipientUserId,
              week: { weekStart, weekNumber: before.weekNumber, deadline: before.deadline, enteredMinutes: before.days.reduce((a, d) => a + d.minutes, 0), expectedMinutes: before.days.reduce((a, d) => a + d.expectedMinutes, 0), missing: [] },
              unlocked: { days, reason, adminName: actor.name, employeeId, employeeName: p.name, toEmployee: recipientUserId === p.userId },
            },
            tx,
          );
        }
        return { week: await readWeek(tx, caller, weekStart), right: this.right(access, p), enteredByMe: await this.enteredBy(tx, employeeId, weekStart, ctx.userId) };
      })
      .catch(mapDbError);
  }

  /**
   * The week's history (spec 9.5, CD-159), oldest first: every status change of its days
   * (`timesheet_day_events`) and every change to its entries (`record_changes`, written by the
   * `timesheet_entry_history` trigger with whole-row snapshots). For the employee, their approvers
   * and Admins; task and work order names are today's, a deleted one reads "Deleted".
   */
  history(ctx: TenantContext, employeeId: string, week?: string): Promise<WeekHistory> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.people.of(ctx, tx);
      const [p] = await this.target(tx, access, employeeId);
      const onBehalf = (actorUserId: string | null) => !!actorUserId && actorUserId !== p.userId;
      const { today } = await this.context(tx, ctx.tenantId);
      const monday = week ?? mondayOf(today);
      const sunday = addDays(monday, 6);
      const events = await tx
        .select({ date: timesheetDayEvents.workDate, kind: timesheetDayEvents.kind, actorName: timesheetDayEvents.actorName, actorUserId: timesheetDayEvents.actorUserId, comment: timesheetDayEvents.comment, approvalMode: timesheetDayEvents.approvalMode, at: timesheetDayEvents.createdAt })
        .from(timesheetDayEvents)
        .where(and(eq(timesheetDayEvents.employeeId, employeeId), between(timesheetDayEvents.workDate, monday, sunday)))
        .orderBy(timesheetDayEvents.createdAt, timesheetDayEvents.workDate);
      const { rows } = await tx.execute<{ id: string; action: string; field: string | null; old_value: EntrySnapshot | null; new_value: EntrySnapshot | null; changed_at: string | Date; actor_name: string | null; actor_user_id: string | null }>(sql`
        select c.id, c.action, c.field, c.old_value, c.new_value, c.changed_at, c.actor_user_id, u.display_name as actor_name
        from record_changes c left join users u on u.id = c.actor_user_id
        where c.entity_type = 'time_entry' and coalesce(c.new_value, c.old_value) ->> 'employeeId' = ${employeeId}
          and (c.new_value ->> 'date' between ${monday} and ${sunday} or c.old_value ->> 'date' between ${monday} and ${sunday})
        order by c.changed_at, c.id`);
      const snaps = rows.map((r) => (r.new_value ?? r.old_value)!);
      const taskIds = [...new Set(snaps.flatMap((s) => (s.taskId ? [s.taskId] : [])))];
      const orderIds = [...new Set(snaps.flatMap((s) => (s.workOrderId ? [s.workOrderId] : [])))];
      const [taskRows, orderRows] = await Promise.all([
        taskIds.length ? tx.select({ id: tasks.id, number: tasks.number, name: tasks.name }).from(tasks).where(inArray(tasks.id, taskIds)) : [],
        orderIds.length ? tx.select({ id: workOrders.id, number: workOrders.number, title: workOrders.title }).from(workOrders).where(inArray(workOrders.id, orderIds)) : [],
      ]);
      const rowOf = (s: EntrySnapshot) => {
        if (s.taskId) {
          const t = taskRows.find((x) => x.id === s.taskId);
          return t ? `T-${t.number} ${t.name}` : 'Deleted task';
        }
        const o = orderRows.find((x) => x.id === s.workOrderId);
        return o ? `WO-${o.number} ${o.title}` : 'Deleted work order';
      };
      return {
        events: events.map(({ actorUserId, ...e }) => ({ ...e, onBehalf: onBehalf(actorUserId), at: e.at.toISOString() })),
        changes: rows.map((r) => {
          const snap = (r.new_value ?? r.old_value)!;
          return {
            at: new Date(r.changed_at).toISOString(),
            actorName: r.actor_name,
            onBehalf: onBehalf(r.actor_user_id),
            date: snap.date,
            action: r.action as 'created' | 'updated' | 'deleted',
            field: r.field,
            from: r.field && r.old_value ? (r.old_value[r.field as keyof EntrySnapshot] ?? null) : null,
            to: r.field && r.new_value ? (r.new_value[r.field as keyof EntrySnapshot] ?? null) : null,
            row: rowOf(snap),
            minutes: snap.minutes,
            note: snap.note,
          };
        }),
      };
    });
  }

  private decide(ctx: TenantContext, employeeId: string, weekStart: string, action: 'approve' | 'return', choose: (days: WeekDay[], settings: TimesheetSettings) => DayPick, comment?: string): Promise<ApproverWeek> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.people.of(ctx, tx);
        const [p] = await this.target(tx, access, employeeId);
        const right = this.right(access, p);
        if (!right) throw new ForbiddenException(action === 'approve' ? "You cannot approve this employee's timesheet" : "You cannot return this employee's timesheet");
        const { settings, timeZone, now, today } = await this.context(tx, ctx.tenantId);
        const caller = await callerFor(tx, employeeId, today, settings, timeZone, now);
        const before = await readWeek(tx, caller, weekStart);
        const pick = choose(
          before.days.map((d) => ({ date: d.date, status: d.status, required: d.required, minutes: d.minutes })),
          settings,
        );
        if ('error' in pick) throw pick.conflict ? new ConflictException(pick.error) : new BadRequestException(pick.error);
        // Days the caller submitted on the employee's behalf need another approver (CD-317, spec 9.4).
        if (action === 'approve') {
          const mine = await this.enteredBy(tx, employeeId, weekStart, ctx.userId);
          const clash = pick.dates.filter((d) => mine.includes(d));
          if (clash.length) throw new ForbiddenException(`You entered ${clash.length === 1 ? 'this day' : 'these days'} on behalf of ${p.name}; another approver must approve ${clash.length === 1 ? 'it' : 'them'}`);
        }
        const actor = { userId: ctx.userId, name: await actorNameOf(tx, ctx.userId) };
        // Only days still Submitted change: fewer rows than picked means the week changed meanwhile (spec 8.2, 8.4).
        const changed = await tx
          .update(timesheetDays)
          .set(action === 'approve' ? { approvedAt: now, approvedByUserId: ctx.userId, status: 'approved' } : { returnedAt: now, returnedByUserId: ctx.userId, status: 'rejected', comment: comment ?? null, resubmittedAt: null, reply: null })
          .where(and(eq(timesheetDays.employeeId, employeeId), inArray(timesheetDays.workDate, pick.dates), eq(timesheetDays.status, 'submitted')))
          .returning({ date: timesheetDays.workDate });
        if (changed.length !== pick.dates.length) throw new ConflictException('This week changed, please review it again');
        // The day as it was approved (spec 9.1): the snapshot payroll and the unlock dialog show.
        if (action === 'approve')
          for (const d of before.days.filter((x) => pick.dates.includes(x.date)))
            await tx.update(timesheetDays).set({ approvedExpectedMinutes: d.expectedMinutes, approvedMinutes: d.minutes }).where(and(eq(timesheetDays.employeeId, employeeId), eq(timesheetDays.workDate, d.date)));
        const dates = pick.dates.slice().sort();
        await recordDayEvents(tx, { tenantId: ctx.tenantId, employeeId, dates, kind: action === 'approve' ? 'approved' : 'returned', actor, comment, approvalMode: settings.approvalMode });
        await this.audit.record(tx, ctx, { action: action === 'approve' ? 'timesheet.approved' : 'timesheet.returned', entityType: 'employee', entityId: employeeId, data: { weekStart, days: dates, override: right === 'override', ...(comment ? { comment } : {}) } });
        if (action === 'return' && p.userId) {
          await this.jobs.send(
            'timesheet.notice-email',
            {
              tenantId: ctx.tenantId,
              kind: 'returned',
              weekStart,
              recipientUserId: p.userId,
              week: { weekStart, weekNumber: before.weekNumber, deadline: before.deadline, enteredMinutes: before.days.reduce((a, d) => a + d.minutes, 0), expectedMinutes: before.days.reduce((a, d) => a + d.expectedMinutes, 0), missing: [] },
              returned: { days: dates, comment: comment ?? '', approverName: actor.name },
            },
            tx,
          );
        }
        return { week: await readWeek(tx, caller, weekStart), right, enteredByMe: await this.enteredBy(tx, employeeId, weekStart, ctx.userId) };
      })
      .catch(mapDbError);
  }
}
