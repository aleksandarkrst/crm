import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, between, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employees, tenants, timeEntries, timesheetDays, type TimesheetDayStatus, timesheetWeeks } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { zonedDayStart, zonedParts } from '../../shared/time/zoned-time';
import { type CallerAccess, PeopleAccess } from '../people';
import { approvableDays, type ApprovalRight, approvalRight, type ApprovalTarget, type DayPick } from './approval-rules';
import { callerFor } from './deadlines';
import { addDays, deadlineInstant, deadlineOf, expectedMinutes, isoWeek, isRequired, mondayOf, submittableDays, type TimesheetSettings, type WeekDay, weekDates, weekLabel, weekStatus, type WeekStatus } from './timesheet-rules';
import { actorNameOf, readWeek, recordDayEvents, type WeekView } from './timesheet.service';
import { holidaysBetween, timesheetSettings } from './timesheet-settings';
import { returnableDays } from './approval-rules';

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
  /** Submitted days waiting for the approver, and days returned to the employee. */
  waiting: number;
  returned: number;
  /** Approve week is possible now (Whole week mode: no required Draft or Rejected day left). */
  approvable: boolean;
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
   * shortcut: people without an app account are left out until CD-317 lets Admins enter for them, add them with it.
   */
  private async visible(tx: Tx, access: CallerAccess, employeeId?: string) {
    const ids = employeeId ? [employeeId] : access.isAdmin ? null : [...access.reportIds];
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
      .where(and(isNull(employees.deactivatedAt), eq(employees.timesheetRequired, true), isNotNull(employees.userId), ids ? inArray(employees.id, ids) : undefined))
      .orderBy(employees.fullName);
  }

  private right(access: CallerAccess, e: ApprovalTarget): ApprovalRight {
    return approvalRight({ employeeId: access.employeeId, isAdmin: access.isAdmin }, e);
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
              .select({ employeeId: timesheetDays.employeeId, date: timesheetDays.workDate, status: timesheetDays.status })
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
      const flagsOf = new Map(flags.map((f) => [f.employeeId, f]));

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
          days: days.map((d) => ({ date: d.date, status: d.status, required: d.required, minutes: d.minutes })),
          enteredMinutes: days.reduce((a, d) => a + d.minutes, 0),
          expectedMinutes: days.reduce((a, d) => a + d.expected, 0),
          missing: submittableDays(days, today),
          waiting: days.filter((d) => d.status === 'submitted').length,
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
      return { week: view, right: this.right(access, p) };
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
        const actor = { userId: ctx.userId, name: await actorNameOf(tx, ctx.userId) };
        // Only days still Submitted change: fewer rows than picked means the week changed meanwhile (spec 8.2, 8.4).
        const changed = await tx
          .update(timesheetDays)
          .set(action === 'approve' ? { approvedAt: now, approvedByUserId: ctx.userId, status: 'approved' } : { returnedAt: now, returnedByUserId: ctx.userId, status: 'rejected', comment: comment ?? null })
          .where(and(eq(timesheetDays.employeeId, employeeId), inArray(timesheetDays.workDate, pick.dates), eq(timesheetDays.status, 'submitted')))
          .returning({ date: timesheetDays.workDate });
        if (changed.length !== pick.dates.length) throw new ConflictException('This week changed, please review it again');
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
        return { week: await readWeek(tx, caller, weekStart), right };
      })
      .catch(mapDbError);
  }
}
