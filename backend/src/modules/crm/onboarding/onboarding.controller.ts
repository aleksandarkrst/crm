import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { RateLimit } from '../../../shared/rate-limit';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { OnboardingService } from './onboarding.service';

const Dismissal = z.object({ dismissed: z.boolean() });

/** Getting started (CD-68): owners and admins only, like the setup it points to. */
@Controller('onboarding')
@RequireTenant('admin')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  /** The checklist's steps (derived from the workspace's records), dismissal and sample data. */
  @Get()
  state(@Tenant() ctx: TenantContext) {
    return this.onboarding.state(ctx);
  }

  /** Hides (or shows again) the checklist for the signed-in user. */
  @Put('dismissed')
  dismiss(@Tenant() ctx: TenantContext, @Body(new ZodPipe(Dismissal)) body: z.infer<typeof Dismissal>) {
    return this.onboarding.dismiss(ctx, body.dismissed);
  }

  @Post('sample-data')
  @RateLimit('heavy')
  @HttpCode(201)
  loadSampleData(@Tenant() ctx: TenantContext) {
    return this.onboarding.loadSampleData(ctx);
  }

  @Delete('sample-data')
  @RateLimit('heavy')
  removeSampleData(@Tenant() ctx: TenantContext) {
    return this.onboarding.removeSampleData(ctx);
  }
}
