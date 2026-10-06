import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { Assign, CreateLevel, CreateUnit, LeadPreviewQuery, ReorderLevels, SetReportingLines, UpdateLevel, UpdateUnit } from './org.schemas';
import { OrgService } from './org.service';

/**
 * Organization levels and units (CD-226; departments and teams before, CD-138, CD-139) and
 * reporting lines. Reading is for every member; every change is for Admins (the service checks,
 * 403 otherwise). See docs/ARCHITECTURE.md, "Levels, units and reporting lines".
 */
@Controller('people')
@RequireTenant('member')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  /** The levels top-down: `{ id, name, position, version, units }[]` (Department and Team until changed). */
  @Get('org-levels')
  levels(@Tenant() ctx: TenantContext) {
    return this.org.levels(ctx);
  }

  /** A new level (at most five); returns every level. */
  @Post('org-levels')
  createLevel(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateLevel)) body: CreateLevel) {
    return this.org.createLevel(ctx, body);
  }

  /** `{ ids }` top-down; 409 when a unit would be inside a unit of a lower level. Returns every level. */
  @Put('org-levels/order')
  reorderLevels(@Tenant() ctx: TenantContext, @Body(new ZodPipe(ReorderLevels)) body: ReorderLevels) {
    return this.org.reorderLevels(ctx, body);
  }

  /** Rename; returns every level. */
  @Patch('org-levels/:id')
  renameLevel(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(UpdateLevel)) body: UpdateLevel) {
    return this.org.renameLevel(ctx, id, body);
  }

  /** 409 while it has units, or when it is the last one. Returns every level. */
  @Delete('org-levels/:id')
  deleteLevel(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.org.deleteLevel(ctx, id);
  }

  /** Every unit by name: `{ id, levelId, parentId, name, code, leadEmployeeId, leadName, version, members, units }[]`. */
  @Get('org-units')
  units(@Tenant() ctx: TenantContext) {
    return this.org.units(ctx);
  }

  /** `{ unit, managersChanged, loops }`. */
  @Post('org-units')
  createUnit(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateUnit)) body: CreateUnit) {
    return this.org.createUnit(ctx, body);
  }

  /** Rename, code, move (`parentId`), lead: `{ unit, managersChanged, loops }`. */
  @Patch('org-units/:id')
  updateUnit(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(UpdateUnit)) body: UpdateUnit) {
    return this.org.updateUnit(ctx, id, body);
  }

  /** 409 while it has units inside or another module uses it; its members end up without a unit. */
  @Delete('org-units/:id')
  @HttpCode(204)
  deleteUnit(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.org.deleteUnit(ctx, id);
  }

  /** For the delete confirmation: `{ id, name, units, usedBy, members }`. */
  @Get('org-units/:id/usage')
  unitUsage(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.org.unitUsage(ctx, id);
  }

  /** What a new lead changes: `{ managerId, managerName, members, loops, leavesUnit }`, nothing saved. */
  @Get('org-units/:id/lead-preview')
  leadPreview(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Query(new ZodPipe(LeadPreviewQuery)) query: LeadPreviewQuery) {
    return this.org.leadPreview(ctx, id, query.leadEmployeeId);
  }

  /** "Add people": `{ updated, managersChanged }`. */
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
