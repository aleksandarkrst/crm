import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { CreateProject, ListProjectsQuery, UpdateProject } from './projects.schemas';
import { ProjectsService } from './projects.service';

const Id = new ZodPipe(UuidParam);

/**
 * Client projects (CD-233). Any member reads and creates; the lead, owners and admins change one
 * (the service checks, 403 otherwise); owners and admins delete one. A project: `{ id, name, code,
 * status, cancelReason, health, description, startDate, endDate, projectTypeId, projectTypeName,
 * stageId, stageName, companyId, companyName, dealId, dealTitle, dealLost, leadUserId, leadName,
 * createdAt, version }`.
 */
@Controller('projects')
@RequireTenant('member')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** `?dealId=` / `?companyId=` narrow the list. */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ListProjectsQuery)) query: ListProjectsQuery) {
    return this.projects.list(ctx, query);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.projects.get(ctx, id);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateProject)) body: CreateProject) {
    return this.projects.create(ctx, body);
  }

  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateProject)) body: UpdateProject) {
    return this.projects.update(ctx, id, body);
  }

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.projects.remove(ctx, id);
  }
}
