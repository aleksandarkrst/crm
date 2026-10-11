import { z } from 'zod';
import { nonEmptyPatch } from '../../shared/validation/common';
import { mondayOf } from './timesheet-rules';

const isoDate = z.iso.date();
/** A week is its Monday. */
const weekStart = isoDate.refine((d) => mondayOf(d) === d, 'A week starts on a Monday');
/** A task or a work order, never both (time_entries_target_ck). */
const target = { taskId: z.uuid().optional(), workOrderId: z.uuid().optional() };
const oneTarget = (v: { taskId?: string; workOrderId?: string }) => !!v.taskId !== !!v.workOrderId;
const ONE_TARGET = { message: 'Pick a task or a work order' };

/** Someone else's timesheet (CD-317): Admins only; left out, the caller's own. */
const forEmployee = { employeeId: z.uuid().optional() };

/** GET /api/timesheet/week?week=2026-10-05 (default: this week); `employeeId` for an Admin acting on behalf (CD-317). */
export const WeekQuery = z.object({ week: weekStart.optional(), ...forEmployee });
export type WeekQuery = z.infer<typeof WeekQuery>;

/** GET /api/timesheet/loggable?employeeId= (CD-317). */
export const LoggableQuery = z.object(forEmployee);
export type LoggableQuery = z.infer<typeof LoggableQuery>;

/**
 * PUT /api/timesheet/cells: one cell's hours (whole minutes in steps of 15, 0 clears it) and,
 * optionally, its note (empty clears it).
 */
export const SetCell = z
  .object({
    date: isoDate,
    ...target,
    ...forEmployee,
    minutes: z
      .number()
      .int()
      .min(0)
      .max(1440, 'At most 24 h')
      .refine((m) => m % 15 === 0, 'Use steps of 15 minutes'),
    note: z
      .string()
      .max(500, 'A note can have up to 500 characters')
      .transform((v) => (v.trim() === '' ? null : v))
      .nullable()
      .optional(),
  })
  .refine(oneTarget, ONE_TARGET);
export type SetCell = z.infer<typeof SetCell>;

/** POST /api/timesheet/rows: "+ Add task or work order". */
export const AddRow = z.object({ weekStart, ...target, ...forEmployee }).refine(oneTarget, ONE_TARGET);
export type AddRow = z.infer<typeof AddRow>;

/** POST /api/timesheet/copy: Copy last week into `weekStart`, rows only or rows and hours. */
export const CopyWeek = z.object({ weekStart, mode: z.enum(['rows', 'hours']), ...forEmployee });
export type CopyWeek = z.infer<typeof CopyWeek>;

/** GET /api/timesheet/copy and POST /recall (recall is always the caller's own: `employeeId` is ignored there). */
export const WeekAction = z.object({ weekStart, ...forEmployee });
export type WeekAction = z.infer<typeof WeekAction>;

/** POST /api/timesheet/submit: the week, or with `date` one of its days (Day by day mode, CD-156). */
export const SubmitWeek = z
  .object({ weekStart, date: isoDate.optional(), ...forEmployee })
  .refine((v) => !v.date || mondayOf(v.date) === v.weekStart, { message: 'The day must be in that week', path: ['date'] });
export type SubmitWeek = z.infer<typeof SubmitWeek>;

/** POST /api/timesheet/resubmit (CD-158): the week's Rejected days, or one of them (Day by day mode), with an optional reply to the approver. */
export const ResubmitWeek = z
  .object({
    weekStart,
    date: isoDate.optional(),
    ...forEmployee,
    reply: z
      .string()
      .max(1000, 'A reply can have up to 1,000 characters')
      .transform((v) => (v.trim() === '' ? null : v.trim()))
      .nullable()
      .optional(),
  })
  .refine((v) => !v.date || mondayOf(v.date) === v.weekStart, { message: 'The day must be in that week', path: ['date'] });
export type ResubmitWeek = z.infer<typeof ResubmitWeek>;

/** GET /api/timesheet/approvals?week=2026-10-05 (default: the latest week whose deadline passed). */
export const ApprovalsQuery = z.object({ week: weekStart.optional() });
export type ApprovalsQuery = z.infer<typeof ApprovalsQuery>;

const inWeek = (v: { weekStart: string; dates?: string[] }) => !v.dates || v.dates.every((d) => mondayOf(d) === v.weekStart);
const IN_WEEK = { message: 'The days must be in that week', path: ['dates'] };
/** One person's week; `dates` picks days of it (Day by day mode, or Return selected days). */
const weekDays = { employeeId: z.uuid(), weekStart, dates: z.array(isoDate).min(1).max(7).optional() };

/** POST /api/timesheet/approvals/approve (CD-157). */
export const ApproveDays = z.object(weekDays).refine(inWeek, IN_WEEK);
export type ApproveDays = z.infer<typeof ApproveDays>;

/** POST /api/timesheet/approvals/unlock (CD-159, Admins): approved days back to the employee, with a reason of 10 to 1,000 characters (spec 9.2). */
export const UnlockDays = z
  .object({ ...weekDays, reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(1000, 'A reason can have up to 1,000 characters') })
  .refine(inWeek, IN_WEEK);
export type UnlockDays = z.infer<typeof UnlockDays>;

/** POST /api/timesheet/approvals/return (CD-157): the comment is required (spec 5.3 T4). */
export const ReturnDays = z.object({ ...weekDays, comment: z.string().trim().min(1, 'Enter a comment').max(1000, 'A comment can have up to 1,000 characters') }).refine(inWeek, IN_WEEK);
export type ReturnDays = z.infer<typeof ReturnDays>;

/** 24-hour "HH:MM". */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const entryMinutes = z
  .number()
  .int()
  .min(15, 'Enter the hours first')
  .max(1440, 'At most 24 h')
  .refine((m) => m % 15 === 0, 'Use steps of 15 minutes');
const entryNote = z
  .string()
  .max(500, 'A note can have up to 500 characters')
  .transform((v) => (v.trim() === '' ? null : v))
  .nullable();

/**
 * POST /api/timesheet/entries (CD-276): an entry from the task or work order page, the caller's own.
 * Hours as `minutes`, or Start → End (`startTime`, `endTime`; then the minutes are their difference).
 */
export const CreateEntry = z
  .object({ ...target, date: isoDate, minutes: entryMinutes.optional(), startTime: hhmm.optional(), endTime: hhmm.optional(), note: entryNote.optional() })
  .refine(oneTarget, ONE_TARGET)
  .refine((v) => (v.startTime === undefined) === (v.endTime === undefined), { message: 'Enter a start and an end' })
  .refine((v) => v.minutes !== undefined || v.startTime !== undefined, { message: 'Enter the hours first' });
export type CreateEntry = z.infer<typeof CreateEntry>;

/** PATCH /api/timesheet/entries/:id: date, hours, Start → End (null clears both) and note. */
export const UpdateEntry = nonEmptyPatch(z.object({ date: isoDate, minutes: entryMinutes, startTime: hhmm.nullable(), endTime: hhmm.nullable(), note: entryNote }).partial());
export type UpdateEntry = z.infer<typeof UpdateEntry>;

const holidayName = z.string().trim().min(1, 'Enter a name').max(100, 'At most 100 characters');
/** Hours off: whole minutes in steps of 15; null (or left out) is the whole standard day. */
const holidayMinutes = z
  .number()
  .int()
  .min(15, 'At least 0.25 hours')
  .max(1440, 'At most 24 hours')
  .refine((m) => m % 15 === 0, 'Use steps of 0.25 hours')
  .nullable();

/** GET /api/timesheet/holidays?year=2026 (this year by default). */
export const HolidaysQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
export type HolidaysQuery = z.infer<typeof HolidaysQuery>;

/** POST /api/timesheet/holidays (owners and admins). */
export const CreateHoliday = z.object({ date: isoDate, name: holidayName, minutes: holidayMinutes.optional() });
export type CreateHoliday = z.infer<typeof CreateHoliday>;

/** PATCH /api/timesheet/holidays/:id (owners and admins). */
export const UpdateHoliday = nonEmptyPatch(z.object({ date: isoDate, name: holidayName, minutes: holidayMinutes }).partial());
export type UpdateHoliday = z.infer<typeof UpdateHoliday>;

/** POST /api/timesheet/holidays/copy: last year's holidays into `year`. */
export const CopyHolidays = z.object({ year: z.number().int().min(2001).max(2100) });
export type CopyHolidays = z.infer<typeof CopyHolidays>;
