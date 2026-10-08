import { z } from 'zod';
import { MAX_WORK_ORDER_TECHNICIANS, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, WORK_ORDER_TYPES } from '../../shared/database/schema';
import { nonEmptyPatch } from '../../shared/validation/common';
import { quarterHours } from './tasks.schemas';

const title = z.string().trim().min(1, 'Required').max(200, 'At most 200 characters');
const text = (max: number) =>
  z
    .string()
    .max(max, `At most ${max.toLocaleString('en-US')} characters`)
    .transform((v) => (v.trim() === '' ? null : v))
    .nullable();
const holdReason = z.string().trim().min(1, 'Tell the team why the work is paused').max(200, 'At most 200 characters');
const technicianIds = z.array(z.uuid()).max(MAX_WORK_ORDER_TECHNICIANS, `At most ${MAX_WORK_ORDER_TECHNICIANS} technicians on one work order`);
/** 24-hour "HH:MM". */
const startTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const duration = quarterHours.max(99, 'At most 99 h');

/**
 * POST /api/work-orders. `technicianIds`: the first is the lead. With technicians, a date and a
 * start it is Scheduled, else Unscheduled.
 */
export const CreateWorkOrder = z.object({
  title,
  companyId: z.uuid(),
  projectId: z.uuid().nullable().optional(),
  type: z.enum(WORK_ORDER_TYPES).optional(),
  priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
  technicianIds: technicianIds.optional(),
  scheduledDate: z.iso.date().nullable().optional(),
  scheduledStart: startTime.nullable().optional(),
  durationHours: duration.optional(),
  location: text(300).optional(),
  equipment: text(300).optional(),
  job: text(10_000).optional(),
});
export type CreateWorkOrder = z.infer<typeof CreateWorkOrder>;

/**
 * PATCH /api/work-orders/:id. `status: 'on_hold'` needs `holdReason`; `scheduled` needs a
 * technician, a date and a start. Setting technicians, date and start moves an Unscheduled order
 * to Scheduled; clearing any of them moves a Scheduled one back to Unscheduled.
 */
export const UpdateWorkOrder = nonEmptyPatch(
  z
    .object({
      title,
      projectId: z.uuid().nullable(),
      type: z.enum(WORK_ORDER_TYPES),
      priority: z.enum(WORK_ORDER_PRIORITIES),
      status: z.enum(WORK_ORDER_STATUSES),
      holdReason,
      technicianIds,
      scheduledDate: z.iso.date().nullable(),
      scheduledStart: startTime.nullable(),
      durationHours: duration,
      location: text(300),
      equipment: text(300),
      job: text(10_000),
      report: text(10_000),
    })
    .partial(),
);
export type UpdateWorkOrder = z.infer<typeof UpdateWorkOrder>;

export const ListWorkOrdersQuery = z.object({
  projectId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  technicianId: z.union([z.uuid(), z.literal('me')]).optional(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});
export type ListWorkOrdersQuery = z.infer<typeof ListWorkOrdersQuery>;
