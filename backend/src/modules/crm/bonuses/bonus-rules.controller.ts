import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Put } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { BonusRulesService, PutBonusRule, UpdateBonusSettings } from './bonus-rules.service';

/** Sales bonus rules (CD-17): owners and admins only, reading included. Members get 403. */
@Controller('crm/bonus-rules')
@RequireTenant('admin')
export class BonusRulesController {
  constructor(private readonly bonuses: BonusRulesService) {}

  @Get()
  get(@Tenant() ctx: TenantContext) {
    return this.bonuses.get(ctx);
  }

  @Patch()
  updateSettings(@Tenant() ctx: TenantContext, @Body(new ZodPipe(UpdateBonusSettings)) body: UpdateBonusSettings) {
    return this.bonuses.updateSettings(ctx, body);
  }

  @Put(':userId')
  putRule(@Tenant() ctx: TenantContext, @Param('userId', new ZodPipe(UuidParam)) userId: string, @Body(new ZodPipe(PutBonusRule)) body: PutBonusRule) {
    return this.bonuses.putRule(ctx, userId, body);
  }

  @Delete(':userId')
  @HttpCode(204)
  removeRule(@Tenant() ctx: TenantContext, @Param('userId', new ZodPipe(UuidParam)) userId: string) {
    return this.bonuses.removeRule(ctx, userId);
  }
}
