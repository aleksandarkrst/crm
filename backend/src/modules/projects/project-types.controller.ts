import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { ProjectTypesService } from './project-types.service';
import { CreateProjectStage, CreateProjectType, DeleteProjectStageQuery, DeleteProjectTypeQuery, ReorderProjectStages, UpdateProjectStage, UpdateProjectType } from './projects.schemas';

const Id = new ZodPipe(UuidParam);

/**
 * Project types and their stages (CD-272). Everyone reads them; owners and admins change them, as
 * with funnels. Every change returns all types: `{ id, name, position, version, projects, stages:
 * { id, name, position, projects }[] }[]`.
 */
@Controller('project-types')
@RequireTenant('member')
export class ProjectTypesController {
  constructor(private readonly types: ProjectTypesService) {}

  @Get()
  list(@Tenant() ctx: TenantContext) {
    return this.types.list(ctx);
  }

  @Post()
  @RequireTenant('admin')
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateProjectType)) body: CreateProjectType) {
    return this.types.create(ctx, body);
  }

  @Patch(':id')
  @RequireTenant('admin')
  rename(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateProjectType)) body: UpdateProjectType) {
    return this.types.rename(ctx, id, body);
  }

  /** Its projects move to `?moveProjectsTo=<typeId>` (required when there are any); never the last type. */
  @Delete(':id')
  @RequireTenant('admin')
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Query(new ZodPipe(DeleteProjectTypeQuery)) query: DeleteProjectTypeQuery) {
    return this.types.remove(ctx, id, query);
  }

  @Post(':id/stages')
  @RequireTenant('admin')
  createStage(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(CreateProjectStage)) body: CreateProjectStage) {
    return this.types.createStage(ctx, id, body);
  }

  /** Declared before ':stageId' routes; every stage id of the type, in the new order. */
  @Put(':id/stages/order')
  @RequireTenant('admin')
  reorderStages(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(ReorderProjectStages)) body: ReorderProjectStages) {
    return this.types.reorderStages(ctx, id, body);
  }

  @Patch(':id/stages/:stageId')
  @RequireTenant('admin')
  renameStage(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('stageId', Id) stageId: string, @Body(new ZodPipe(UpdateProjectStage)) body: UpdateProjectStage) {
    return this.types.renameStage(ctx, id, stageId, body);
  }

  /** Its projects move to `?moveProjectsTo=<stageId>` (required when there are any); never the last stage. */
  @Delete(':id/stages/:stageId')
  @RequireTenant('admin')
  removeStage(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('stageId', Id) stageId: string, @Query(new ZodPipe(DeleteProjectStageQuery)) query: DeleteProjectStageQuery) {
    return this.types.removeStage(ctx, id, stageId, query);
  }
}
