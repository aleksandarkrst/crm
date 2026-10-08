import { z } from 'zod';
import { TASK_STATUSES } from '../../shared/database/schema';
import { nonEmptyPatch } from '../../shared/validation/common';

/** Required, 1 to 200 characters (CD-146). */
const taskName = z.string().trim().min(1, 'Required').max(200, 'At most 200 characters');
const isoDate = z.iso.date().nullable();
/** Optional, 0.25 to 9,999 hours in steps of 0.25 (a quarter of an hour). */
export const quarterHours = z
  .number()
  .min(0.25, 'At least 0.25 h')
  .max(9999, 'At most 9,999 h')
  .refine((v) => Number.isInteger(v * 4), 'Use steps of 0.25 h (a quarter of an hour)');
const description = z
  .string()
  .max(10_000, 'At most 10,000 characters')
  .transform((v) => (v.trim() === '' ? null : v))
  .nullable();
/** On hold: one of the dialog's presets or the person's own words. */
const holdReason = z.string().trim().min(1, 'Tell the team why the work is paused').max(200, 'At most 200 characters');

/**
 * POST /api/tasks: a task of `projectId` (an open project), To do, at the project's current stage
 * unless `stageId` (a stage of the project's type) comes along. `assigneeIds`: employees to assign.
 */
export const CreateTask = z.object({
  projectId: z.uuid(),
  name: taskName,
  stageId: z.uuid().nullable().optional(),
  description: description.optional(),
  startDate: isoDate.optional(),
  dueDate: isoDate.optional(),
  estimateHours: quarterHours.nullable().optional(),
  assigneeIds: z.array(z.uuid()).max(50, 'At most 50 people on one task').optional(),
});
export type CreateTask = z.infer<typeof CreateTask>;

/**
 * PATCH /api/tasks/:id. `status: 'on_hold'` needs `onHoldReason` (or keeps the one it has);
 * leaving On hold clears it. `projectId` moves the task to another project (its stage becomes that
 * project's current stage unless `stageId` comes along).
 */
export const UpdateTask = nonEmptyPatch(
  z
    .object({
      name: taskName,
      projectId: z.uuid(),
      stageId: z.uuid().nullable(),
      status: z.enum(TASK_STATUSES),
      onHoldReason: holdReason,
      description,
      startDate: isoDate,
      dueDate: isoDate,
      estimateHours: quarterHours.nullable(),
    })
    .partial(),
);
export type UpdateTask = z.infer<typeof UpdateTask>;

/** GET /api/tasks: every task the caller can see, narrowed by these. `assigneeId=me` is the caller's own employee. */
export const ListTasksQuery = z.object({
  projectId: z.uuid().optional(),
  assigneeId: z.union([z.uuid(), z.literal('me')]).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});
export type ListTasksQuery = z.infer<typeof ListTasksQuery>;

/** POST /api/tasks/:id/assignees: employees to add (already active ones: 409). */
export const AssignTask = z.object({ employeeIds: z.array(z.uuid()).min(1, 'Pick at least one person').max(50) });
export type AssignTask = z.infer<typeof AssignTask>;

/** GET /api/tasks/:id/history. */
export const TaskHistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TaskHistoryQuery = z.infer<typeof TaskHistoryQuery>;
