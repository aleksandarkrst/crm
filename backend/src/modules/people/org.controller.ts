import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { Assign, AssignmentPreview, CreateDepartment, CreateTeam, LeadPreviewQuery, SetReportingLines, UpdateDepartment, UpdateTeam } from './org.schemas';
import { OrgService } from './org.service';

/**
 * Departments, teams and reporting lines (CD-138, CD-139). Reading is for every member; every
 * change is for Admins (the service checks, 403 otherwise). See
 * docs/ARCHITECTURE.md, "Departments, teams and reporting lines".
 */
@Controller('people')
@RequireTenant('member')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  /** Every department, by name: `{ id, name, code, headEmployeeId, headName, version, teams, activeEmployees }[]`. */
  @Get('departments')
  departments(@Tenant() ctx: TenantContext) {
    return this.org.departments(ctx);
  }

  @Post('departments')
  createDepartment(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateDepartment)) body: CreateDepartment) {
    return this.org.createDepartment(ctx, body);
  }

  @Patch('departments/:id')
  updateDepartment(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(UpdateDepartment)) body: UpdateDepartment) {
    return this.org.updateDepartment(ctx, id, body);
  }

  /** 409 while it has teams or another module uses it. */
  @Delete('departments/:id')
  @HttpCode(204)
  deleteDepartment(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.org.deleteDepartment(ctx, id);
  }

  /** For the delete confirmation: `{ id, name, teams, usedBy, members }`. */
  @Get('departments/:id/usage')
  departmentUsage(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.org.departmentUsage(ctx, id);
  }

  /** Every team, by department and name: `{ id, departmentId, name, leadEmployeeId, leadName, leadOutside, version, activeEmployees }[]`. */
  @Get('teams')
  teams(@Tenant() ctx: TenantContext) {
    return this.org.teams(ctx);
  }

  /** `{ team, moved, reassigned, loops }`. */
  @Post('teams')
  createTeam(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateTeam)) body: CreateTeam) {
    return this.org.createTeam(ctx, body);
  }

  /** Rename, move (`moved`: active members whose department changed), lead (+ `makeMembersReport`): `{ team, moved, reassigned, loops }`. */
  @Patch('teams/:id')
  updateTeam(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(UpdateTeam)) body: UpdateTeam) {
    return this.org.updateTeam(ctx, id, body);
  }

  /** Members stay in the department without a team. */
  @Delete('teams/:id')
  @HttpCode(204)
  deleteTeam(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.org.deleteTeam(ctx, id);
  }

  /** For the delete and move confirmations: `{ id, name, departmentId, members }`. */
  @Get('teams/:id/usage')
  teamUsage(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.org.teamUsage(ctx, id);
  }

  /** "Make team members report to <lead>": `{ members, loops }`, nothing saved. */
  @Get('teams/:id/lead-preview')
  leadPreview(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Query(new ZodPipe(LeadPreviewQuery)) query: LeadPreviewQuery) {
    return this.org.leadPreview(ctx, id, query.leadEmployeeId);
  }

  /** "Add people" before saving: `{ employees: [{ …, moves, suggestedManagerId, suggestedManagerName }] }`. */
  @Post('assignments/preview')
  @HttpCode(200)
  previewAssignment(@Tenant() ctx: TenantContext, @Body(new ZodPipe(AssignmentPreview)) body: AssignmentPreview) {
    return this.org.previewAssignment(ctx, body);
  }

  /** "Add people" / "Set department and team": `{ updated, managersChanged }`. */
  @Post('assignments')
  @HttpCode(200)
  assign(@Tenant() ctx: TenantContext, @Body(new ZodPipe(Assign)) body: Assign) {
    return this.org.assign(ctx, body);
  }

  /** "Set manager" for one or many: `{ changed }`. */
  @Post('reporting-lines')
  @HttpCode(200)
  setReportingLines(@Tenant() ctx: TenantContext, @Body(new ZodPipe(SetReportingLines)) body: SetReportingLines) {
    return this.org.setReportingLines(ctx, body);
  }
}
