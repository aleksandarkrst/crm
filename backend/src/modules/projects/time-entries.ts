import { and, desc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { employees, recordChanges, tenants, timeEntries, timesheetDays } from '../../shared/database/schema';
import { zonedParts } from '../../shared/time/zoned-time';

/**
 * The time card on a task's page and the Track time card on a work order's page (CD-276): the
 * entries of the timesheet (milestone 15) on it, read here; they are written only through the
 * timesheet API. Everyone who sees the page sees the total; the entries of others only the project
 * lead, owners and admins and the person's managers (as the People and hours card, CD-147).
 */

export interface TimeEntryView {
  id: string;
  employeeId: string;
  name: string;
  date: string;
  minutes: number;
  note: string | null;
  /** "HH:MM", both or neither (Start → End on a work order). */
  startTime: string | null;
  endTime: string | null;
  /** The day's status in the timesheet: Submitted and Approved days can't change (the lock). */
  dayStatus: 'draft' | 'submitted' | 'rejected' | 'approved';
  mine: boolean;
  /** Edit and Delete: the caller's own entry, on a Draft or Rejected day, while nothing locks the task or order. */
  canChange: boolean;
}

export interface TimeEntriesView {
  /** Everyone's minutes, also entries the caller doesn't see. */
  loggedMinutes: number;
  entries: TimeEntryView[];
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** The entries on a task or work order, newest first, with what the caller may see and change. */
export async function timeEntriesOf(
  tx: Tx,
  target: { taskId: string } | { workOrderId: string },
  viewer: { me: string | null; seesAllOf: (employeeId: string) => boolean; locked: boolean },
): Promise<TimeEntriesView> {
  const rows = await tx
    .select({
      id: timeEntries.id,
      employeeId: timeEntries.employeeId,
      name: employees.fullName,
      date: timeEntries.workDate,
      minutes: timeEntries.minutes,
      note: timeEntries.note,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      dayStatus: timesheetDays.status,
    })
    .from(timeEntries)
    .innerJoin(employees, eq(employees.id, timeEntries.employeeId))
    .leftJoin(
      timesheetDays,
      and(eq(timesheetDays.tenantId, timeEntries.tenantId), eq(timesheetDays.employeeId, timeEntries.employeeId), eq(timesheetDays.workDate, timeEntries.workDate)),
    )
    .where('taskId' in target ? eq(timeEntries.taskId, target.taskId) : eq(timeEntries.workOrderId, target.workOrderId))
    .orderBy(desc(timeEntries.workDate), sql`${timeEntries.startTime} desc nulls last`, desc(timeEntries.createdAt));
  const loggedMinutes = rows.reduce((a, r) => a + r.minutes, 0);
  const entries = rows
    .filter((r) => r.employeeId === viewer.me || viewer.seesAllOf(r.employeeId))
    .map((r) => {
      const dayStatus = r.dayStatus ?? 'draft';
      const mine = r.employeeId === viewer.me;
      return {
        ...r,
        startTime: hhmm(r.startTime),
        endTime: hhmm(r.endTime),
        dayStatus,
        mine,
        canChange: mine && !viewer.locked && (dayStatus === 'draft' || dayStatus === 'rejected'),
      };
    });
  return { loggedMinutes, entries };
}

/**
 * The hint on a task of a closed project (CD-276, design `Timesheet.dc.html#cd-277`): "Hidrogradnja ›
 * Engine overhaul, CAT 336 was completed on Fri 2 Oct." with when (the workspace's date), from the
 * project's history.
 */
export async function closedProjectHint(tx: Tx, p: { projectId: string; projectName: string; companyName: string; projectStatus: string }): Promise<string> {
  const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(sql`${tenants.id} = app_current_tenant()`);
  const [change] = await tx
    .select({ at: recordChanges.changedAt })
    .from(recordChanges)
    .where(and(eq(recordChanges.entityType, 'project'), eq(recordChanges.entityId, p.projectId), eq(recordChanges.field, 'status')))
    .orderBy(desc(recordChanges.changedAt))
    .limit(1);
  const verb = p.projectStatus === 'cancelled' ? 'cancelled' : 'completed';
  const at = change ? zonedParts(change.at, tenant?.timezone ?? 'UTC') : null;
  const when = at ? ` on ${at.weekday} ${at.day} ${at.month}` : '';
  return `${p.companyName} › ${p.projectName} was ${verb}${when}.`;
}
