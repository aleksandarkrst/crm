import { z } from 'zod';
import { INVITATION_ROLES, LEAVING_REASONS } from '../../shared/database/schema';

/** yyyy-mm-dd, a real date. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a valid date');

/** POST /api/people/employees/:id/invite (Admin, spec 4.7): the workspace role, Member by default. */
export const InviteEmployee = z.object({ role: z.enum(INVITATION_ROLES).default('member') });
export type InviteEmployee = z.infer<typeof InviteEmployee>;

/** POST /api/people/employees/:id/link (Admin, spec 4.6). */
export const LinkMember = z.object({ userId: z.uuid() });
export type LinkMember = z.infer<typeof LinkMember>;

/**
 * POST /api/people/employees/:id/deactivate (Admin; spec 4.8). `reportsManagerId`
 * is required (null = "No manager") when the person has active direct reports. Team leads and
 * department heads they hold are cleared unless a replacement is named.
 */
export const DeactivateEmployee = z.object({
  lastWorkingDay: isoDate,
  reason: z.enum(LEAVING_REASONS).nullish(),
  reportsManagerId: z.uuid().nullish(),
  teamLeads: z.array(z.object({ teamId: z.uuid(), employeeId: z.uuid().nullable() })).max(200).default([]),
  departmentHeads: z.array(z.object({ departmentId: z.uuid(), employeeId: z.uuid().nullable() })).max(200).default([]),
});
export type DeactivateEmployee = z.infer<typeof DeactivateEmployee>;

/**
 * POST /api/people/employees/:id/reactivate (Admin; spec 4.8). An Inactive
 * employee (a rehire) needs the new employment start date; for someone Leaving it cancels the
 * scheduled deactivation.
 */
export const ReactivateEmployee = z.object({ employmentStartDate: isoDate.optional() });
export type ReactivateEmployee = z.infer<typeof ReactivateEmployee>;

/** POST /api/dev/people/deactivate-due (dev auth only): run the daily job as if it were `now`. */
export const DeactivateDueNow = z.object({ now: z.iso.datetime({ offset: true }).optional() });
export type DeactivateDueNow = z.infer<typeof DeactivateDueNow>;
