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

/** GET /api/timesheet/week?week=2026-10-05 (default: this week). */
export const WeekQuery = z.object({ week: weekStart.optional() });
export type WeekQuery = z.infer<typeof WeekQuery>;

/**
 * PUT /api/timesheet/cells: one cell's hours (whole minutes in steps of 15, 0 clears it) and,
 * optionally, its note (empty clears it).
 */
export const SetCell = z
  .object({
    date: isoDate,
    ...target,
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
export const AddRow = z.object({ weekStart, ...target }).refine(oneTarget, ONE_TARGET);
export type AddRow = z.infer<typeof AddRow>;

/** POST /api/timesheet/copy: Copy last week into `weekStart`, rows only or rows and hours. */
export const CopyWeek = z.object({ weekStart, mode: z.enum(['rows', 'hours']) });
export type CopyWeek = z.infer<typeof CopyWeek>;

/** POST /api/timesheet/submit and /recall. */
export const WeekAction = z.object({ weekStart });
export type WeekAction = z.infer<typeof WeekAction>;

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
