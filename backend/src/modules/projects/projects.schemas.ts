import { z } from 'zod';
import { nonEmptyPatch } from '../../shared/validation/common';

/** A project type's or stage's name: required, at most 60 characters, trimmed (unique case-insensitively, in the database). */
const shortName = z.string().trim().min(1, 'Required').max(60, 'At most 60 characters');
/** Spec 3.2: required, 1 to 200 characters. */
const projectName = z.string().trim().min(1, 'Required').max(200, 'At most 200 characters');

/** POST /api/project-types: a new type after the others, with `stages` (default Planning, In progress, Review). */
export const CreateProjectType = z.object({ name: shortName, stages: z.array(shortName).min(1).max(20).optional() });
export type CreateProjectType = z.infer<typeof CreateProjectType>;

/** PATCH /api/project-types/:id: rename. */
export const UpdateProjectType = z.object({ name: shortName });
export type UpdateProjectType = z.infer<typeof UpdateProjectType>;

/** DELETE /api/project-types/:id?moveProjectsTo=<typeId>: required while the type has projects. */
export const DeleteProjectTypeQuery = z.object({ moveProjectsTo: z.uuid().optional() });
export type DeleteProjectTypeQuery = z.infer<typeof DeleteProjectTypeQuery>;

/** POST /api/project-types/:id/stages: a new stage at the end. */
export const CreateProjectStage = z.object({ name: shortName });
export type CreateProjectStage = z.infer<typeof CreateProjectStage>;

/** PATCH /api/project-types/:id/stages/:stageId: rename. */
export const UpdateProjectStage = z.object({ name: shortName });
export type UpdateProjectStage = z.infer<typeof UpdateProjectStage>;

/** PUT /api/project-types/:id/stages/order: every stage id of the type once, in the new order. */
export const ReorderProjectStages = z.object({ stageIds: z.array(z.uuid()).min(1).max(20) });
export type ReorderProjectStages = z.infer<typeof ReorderProjectStages>;

/** DELETE /api/project-types/:id/stages/:stageId?moveProjectsTo=<stageId>: required while the stage has projects. */
export const DeleteProjectStageQuery = z.object({ moveProjectsTo: z.uuid().optional() });
export type DeleteProjectStageQuery = z.infer<typeof DeleteProjectStageQuery>;

/**
 * POST /api/projects: a client project of `companyId`, optionally from `dealId` (a deal of that
 * company that isn't lost). It starts in the type's first stage. `leadUserId` defaults to the creator.
 */
export const CreateProject = z.object({
  name: projectName,
  projectTypeId: z.uuid(),
  companyId: z.uuid(),
  dealId: z.uuid().nullish(),
  leadUserId: z.uuid().nullish(),
});
export type CreateProject = z.infer<typeof CreateProject>;

/** PATCH /api/projects/:id (lead, owners and admins): rename, lead, stage (a stage of its type), status. */
export const UpdateProject = nonEmptyPatch(
  z
    .object({
      name: projectName,
      leadUserId: z.uuid(),
      stageId: z.uuid(),
      status: z.enum(['open', 'completed', 'cancelled']),
    })
    .partial(),
);
export type UpdateProject = z.infer<typeof UpdateProject>;

/** GET /api/projects?dealId=&companyId= */
export const ListProjectsQuery = z.object({ dealId: z.uuid().optional(), companyId: z.uuid().optional() });
export type ListProjectsQuery = z.infer<typeof ListProjectsQuery>;
