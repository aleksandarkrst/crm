import { z } from 'zod';
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
