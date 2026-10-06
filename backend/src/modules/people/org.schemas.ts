import { z } from 'zod';
import { nonEmptyPatch } from '../../shared/validation/common';

/** Spec 6.2: required, at most 100 characters, trimmed (uniqueness is case-insensitive, in the database). */
const orgName = z.string().trim().min(1, 'Required').max(100, 'At most 100 characters');
/** A level's name ("Department", "Sector"): at most 50 characters. */
const levelName = z.string().trim().min(1, 'Required').max(50, 'At most 50 characters');
/** Spec 6.2: optional, at most 20 characters, unique; empty clears it. */
const code = z
  .string()
  .trim()
  .max(20, 'At most 20 characters')
  .transform((v) => (v === '' ? null : v))
  .nullish();

/**
 * Moving a unit's lead elsewhere ends that role: refused with 409 `heads_unit` unless this is true,
 * then the role is cleared (heads.ts).
 */
const clearLeadRoles = z.boolean().optional();

/** POST /api/people/org-levels (CD-226): a new level at `position` (1 = top; default: the bottom). */
export const CreateLevel = z.object({ name: levelName, position: z.number().int().min(1).max(5).optional() });
export type CreateLevel = z.infer<typeof CreateLevel>;

/** PATCH /api/people/org-levels/:id: rename. */
export const UpdateLevel = z.object({ name: levelName });
export type UpdateLevel = z.infer<typeof UpdateLevel>;

/** PUT /api/people/org-levels/order: every level's id, top-down. */
export const ReorderLevels = z.object({ ids: z.array(z.uuid()).min(1).max(5) });
export type ReorderLevels = z.infer<typeof ReorderLevels>;

/** POST /api/people/org-units: a unit of `levelId`, inside `parentId` (a unit of a higher level) or directly under the company. */
export const CreateUnit = z.object({ levelId: z.uuid(), parentId: z.uuid().nullish(), name: orgName, code, leadEmployeeId: z.uuid().nullish(), clearLeadRoles });
export type CreateUnit = z.infer<typeof CreateUnit>;

/** PATCH /api/people/org-units/:id: rename, code, move (`parentId`), lead. */
export const UpdateUnit = nonEmptyPatch(z.object({ name: orgName, code, parentId: z.uuid().nullable(), leadEmployeeId: z.uuid().nullable() }).partial()).and(z.object({ clearLeadRoles }));
export type UpdateUnit = z.infer<typeof UpdateUnit>;

/** GET /api/people/org-units/:id/lead-preview?leadEmployeeId= */
export const LeadPreviewQuery = z.object({ leadEmployeeId: z.uuid() });
export type LeadPreviewQuery = z.infer<typeof LeadPreviewQuery>;

const employeeIds = z.array(z.uuid()).min(1, 'Pick at least one employee').max(500, 'At most 500 employees at a time');

/**
 * POST /api/people/assignments ("Add people"): puts the employees in the unit (null: no unit). Their
 * manager follows the rules (the unit's lead, else the nearest lead above, else the CEO), except
 * for those in `managers`, which sets Reports to explicitly.
 */
export const Assign = z.object({ unitId: z.uuid().nullable(), employeeIds, managers: z.record(z.uuid(), z.uuid().nullable()).optional(), clearLeadRoles });
export type Assign = z.infer<typeof Assign>;

/** POST /api/people/reporting-lines ("Set manager" on one or many): `managerId` null removes it. */
export const SetReportingLines = z.object({ employeeIds, managerId: z.uuid().nullable(), clearLeadRoles });
export type SetReportingLines = z.infer<typeof SetReportingLines>;
