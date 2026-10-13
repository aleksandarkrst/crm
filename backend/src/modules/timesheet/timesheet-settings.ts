import { eq } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { publicHolidays, tenants } from '../../shared/database/schema';
import { addDays, DEFAULT_TIMESHEET_SETTINGS, type Holiday, type TimesheetSettings } from './timesheet-rules';

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
  reminderHours: tenants.timesheetReminderHours,
  afterDeadlineEmails: tenants.timesheetAfterDeadlineEmails,
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
    reminderHours: row.reminderHours,
    afterDeadlineEmails: row.afterDeadlineEmails,
  };
}

/** A holiday as entered (CD-318): its first day, its last day (null for one day) and the hours off. */
export interface HolidayRule {
  id: string;
  date: string;
  endDate: string | null;
  name: string;
  minutes: number | null;
}

export const holidayColumns = { id: publicHolidays.id, date: publicHolidays.holidayDate, endDate: publicHolidays.endDate, name: publicHolidays.name, minutes: publicHolidays.minutes };

/** The same day and month in `year`, or null when the year has no such day (29 February). */
export function sameDayIn(date: string, year: number): string | null {
  const candidate = `${year}${date.slice(4)}`;
  return new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) === candidate ? candidate : null;
}

/**
 * The holiday's days in `year` (CD-318): a holiday repeats every year from the year it was
 * entered, over the same span of days. Empty before that year, and in a year without its first day.
 */
export function holidayDaysIn(rule: HolidayRule, year: number): string[] {
  if (year < Number(rule.date.slice(0, 4))) return [];
  const start = sameDayIn(rule.date, year);
  if (!start) return [];
  const span = rule.endDate ? Math.max(0, Math.round((Date.parse(`${rule.endDate}T00:00:00Z`) - Date.parse(`${rule.date}T00:00:00Z`)) / 86_400_000)) : 0;
  return Array.from({ length: span + 1 }, (_, i) => addDays(start, i));
}

/** The workspace's holiday rules, oldest first. Call inside `withTenant` (RLS). */
export const holidayRules = (tx: Tx): Promise<HolidayRule[]> => tx.select(holidayColumns).from(publicHolidays).orderBy(publicHolidays.holidayDate, publicHolidays.createdAt);

/** The workspace's public holidays from `from` to `to`, by date, with yearly repeats (CD-318). Call inside `withTenant` (RLS). */
export async function holidaysBetween(tx: Tx, from: string, to: string): Promise<Map<string, Holiday>> {
  const rules = await holidayRules(tx);
  const out = new Map<string, Holiday>();
  // A span can start in the year before `from` and reach into it.
  for (let year = Number(from.slice(0, 4)) - 1; year <= Number(to.slice(0, 4)); year++) {
    for (const rule of rules) {
      for (const date of holidayDaysIn(rule, year)) if (date >= from && date <= to) out.set(date, { date, name: rule.name, minutes: rule.minutes });
    }
  }
  return out;
}
