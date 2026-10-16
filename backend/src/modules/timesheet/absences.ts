import { ConflictException, Injectable } from '@nestjs/common';
import { and, between, eq, inArray, sql } from 'drizzle-orm';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { type TimesheetAbsenceKind, timesheetAbsences, timesheetDays } from '../../shared/database/schema';
import { timesheetSettings } from './timesheet-settings';
import { lockDay, recordDayEvents } from './timesheet.service';

/**
 * Absences in the timesheet (CD-170, spec 14): full-day lines the time off module keeps in step
 * with approved time off and sick leave. This module owns the table and the effects on days; the
 * time off module decides which lines a person should have and calls `sync`, from its
 * `timeoff.sync-timesheet` job, so nothing here reads time off tables.
 */

export interface AbsenceLine {
  date: string;
  kind: TimesheetAbsenceKind;
  label: string;
  minutes: number;
  sourceId: string;
}

/** Days with an absence of these people between two dates, by person and date. */
export async function absencesIn(tx: Tx, employeeIds: string[], from: string, to: string): Promise<Map<string, Map<string, AbsenceLine>>> {
  const out = new Map<string, Map<string, AbsenceLine>>();
  if (!employeeIds.length) return out;
  const rows = await tx
    .select({ employeeId: timesheetAbsences.employeeId, date: timesheetAbsences.workDate, kind: timesheetAbsences.kind, label: timesheetAbsences.label, minutes: timesheetAbsences.minutes, sourceId: timesheetAbsences.sourceId })
    .from(timesheetAbsences)
    .where(and(inArray(timesheetAbsences.employeeId, employeeIds), between(timesheetAbsences.workDate, from, to)));
  for (const r of rows) {
    const days = out.get(r.employeeId) ?? new Map<string, AbsenceLine>();
    days.set(r.date, { date: r.date, kind: r.kind, label: r.label, minutes: r.minutes, sourceId: r.sourceId });
    out.set(r.employeeId, days);
  }
  return out;
}

/** Task hours can't go on a full-day absence (spec 14.2): the absence changes first. */
export async function refuseAbsenceDay(tx: Tx, employeeId: string, date: string): Promise<void> {
  const [row] = await tx.select({ label: timesheetAbsences.label }).from(timesheetAbsences).where(and(eq(timesheetAbsences.employeeId, employeeId), eq(timesheetAbsences.workDate, date)));
  if (row) throw new ConflictException(`${row.label} on this day: no task hours. Cancel or shorten the absence first.`);
}

/**
 * Pending time off as a hint without hours ("Vacation pending", spec 14.1). The time off module
 * registers its source on start; until then (or without it) there are none.
 */
export interface PendingAbsenceSource {
  pendingIn(tx: Tx, employeeId: string, from: string, to: string): Promise<Map<string, string>>;
}

class PendingAbsenceRegistry implements PendingAbsenceSource {
  private source: PendingAbsenceSource | null = null;
  use(source: PendingAbsenceSource): void {
    this.source = source;
  }
  pendingIn(tx: Tx, employeeId: string, from: string, to: string): Promise<Map<string, string>> {
    return this.source ? this.source.pendingIn(tx, employeeId, from, to) : Promise.resolve(new Map());
  }
}
export const pendingAbsenceRegistry = new PendingAbsenceRegistry();

/** "Vacation added", "Sick leave removed", "Vacation changed to Sick leave". */
function changeText(before: AbsenceLine | undefined, after: AbsenceLine | undefined): string {
  if (!before) return `${after!.label} added`;
  if (!after) return `${before.label} removed`;
  return before.label === after.label ? `${after.label} changed` : `${before.label} changed to ${after.label}`;
}

@Injectable()
export class TimesheetAbsencesService {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Makes one person's absence lines between two dates match `lines` (spec 14.1). Idempotent: run
   * twice it changes nothing the second time. Absences are authoritative, so they go through the
   * lock (spec 14.3): on a Submitted or Approved day the change is written to the day's history
   * as `absence_changed` ("Vacation added"), which the approver sees; task hours are never touched.
   * Returns the dates that changed.
   */
  sync(tenantId: string, employeeId: string, from: string, to: string, linesOf: (tx: Tx) => Promise<AbsenceLine[]>): Promise<string[]> {
    return this.database.withTenant(tenantId, async (tx) => {
      // The person's lock (the one time off changes take): two syncs, or a sync and a cancel, never
      // interleave, so a stale run can't write back a line a newer one removed.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employeeId}))`);
      const lines = await linesOf(tx);
      const wanted = new Map(lines.filter((l) => l.date >= from && l.date <= to).map((l) => [l.date, l]));
      const have = (await absencesIn(tx, [employeeId], from, to)).get(employeeId) ?? new Map<string, AbsenceLine>();
      const changed: { date: string; text: string }[] = [];
      for (const date of [...new Set([...wanted.keys(), ...have.keys()])].sort()) {
        const before = have.get(date);
        const after = wanted.get(date);
        if (before && after && before.kind === after.kind && before.label === after.label && before.minutes === after.minutes && before.sourceId === after.sourceId) continue;
        await lockDay(tx, employeeId, date);
        const where = and(eq(timesheetAbsences.employeeId, employeeId), eq(timesheetAbsences.workDate, date));
        if (!after) await tx.delete(timesheetAbsences).where(where);
        else if (before) await tx.update(timesheetAbsences).set({ kind: after.kind, label: after.label, minutes: after.minutes, sourceId: after.sourceId, updatedAt: new Date() }).where(where);
        else await tx.insert(timesheetAbsences).values({ tenantId, employeeId, workDate: date, kind: after.kind, label: after.label, minutes: after.minutes, sourceId: after.sourceId });
        changed.push({ date, text: changeText(before, after) });
      }
      if (!changed.length) return [];
      const statuses = await tx
        .select({ date: timesheetDays.workDate, status: timesheetDays.status })
        .from(timesheetDays)
        .where(and(eq(timesheetDays.employeeId, employeeId), inArray(timesheetDays.workDate, changed.map((c) => c.date))));
      const traced = new Set(statuses.filter((s) => s.status === 'submitted' || s.status === 'approved').map((s) => s.date));
      const settings = await timesheetSettings(tx, tenantId);
      for (const c of changed.filter((c) => traced.has(c.date))) {
        await recordDayEvents(tx, { tenantId, employeeId, dates: [c.date], kind: 'absence_changed', actor: { userId: null, name: 'Time off' }, comment: c.text, approvalMode: settings.approvalMode });
      }
      return changed.map((c) => c.date);
    });
  }
}
