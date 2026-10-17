import { Injectable, type OnModuleInit } from '@nestjs/common';
import { and, between, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { sickLeaves, timeoffReasons, timeoffRequestDays, timeoffRequests } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { type AbsenceLine, holidaysBetween, type PendingAbsenceSource, pendingAbsenceRegistry, TimesheetAbsencesService, timesheetSettings } from '../timesheet';
import { addDays } from './request-rules';
import { countedEnd } from './sick-leave-rules';
import { workspaceToday } from './today';

const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const TYPE_LABEL = { vacation: 'Vacation', paid_leave: 'Paid leave', unpaid_leave: 'Unpaid leave', other_absence: 'Other absence' } as const;
/** "Vacation", "Paid leave: Marriage", "Other absence: Maternity leave". */
const labelOf = (type: keyof typeof TYPE_LABEL, reason: string | null) => (reason && (type === 'paid_leave' || type === 'other_absence') ? `${TYPE_LABEL[type]}: ${reason}` : TYPE_LABEL[type]);

/**
 * Time off in the timesheet (CD-170, spec 14.1). Every change that affects absences queues
 * `timeoff.sync-timesheet` in its own transaction (`queue`); the worker then works out the lines a
 * person should have between two dates (`linesFor`) and hands them to the timesheet module, which
 * makes the timesheet match, so running it twice changes nothing. Approved requests' counted days
 * and active sick leave's working days (up to today while open) become lines with the standard
 * day's hours, less a part-day holiday. Also the timesheet's source of "Vacation pending" hints.
 */
@Injectable()
export class TimesheetSyncService implements PendingAbsenceSource, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly absences: TimesheetAbsencesService,
  ) {}

  onModuleInit(): void {
    pendingAbsenceRegistry.use(this);
  }

  /** Queues the sync of one person's dates, in the caller's transaction. */
  queue(tx: Tx, tenantId: string, employeeId: string, from: string, to: string): Promise<void> {
    return this.jobs.send('timeoff.sync-timesheet', { tenantId, employeeId, from: from < to ? from : to, to: from < to ? to : from }, tx);
  }

  /**
   * The job: one person, or (without `employeeId`, after a holiday change) everyone with approved
   * time off or sick leave in the period. Returns the dates that changed.
   */
  async run(data: { tenantId: string; employeeId?: string; from: string; to: string }): Promise<number> {
    const people = data.employeeId ? [data.employeeId] : await this.database.withTenant(data.tenantId, (tx) => this.affected(tx, data.from, data.to));
    let changed = 0;
    for (const employeeId of people) {
      changed += (await this.absences.sync(data.tenantId, employeeId, data.from, data.to, (tx) => this.linesFor(tx, data.tenantId, employeeId, data.from, data.to))).length;
    }
    return changed;
  }

  /** The lines one person should have between two dates (spec 14.1). Sick leave wins a day both claim. */
  async linesFor(tx: Tx, tenantId: string, employeeId: string, from: string, to: string): Promise<AbsenceLine[]> {
    const settings = await timesheetSettings(tx, tenantId);
    const holidays = await holidaysBetween(tx, from, to);
    const minutesOn = (date: string) => {
      const h = holidays.get(date);
      return settings.dayMinutes - (h ? Math.min(settings.dayMinutes, h.minutes ?? settings.dayMinutes) : 0);
    };
    const lines = new Map<string, AbsenceLine>();
    const days = await tx
      .select({ date: timeoffRequestDays.date, requestId: timeoffRequests.id, type: timeoffRequests.type, reason: sql<string | null>`(select x.name from ${timeoffReasons} x where x.id = ${timeoffRequests}.reason_id)` })
      .from(timeoffRequestDays)
      .innerJoin(timeoffRequests, eq(timeoffRequests.id, timeoffRequestDays.requestId))
      .where(and(eq(timeoffRequestDays.employeeId, employeeId), eq(timeoffRequestDays.state, 'counted'), eq(timeoffRequests.status, 'approved'), between(timeoffRequestDays.date, from, to)));
    for (const d of days) {
      const minutes = minutesOn(d.date);
      if (minutes > 0) lines.set(d.date, { date: d.date, kind: d.type, label: labelOf(d.type, d.reason), minutes, sourceId: d.requestId });
    }
    const today = await workspaceToday(tx, tenantId);
    const sick = await tx
      .select({ id: sickLeaves.id, startDate: sickLeaves.startDate, endDate: sickLeaves.endDate })
      .from(sickLeaves)
      .where(and(eq(sickLeaves.employeeId, employeeId), inArray(sickLeaves.status, ['reported', 'confirmed']), lte(sickLeaves.startDate, to), or(isNull(sickLeaves.endDate), gte(sickLeaves.endDate, from))));
    for (const s of sick) {
      const last = countedEnd(s, today);
      for (let d = s.startDate < from ? from : s.startDate; d <= last && d <= to; d = addDays(d, 1)) {
        const minutes = minutesOn(d);
        // The type never goes to the timesheet (spec 14.1).
        if (settings.workingDays.includes(isoWeekday(d)) && minutes > 0) lines.set(d, { date: d, kind: 'sick_leave', label: 'Sick leave', minutes, sourceId: s.id });
      }
    }
    return [...lines.values()];
  }

  /** "Vacation pending" on the days of requests waiting for a decision (spec 14.1): a hint, no hours. */
  async pendingIn(tx: Tx, employeeId: string, from: string, to: string): Promise<Map<string, string>> {
    const rows = await tx
      .select({ date: timeoffRequestDays.date, type: timeoffRequests.type, reason: sql<string | null>`(select x.name from ${timeoffReasons} x where x.id = ${timeoffRequests}.reason_id)` })
      .from(timeoffRequestDays)
      .innerJoin(timeoffRequests, eq(timeoffRequests.id, timeoffRequestDays.requestId))
      .where(and(eq(timeoffRequestDays.employeeId, employeeId), eq(timeoffRequestDays.state, 'counted'), eq(timeoffRequests.status, 'pending'), between(timeoffRequestDays.date, from, to)));
    return new Map(rows.map((r) => [r.date, `${labelOf(r.type, r.reason)} pending`]));
  }

  private async affected(tx: Tx, from: string, to: string): Promise<string[]> {
    const rows = await tx.execute<{ employee_id: string }>(sql`
      select distinct d.employee_id from ${timeoffRequestDays} d join ${timeoffRequests} r on r.id = d.request_id
        where r.status = 'approved' and d.date between ${from} and ${to}
      union
      select distinct s.employee_id from ${sickLeaves} s
        where s.status in ('reported', 'confirmed') and s.start_date <= ${to} and (s.end_date is null or s.end_date >= ${from})`);
    return rows.rows.map((r) => r.employee_id);
  }
}
