import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { employees, orgUnits, tenants, timeEntries } from '../../shared/database/schema';
import { zonedParts } from '../../shared/time/zoned-time';
import { PeopleAccess, shownEmployee } from '../people';
import { ApprovalsService } from './approvals.service';
import { type DayStatus, dayStatus, nextWorkingDayAfter, statusAbsenceRegistry } from './team-status';
import { addDays, mondayOf } from './timesheet-rules';
import { holidaysBetween, timesheetSettings } from './timesheet-settings';

/** How far the date picker reaches (spec 12.1): 90 days back, 60 ahead of the workspace's today. */
export const STATUS_DAYS_BACK = 90;
export const STATUS_DAYS_AHEAD = 60;

/** One employee's row on Today's status (design `Timesheet.dc.html#cd-162`). */
export interface TeamStatusRow {
  id: string;
  name: string;
  jobTitle: string | null;
  /** The top unit of their org line (the Department level by default) and the one below it (Team). */
  department: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  status: DayStatus;
  label: string;
  detail: string | null;
  /** A request waiting for a decision ("Vacation requested"). */
  note: string | null;
  /** A direct or indirect report of the caller (the Team today card). */
  report: boolean;
  /** Last week's timesheet (spec 12.3): only for the employee's managers and Admins, and only with a required timesheet. */
  timesheet: { weekStart: string; label: string; late: boolean; notSubmitted: boolean } | null;
}

export interface TeamStatusView {
  date: string;
  today: string;
  minDate: string;
  maxDate: string;
  scope: 'all' | 'reports';
  updatedAt: string;
  rows: TeamStatusRow[];
}

/**
 * Today's status (CD-162, spec 15 section 12). Managers (anyone with reports) and Admins only.
 * Managers see their direct and indirect reports, Admins every employee (decided 17 Oct 2026),
 * both with the exact absence types. Managers don't see deactivated people (only Admins do).
 */
@Injectable()
export class TeamStatusService {
  constructor(
    private readonly database: DatabaseService,
    private readonly people: PeopleAccess,
    private readonly approvals: ApprovalsService,
  ) {}

  async list(ctx: TenantContext, date: string | undefined, scope: 'all' | 'reports'): Promise<TeamStatusView> {
    const now = new Date();
    const result = await this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.people.of(ctx, tx);
      if (!access.isAdmin && !access.isManager) throw new ForbiddenException("Today's status is for managers and Admins");
      const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      const today = zonedParts(now, tenant?.timezone ?? 'UTC').date;
      const minDate = addDays(today, -STATUS_DAYS_BACK);
      const maxDate = addDays(today, STATUS_DAYS_AHEAD);
      const day = date ?? today;
      if (day < minDate || day > maxDate) throw new BadRequestException(`Pick a date between ${minDate} and ${maxDate}`);

      const settings = await timesheetSettings(tx, ctx.tenantId);
      const holidays = await holidaysBetween(tx, day, addDays(day, 430));
      const fullHoliday = (d: string) => {
        const h = holidays.get(d);
        return !!h && (h.minutes === null || h.minutes >= settings.dayMinutes);
      };

      const all = await tx
        .select({
          id: employees.id,
          name: employees.fullName,
          jobTitle: employees.jobTitle,
          unitId: employees.unitId,
          managerId: employees.managerId,
          start: employees.employmentStartDate,
          end: employees.employmentEndDate,
          deactivatedAt: employees.deactivatedAt,
          timesheetRequired: employees.timesheetRequired,
        })
        .from(employees)
        // Only the people the app shows (CD-226, CD-336), as on the Org structure.
        .where(shownEmployee)
        .orderBy(employees.fullName);
      const tz = tenant?.timezone ?? 'UTC';
      // A deactivated person's last day is their end date, or the day they were deactivated.
      const endOf = (e: (typeof all)[number]) => e.end ?? (e.deactivatedAt ? zonedParts(e.deactivatedAt, tz).date : null);
      const visible = all.filter((e) => !e.deactivatedAt || access.canSeeInactive);
      // Managers: their direct and indirect reports. Admins: everyone (`scope=reports`: their own reports too).
      const people = visible.filter((e) => (access.isAdmin && scope === 'all') || access.isReport(e.id));
      // A report's manager is the caller or another visible person.
      const names = new Map(visible.map((e) => [e.id, e.name]));
      const ids = people.map((e) => e.id);

      const units = await tx.select({ id: orgUnits.id, name: orgUnits.name, parentId: orgUnits.parentId }).from(orgUnits);
      const unitById = new Map(units.map((u) => [u.id, u]));
      /** The unit's line from the top: [department, team, …]. */
      const lineOf = (unitId: string | null) => {
        const line: { id: string; name: string }[] = [];
        for (let u = unitId ? unitById.get(unitId) : undefined; u && line.length < 20; u = u.parentId ? unitById.get(u.parentId) : undefined) line.unshift({ id: u.id, name: u.name });
        return line;
      };

      const [entered, covering, requested] = await Promise.all([
        ids.length
          ? tx
              .select({ employeeId: timeEntries.employeeId, minutes: sql<number>`sum(${timeEntries.minutes})::int` })
              .from(timeEntries)
              .where(and(inArray(timeEntries.employeeId, ids), eq(timeEntries.workDate, day)))
              .groupBy(timeEntries.employeeId)
          : Promise.resolve([]),
        statusAbsenceRegistry.coveringOn(tx, ids, day),
        statusAbsenceRegistry.requestedOn(tx, ids, day),
      ]);
      const minutesOf = new Map(entered.map((r) => [r.employeeId, r.minutes]));

      const rows: (TeamStatusRow & { timesheetRequired: boolean })[] = [];
      for (const e of people) {
        const result = dayStatus({
          date: day,
          employment: { start: e.start, end: endOf(e) },
          holiday: holidays.get(day),
          dayMinutes: settings.dayMinutes,
          workingDays: settings.workingDays,
          absences: covering.get(e.id) ?? [],
          enteredMinutes: minutesOf.get(e.id) ?? 0,
          nextWorkingDay: (d) => nextWorkingDayAfter(d, settings.workingDays, fullHoliday),
        });
        const line = lineOf(e.unitId);
        rows.push({
          id: e.id,
          name: e.name,
          jobTitle: e.jobTitle,
          department: line[0] ?? null,
          team: line[1] ?? null,
          manager: e.managerId && names.has(e.managerId) ? { id: e.managerId, name: names.get(e.managerId)! } : null,
          ...result,
          note: result.status !== 'time_off' && result.status !== 'sick_leave' ? (requested.get(e.id) ?? null) : null,
          report: access.isReport(e.id),
          timesheet: null,
          timesheetRequired: e.timesheetRequired,
        });
      }
      return { access, today, minDate, maxDate, day, rows };
    });

    // Last week's timesheet (spec 12.3), as the Approvals list has it: managers' reports, every employee for Admins.
    const { access, rows } = result;
    const lastWeek = addDays(mondayOf(result.day), -7);
    if (rows.some((r) => r.timesheetRequired && (access.isAdmin || access.isReport(r.id))) && lastWeek <= mondayOf(result.today)) {
      const weeks = await this.approvals.list(ctx, lastWeek);
      const byId = new Map(weeks.rows.map((w) => [w.employee.id, w]));
      for (const r of rows) {
        const w = access.isAdmin || access.isReport(r.id) ? byId.get(r.id) : undefined;
        if (w) r.timesheet = { weekStart: weeks.weekStart, label: w.statusLabel, late: w.late, notSubmitted: weeks.deadlinePassed && w.missing.length > 0 };
      }
    }
    return {
      date: result.day,
      today: result.today,
      minDate: result.minDate,
      maxDate: result.maxDate,
      scope,
      updatedAt: now.toISOString(),
      rows: rows.map(({ timesheetRequired: _, ...r }) => r),
    };
  }
}
