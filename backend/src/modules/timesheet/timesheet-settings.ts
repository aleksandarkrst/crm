import { and, between, eq } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { publicHolidays, tenants } from '../../shared/database/schema';
import { DEFAULT_TIMESHEET_SETTINGS, type Holiday, type TimesheetSettings } from './timesheet-rules';

/** The timesheet columns of `tenants` (CD-153), for reads and the workspace settings API. */
export const timesheetColumns = {
  dayMinutes: tenants.timesheetDayMinutes,
  dayStart: tenants.timesheetDayStart,
  dayEnd: tenants.timesheetDayEnd,
  workingDays: tenants.timesheetWorkingDays,
  timeFormat: tenants.timesheetTimeFormat,
  maxDayHours: tenants.timesheetMaxDayHours,
  deadlineWeekday: tenants.timesheetDeadlineWeekday,
  deadlineTime: tenants.timesheetDeadlineTime,
  deadlineWeek: tenants.timesheetDeadlineWeek,
  autoSubmit: tenants.timesheetAutoSubmit,
  autoSubmitSince: tenants.timesheetAutoSubmitSince,
  approvalMode: tenants.timesheetApprovalMode,
};

/** The workspace's timesheet settings (CD-153): the one read every rule uses. */
export async function timesheetSettings(tx: Tx, tenantId: string): Promise<TimesheetSettings> {
  const [row] = await tx.select(timesheetColumns).from(tenants).where(eq(tenants.id, tenantId));
  if (!row) return DEFAULT_TIMESHEET_SETTINGS;
  return {
    dayMinutes: row.dayMinutes,
    dayStart: row.dayStart,
    dayEnd: row.dayEnd,
    workingDays: [...row.workingDays].sort((a, b) => a - b),
    maxDayMinutes: row.maxDayHours * 60,
    timeFormat: row.timeFormat,
    deadline: { weekday: row.deadlineWeekday, time: row.deadlineTime, week: row.deadlineWeek },
    autoSubmit: row.autoSubmit,
    autoSubmitSince: row.autoSubmitSince,
    approvalMode: row.approvalMode,
  };
}

/** The workspace's public holidays from `from` to `to`, by date. Call inside `withTenant` (RLS). */
export async function holidaysBetween(tx: Tx, from: string, to: string): Promise<Map<string, Holiday>> {
  const rows = await tx
    .select({ date: publicHolidays.holidayDate, name: publicHolidays.name, minutes: publicHolidays.minutes })
    .from(publicHolidays)
    .where(and(between(publicHolidays.holidayDate, from, to)));
  return new Map(rows.map((r) => [r.date, r]));
}
