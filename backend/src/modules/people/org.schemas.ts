import { z } from 'zod';
import { nonEmptyPatch } from '../../shared/validation/common';

/** Spec 6.2: required, at most 100 characters, trimmed (uniqueness is case-insensitive, in the database). */
const orgName = z.string().trim().min(1, 'Required').max(100, 'At most 100 characters');
/** Spec 6.2: optional, at most 20 characters, unique; empty clears it. */
const code = z
  .string()
  .trim()
  .max(20, 'At most 20 characters')
  .transform((v) => (v === '' ? null : v))
  .nullish();

/**
 * Moving a department head or team lead elsewhere ends that role: refused with 409
 * `heads_department` unless this is true, then the role is cleared (CD-225, heads.ts).
 */
const clearHeadRoles = z.boolean().optional();

/** POST /api/people/departments. The head is put in the department (CD-225). */
export const CreateDepartment = z.object({ name: orgName, code, headEmployeeId: z.uuid().nullish(), clearHeadRoles });
export type CreateDepartment = z.infer<typeof CreateDepartment>;

/** PATCH /api/people/departments/:id. A new head is put in the department (CD-225). */
export const UpdateDepartment = nonEmptyPatch(z.object({ name: orgName, code, headEmployeeId: z.uuid().nullable() }).partial()).and(z.object({ clearHeadRoles }));
export type UpdateDepartment = z.infer<typeof UpdateDepartment>;

/** POST /api/people/teams. The lead is put in the team and its department (CD-225). */
export const CreateTeam = z.object({ departmentId: z.uuid(), name: orgName, leadEmployeeId: z.uuid().nullish(), clearHeadRoles });
export type CreateTeam = z.infer<typeof CreateTeam>;

/**
 * PATCH /api/people/teams/:id. `departmentId` moves the team (its members move with it).
 * `makeMembersReport` with a new lead: "Make team members report to <lead>" (spec 6.3) for members
 * with no manager or who reported to the previous lead. Off unless sent: a lead alone never
 * changes anyone's manager. A new lead is put in the team and its department (CD-225).
 */
export const UpdateTeam = nonEmptyPatch(
  z.object({ name: orgName, departmentId: z.uuid(), leadEmployeeId: z.uuid().nullable(), makeMembersReport: z.boolean() }).partial(),
)
  .refine((v) => !v.makeMembersReport || v.leadEmployeeId !== undefined, { message: 'makeMembersReport needs leadEmployeeId' })
  .and(z.object({ clearHeadRoles }));
export type UpdateTeam = z.infer<typeof UpdateTeam>;

/** GET /api/people/teams/:id/lead-preview?leadEmployeeId= */
export const LeadPreviewQuery = z.object({ leadEmployeeId: z.uuid() });
export type LeadPreviewQuery = z.infer<typeof LeadPreviewQuery>;

const employeeIds = z.array(z.uuid()).min(1, 'Pick at least one employee').max(500, 'At most 500 employees at a time');

/** POST /api/people/assignments/preview: who moves from where, and the suggested manager. */
export const AssignmentPreview = z.object({ departmentId: z.uuid(), teamId: z.uuid().nullish(), employeeIds });
export type AssignmentPreview = z.infer<typeof AssignmentPreview>;

/**
 * POST /api/people/assignments ("Add people", "Set department and team"): puts the employees in the
 * department, and in the team when given (moving them out of any other team). `managers` sets
 * Reports to of some of them at the same time (the prefilled suggestion, as the user left it).
 */
export const Assign = AssignmentPreview.extend({ managers: z.record(z.uuid(), z.uuid().nullable()).optional(), clearHeadRoles });
export type Assign = z.infer<typeof Assign>;

/** POST /api/people/reporting-lines ("Set manager" on one or many): `managerId` null removes it. */
export const SetReportingLines = z.object({ employeeIds, managerId: z.uuid().nullable() });
export type SetReportingLines = z.infer<typeof SetReportingLines>;
