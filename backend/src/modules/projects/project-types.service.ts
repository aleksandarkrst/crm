import { BadRequestException, ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { MAX_PROJECT_STAGES, MAX_PROJECT_TYPES, projects, projectStages, projectTypes, tasks } from '../../shared/database/schema';
import { type TenantProvisioner, TenantProvisioning } from '../../shared/events/tenant-provisioning';
import type { CreateProjectStage, CreateProjectType, DeleteProjectStageQuery, DeleteProjectTypeQuery, ReorderProjectStages, UpdateProjectStage, UpdateProjectType } from './projects.schemas';

/** A new workspace's project type (drizzle/0051 gave existing workspaces the same). */
export const DEFAULT_PROJECT_TYPE = { name: 'Client project', stages: ['Planning', 'In progress', 'Review'] };
/** The stages of a new type when none are given (the design's "New project type"). */
const NEW_TYPE_STAGES = ['Planning', 'In progress', 'Review'];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface ProjectTypeView {
  id: string;
  name: string;
  position: number;
  version: Date;
  /** Projects of this type, open or closed. */
  projects: number;
  stages: { id: string; name: string; position: number; projects: number }[];
}

/** One transaction at a time changes a workspace's types and stages (positions stay 0..n-1). */
async function lockTypes(tx: Tx, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`projects.types:${tenantId}`}, 0))`);
}

/**
 * Project types and their stages (CD-272, design v2 §10): like funnels in the CRM. Everyone reads
 * them; owners and admins change them (the controller's @RequireTenant('admin')). A stage or type
 * that has projects is deleted only with somewhere to move them. Live updates come from the
 * tables' triggers (hint `project_type`).
 */
@Injectable()
export class ProjectTypesService implements TenantProvisioner, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioning,
  ) {}

  onModuleInit(): void {
    this.provisioning.register(this);
  }

  /** Seeds the default project type for a brand-new tenant (runs inside tenant creation). */
  async provision(tx: Tx, tenantId: string): Promise<void> {
    await insertType(tx, tenantId, DEFAULT_PROJECT_TYPE.name, DEFAULT_PROJECT_TYPE.stages, 0);
  }

  /** Every type in order with its stages in order, and how many projects each holds. */
  list(ctx: TenantContext): Promise<ProjectTypeView[]> {
    return this.database.withTenant(ctx.tenantId, (tx) => listTypes(tx));
  }

  create(ctx: TenantContext, input: CreateProjectType) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await lockTypes(tx, ctx.tenantId);
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(projectTypes);
        if (n >= MAX_PROJECT_TYPES) throw new ConflictException(`A workspace has at most ${MAX_PROJECT_TYPES} project types`);
        const stages = input.stages ?? NEW_TYPE_STAGES;
        if (new Set(stages.map((s) => s.toLowerCase())).size !== stages.length) throw new BadRequestException('Stage names must differ');
        const id = await insertType(tx, ctx.tenantId, input.name, stages, n);
        await this.audit.record(tx, ctx, { action: 'project_type.created', entityType: 'project_type', entityId: id, data: { name: input.name, stages } });
        return listTypes(tx);
      })
      .catch(mapDbError);
  }

  rename(ctx: TenantContext, id: string, input: UpdateProjectType) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.update(projectTypes).set({ name: input.name }).where(eq(projectTypes.id, id)).returning({ id: projectTypes.id });
        if (!row) throw new NotFoundException('Project type not found');
        await this.audit.record(tx, ctx, { action: 'project_type.renamed', entityType: 'project_type', entityId: id, data: { name: input.name } });
        return listTypes(tx);
      })
      .catch(mapDbError);
  }

  /**
   * Deletes a type and its stages. Its projects move to `moveProjectsTo` (another type), into that
   * type's first stage; required while there are any. The last type stays.
   */
  remove(ctx: TenantContext, id: string, query: DeleteProjectTypeQuery) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await lockTypes(tx, ctx.tenantId);
        const types = await listTypes(tx);
        const type = types.find((t) => t.id === id);
        if (!type) throw new NotFoundException('Project type not found');
        if (types.length === 1) throw new ConflictException('Keep at least one project type');
        if (type.projects > 0) {
          if (!query.moveProjectsTo) throw new ConflictException(`${type.name} has ${plural(type.projects, 'project')}. Pick a project type to move them to.`);
          const target = types.find((t) => t.id === query.moveProjectsTo && t.id !== id);
          if (!target) throw new BadRequestException('Pick another project type to move the projects to');
          // Their tasks (CD-146) go to the same first stage; the old stages go with the type.
          await tx
            .update(tasks)
            .set({ stageId: target.stages[0]!.id })
            .where(inArray(tasks.projectId, tx.select({ id: projects.id }).from(projects).where(eq(projects.projectTypeId, id))));
          await tx.update(projects).set({ projectTypeId: target.id, stageId: target.stages[0]!.id }).where(eq(projects.projectTypeId, id));
        }
        await tx.delete(projectTypes).where(eq(projectTypes.id, id));
        await tx.update(projectTypes).set({ position: sql`${projectTypes.position} - 1` }).where(sql`${projectTypes.position} > ${type.position}`);
        await this.audit.record(tx, ctx, { action: 'project_type.deleted', entityType: 'project_type', entityId: id, data: { name: type.name, moveProjectsTo: query.moveProjectsTo ?? null } });
        return listTypes(tx);
      })
      .catch(mapDbError);
  }

  createStage(ctx: TenantContext, typeId: string, input: CreateProjectStage) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await lockTypes(tx, ctx.tenantId);
        const type = await findType(tx, typeId);
        if (type.stages.length >= MAX_PROJECT_STAGES) throw new ConflictException(`A project type has at most ${MAX_PROJECT_STAGES} stages`);
        const [row] = await tx
          .insert(projectStages)
          .values({ tenantId: ctx.tenantId, projectTypeId: typeId, name: input.name, position: type.stages.length })
          .returning({ id: projectStages.id });
        await this.audit.record(tx, ctx, { action: 'project_stage.created', entityType: 'project_type', entityId: typeId, data: { stageId: row!.id, name: input.name } });
        return listTypes(tx);
      })
      .catch(mapDbError);
  }

  renameStage(ctx: TenantContext, typeId: string, stageId: string, input: UpdateProjectStage) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .update(projectStages)
          .set({ name: input.name })
          .where(and(eq(projectStages.id, stageId), eq(projectStages.projectTypeId, typeId)))
          .returning({ id: projectStages.id });
        if (!row) throw new NotFoundException('Stage not found');
        await this.audit.record(tx, ctx, { action: 'project_stage.renamed', entityType: 'project_type', entityId: typeId, data: { stageId, name: input.name } });
        return listTypes(tx);
      })
      .catch(mapDbError);
  }

  reorderStages(ctx: TenantContext, typeId: string, input: ReorderProjectStages) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await lockTypes(tx, ctx.tenantId);
        const type = await findType(tx, typeId);
        const ids = new Set(input.stageIds);
        if (ids.size !== input.stageIds.length || ids.size !== type.stages.length || type.stages.some((s) => !ids.has(s.id))) {
          throw new BadRequestException('Send every stage of the project type once, in the new order');
        }
        for (const [position, id] of input.stageIds.entries()) {
          if (type.stages.find((s) => s.id === id)!.position !== position) await tx.update(projectStages).set({ position }).where(eq(projectStages.id, id));
        }
        await this.audit.record(tx, ctx, { action: 'project_stage.reordered', entityType: 'project_type', entityId: typeId, data: { stageIds: input.stageIds } });
        return listTypes(tx);
      })
      .catch(mapDbError);
  }

  /** Projects in the stage move to `moveProjectsTo` (another stage of the type); required while there are any. The last stage stays. */
  removeStage(ctx: TenantContext, typeId: string, stageId: string, query: DeleteProjectStageQuery) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await lockTypes(tx, ctx.tenantId);
        const type = await findType(tx, typeId);
        const stage = type.stages.find((s) => s.id === stageId);
        if (!stage) throw new NotFoundException('Stage not found');
        if (type.stages.length === 1) throw new ConflictException('A project type needs at least one stage');
        if (stage.projects > 0) {
          if (!query.moveProjectsTo) throw new ConflictException(`${stage.name} has ${plural(stage.projects, 'project')}. Pick a stage to move them to.`);
          if (query.moveProjectsTo === stageId || !type.stages.some((s) => s.id === query.moveProjectsTo)) {
            throw new BadRequestException('Pick another stage of this project type to move the projects to');
          }
          await tx.update(projects).set({ stageId: query.moveProjectsTo }).where(eq(projects.stageId, stageId));
          await tx.update(tasks).set({ stageId: query.moveProjectsTo }).where(eq(tasks.stageId, stageId));
        }
        // Otherwise its tasks (CD-146) lose the stage (tasks_stage_fk: ON DELETE SET NULL).
        await tx.delete(projectStages).where(eq(projectStages.id, stageId));
        await tx
          .update(projectStages)
          .set({ position: sql`${projectStages.position} - 1` })
          .where(and(eq(projectStages.projectTypeId, typeId), sql`${projectStages.position} > ${stage.position}`));
        await this.audit.record(tx, ctx, { action: 'project_stage.deleted', entityType: 'project_type', entityId: typeId, data: { stageId, name: stage.name, moveProjectsTo: query.moveProjectsTo ?? null } });
        return listTypes(tx);
      })
      .catch(mapDbError);
  }
}

async function insertType(tx: Tx, tenantId: string, name: string, stages: string[], position: number): Promise<string> {
  const [type] = await tx.insert(projectTypes).values({ tenantId, name, position }).returning({ id: projectTypes.id });
  await tx.insert(projectStages).values(stages.map((s, i) => ({ tenantId, projectTypeId: type!.id, name: s, position: i })));
  return type!.id;
}

/** Every type with its stages, in order, and project counts (open and closed). */
export async function listTypes(tx: Tx): Promise<ProjectTypeView[]> {
  const types = await tx
    .select({ id: projectTypes.id, name: projectTypes.name, position: projectTypes.position, version: projectTypes.updatedAt })
    .from(projectTypes)
    .orderBy(asc(projectTypes.position), asc(projectTypes.createdAt));
  if (types.length === 0) return [];
  const stages = await tx
    .select({
      id: projectStages.id,
      typeId: projectStages.projectTypeId,
      name: projectStages.name,
      position: projectStages.position,
      // Qualified by hand: a select from one table renders its columns without the table name.
      projects: sql<number>`(select count(*)::int from ${projects} p where p.stage_id = "project_stages"."id")`,
    })
    .from(projectStages)
    .where(inArray(projectStages.projectTypeId, types.map((t) => t.id)))
    .orderBy(asc(projectStages.position));
  return types.map((t) => {
    const own = stages.filter((s) => s.typeId === t.id).map(({ typeId: _t, ...s }) => s);
    return { ...t, projects: own.reduce((n, s) => n + s.projects, 0), stages: own };
  });
}

async function findType(tx: Tx, id: string): Promise<ProjectTypeView> {
  const type = (await listTypes(tx)).find((t) => t.id === id);
  if (!type) throw new NotFoundException('Project type not found');
  return type;
}
