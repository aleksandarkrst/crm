import type { Tx } from '../../shared/database/database.service';
import { addDays, type Holiday, isoWeekday } from './timesheet-rules';

/**
 * Today's status (CD-162, spec 15 section 12): what each employee is doing on a date. The rule is
 * pure (`dayStatus`, unit-tested); TeamStatusService loads its input. Absences and trips come from
 * the modules that own them through `statusAbsenceRegistry`, so this module reads no time off or
 * travel table: time off (milestone 16) registers its source on start, trips (milestone 17) will
 * add theirs the same way.
 */

export const DAY_STATUSES = ['not_employed', 'public_holiday', 'sick_leave', 'time_off', 'business_trip', 'non_working', 'working'] as const;
export type DayStatus = (typeof DAY_STATUSES)[number];

/** An approved absence or trip covering the date: `from` and `to` are its first and last day (`to` null: open sick leave). */
export interface StatusAbsence {
  kind: 'sick_leave' | 'time_off' | 'business_trip';
  /** "Vacation", "Paid leave: Marriage", "Sick leave" (never the type of sick leave), "Vienna, AT". */
  label: string;
  from: string;
  to: string | null;
}

export interface StatusInput {
  date: string;
  employment: { start: string | null; end: string | null };
  holiday: Holiday | undefined;
  /** The standard working day: a holiday shorter than it is part-day, not a day off. */
  dayMinutes: number;
  workingDays: readonly number[];
  /** Approved absences and trips covering the date, in any order. */
  absences: readonly StatusAbsence[];
  /** Hours entered on the date (task hours; absence lines aren't task hours). */
  enteredMinutes: number;
  /** The first working day after `date` (skips non-working weekdays and public holidays). */
  nextWorkingDay: (date: string) => string;
}

export interface StatusResult {
  status: DayStatus;
  label: string;
  detail: string | null;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Wed 14 Oct". */
export const shortDate = (date: string) => `${DAY_NAMES[isoWeekday(date) - 1]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

export const STATUS_LABEL: Record<DayStatus, string> = {
  not_employed: 'Not employed',
  public_holiday: 'Public holiday',
  sick_leave: 'Sick leave',
  time_off: 'Time off',
  business_trip: 'Business trip',
  non_working: 'Not a working day',
  working: 'Working',
};

/** A full-day holiday: no minutes given, or at least the standard day. */
const fullDay = (h: Holiday, dayMinutes: number) => h.minutes === null || h.minutes >= dayMinutes;

/**
 * The status of one employee on one date (spec 12.2): the first rule that matches wins.
 *   1 Not employed · 2 Public holiday · 3 Sick leave · 4 Time off · 5 Business trip ·
 *   6 Not a working day (and no hours entered) · 7 Working ("Weekend work" with hours on a
 *   non-working day; a part-day holiday's name otherwise).
 */
export function dayStatus(input: StatusInput): StatusResult {
  const { date, employment } = input;
  if ((employment.start && date < employment.start) || (employment.end && date > employment.end)) {
    return { status: 'not_employed', label: STATUS_LABEL.not_employed, detail: employment.start && date < employment.start ? `Starts ${shortDate(employment.start)}` : null };
  }
  if (input.holiday && fullDay(input.holiday, input.dayMinutes)) return { status: 'public_holiday', label: STATUS_LABEL.public_holiday, detail: input.holiday.name };

  const sick = input.absences.find((a) => a.kind === 'sick_leave');
  if (sick) return { status: 'sick_leave', label: STATUS_LABEL.sick_leave, detail: sick.to ? `Until ${shortDate(sick.to)}` : `Since ${shortDate(sick.from)}` };
  const off = input.absences.find((a) => a.kind === 'time_off');
  if (off) return { status: 'time_off', label: off.label, detail: off.to ? `Back on ${shortDate(input.nextWorkingDay(off.to))}` : null };
  const trip = input.absences.find((a) => a.kind === 'business_trip');
  if (trip) return { status: 'business_trip', label: STATUS_LABEL.business_trip, detail: [trip.label, trip.to ? `back on ${shortDate(input.nextWorkingDay(trip.to))}` : null].filter(Boolean).join(' · ') || null };

  const workingDay = input.workingDays.includes(isoWeekday(date));
  if (!workingDay && input.enteredMinutes <= 0) return { status: 'non_working', label: STATUS_LABEL.non_working, detail: null };
  const detail = !workingDay ? 'Weekend work' : input.holiday ? `${input.holiday.name} (part day)` : null;
  return { status: 'working', label: STATUS_LABEL.working, detail };
}

/** The first working day after `date` that isn't a full-day holiday (at most 60 days on). */
export function nextWorkingDayAfter(date: string, workingDays: readonly number[], isHoliday: (date: string) => boolean): string {
  let d = addDays(date, 1);
  for (let i = 0; i < 60 && (!workingDays.includes(isoWeekday(d)) || isHoliday(d)); i++) d = addDays(d, 1);
  return d;
}

/**
 * Where Today's status learns about absences and trips. Each owning module registers a source on
 * start; without any, nobody is away.
 */
export interface StatusAbsenceSource {
  /** Approved absences or trips of these people covering `date`, by employee id. */
  coveringOn(tx: Tx, employeeIds: string[], date: string): Promise<Map<string, StatusAbsence[]>>;
  /** Requests waiting for a decision that cover `date` ("Vacation requested"), by employee id. */
  requestedOn(tx: Tx, employeeIds: string[], date: string): Promise<Map<string, string>>;
}

class StatusAbsenceRegistry {
  private readonly sources: StatusAbsenceSource[] = [];

  use(source: StatusAbsenceSource): void {
    if (!this.sources.includes(source)) this.sources.push(source);
  }

  async coveringOn(tx: Tx, employeeIds: string[], date: string): Promise<Map<string, StatusAbsence[]>> {
    const out = new Map<string, StatusAbsence[]>();
    if (!employeeIds.length) return out;
    for (const source of this.sources) {
      for (const [id, list] of await source.coveringOn(tx, employeeIds, date)) out.set(id, [...(out.get(id) ?? []), ...list]);
    }
    return out;
  }

  async requestedOn(tx: Tx, employeeIds: string[], date: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!employeeIds.length) return out;
    for (const source of this.sources) for (const [id, note] of await source.requestedOn(tx, employeeIds, date)) if (!out.has(id)) out.set(id, note);
    return out;
  }
}

export const statusAbsenceRegistry = new StatusAbsenceRegistry();
