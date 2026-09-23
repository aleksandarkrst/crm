import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { FunnelsService, UpdateStage } from './funnels.service';

@Controller('crm/funnels')
@RequireTenant('member')
export class FunnelsController {
  constructor(private readonly funnels: FunnelsService) {}

  @Get()
  list(@Tenant() ctx: TenantContext) {
    return this.funnels.list(ctx);
  }

  /** Editing the playbook is an admin action ("Edit funnels and stages" permission). */
  @Patch(':funnelId/stages/:stageId')
  @RequireTenant('admin')
  updateStage(
    @Tenant() ctx: TenantContext,
    @Param('funnelId', new ZodPipe(UuidParam)) funnelId: string,
    @Param('stageId', new ZodPipe(UuidParam)) stageId: string,
    @Body(new ZodPipe(UpdateStage)) body: UpdateStage,
  ) {
    return this.funnels.updateStage(ctx, funnelId, stageId, body);
  }
}
