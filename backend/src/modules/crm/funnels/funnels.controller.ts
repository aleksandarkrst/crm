import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { CreateFunnel, CreateStage, DeleteStageQuery, FunnelsService, ReorderStages, UpdateFunnel, UpdateStage } from './funnels.service';

const Id = new ZodPipe(UuidParam);

/**
 * Funnels and their stages. Everyone reads them; editing the playbook (funnels, stages, to-dos)
 * is for owners and admins ("Edit funnels and stages" permission).
 */
@Controller('crm/funnels')
@RequireTenant('member')
export class FunnelsController {
  constructor(private readonly funnels: FunnelsService) {}

  @Get()
  list(@Tenant() ctx: TenantContext) {
    return this.funnels.list(ctx);
  }

  /** New funnel: `copyFromFunnelId` copies that funnel's stages, otherwise a small default set. */
  @Post()
  @RequireTenant('admin')
  createFunnel(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateFunnel)) body: CreateFunnel) {
    return this.funnels.createFunnel(ctx, body);
  }

  @Patch(':funnelId')
  @RequireTenant('admin')
  updateFunnel(@Tenant() ctx: TenantContext, @Param('funnelId', Id) funnelId: string, @Body(new ZodPipe(UpdateFunnel)) body: UpdateFunnel) {
    return this.funnels.updateFunnel(ctx, funnelId, body);
  }

  /** Only a funnel that never had deals (409 otherwise), and never the last one. */
  @Delete(':funnelId')
  @RequireTenant('admin')
  @HttpCode(204)
  deleteFunnel(@Tenant() ctx: TenantContext, @Param('funnelId', Id) funnelId: string) {
    return this.funnels.deleteFunnel(ctx, funnelId);
  }

  @Post(':funnelId/stages')
  @RequireTenant('admin')
  createStage(@Tenant() ctx: TenantContext, @Param('funnelId', Id) funnelId: string, @Body(new ZodPipe(CreateStage)) body: CreateStage) {
    return this.funnels.createStage(ctx, funnelId, body);
  }

  /** Declared before ':stageId' routes; lists every stage id in the new order. */
  @Put(':funnelId/stages/order')
  @RequireTenant('admin')
  reorderStages(@Tenant() ctx: TenantContext, @Param('funnelId', Id) funnelId: string, @Body(new ZodPipe(ReorderStages)) body: ReorderStages) {
    return this.funnels.reorderStages(ctx, funnelId, body);
  }

  @Patch(':funnelId/stages/:stageId')
  @RequireTenant('admin')
  updateStage(
    @Tenant() ctx: TenantContext,
    @Param('funnelId', Id) funnelId: string,
    @Param('stageId', Id) stageId: string,
    @Body(new ZodPipe(UpdateStage)) body: UpdateStage,
  ) {
    return this.funnels.updateStage(ctx, funnelId, stageId, body);
  }

  /** Deals in the stage move to `?moveDealsTo=<stageId>` (required when there are any). Returns the funnel. */
  @Delete(':funnelId/stages/:stageId')
  @RequireTenant('admin')
  deleteStage(
    @Tenant() ctx: TenantContext,
    @Param('funnelId', Id) funnelId: string,
    @Param('stageId', Id) stageId: string,
    @Query(new ZodPipe(DeleteStageQuery)) query: DeleteStageQuery,
  ) {
    return this.funnels.deleteStage(ctx, funnelId, stageId, query);
  }
}
