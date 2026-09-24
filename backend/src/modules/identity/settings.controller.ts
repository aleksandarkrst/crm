import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { type AuthUser, CurrentUser, RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { UpdateProfile, UpdateWorkspace } from './settings.schemas';
import { SettingsService } from './settings.service';

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Settings of the current workspace (X-Tenant-Id). Every member can read them. */
  @Get('workspace')
  @RequireTenant('member')
  getWorkspace(@Tenant() ctx: TenantContext) {
    return this.settings.getWorkspace(ctx);
  }

  @Patch('workspace')
  @RequireTenant('admin')
  updateWorkspace(@Tenant() ctx: TenantContext, @Body(new ZodPipe(UpdateWorkspace)) body: UpdateWorkspace) {
    return this.settings.updateWorkspace(ctx, body);
  }

  /** The signed-in user's own profile, with their settings for the current workspace. */
  @Get('profile')
  @RequireTenant('member')
  getProfile(@Tenant() ctx: TenantContext) {
    return this.settings.getProfile(ctx);
  }

  @Patch('profile')
  @RequireTenant('member')
  updateProfile(@Tenant() ctx: TenantContext, @CurrentUser() user: AuthUser, @Body(new ZodPipe(UpdateProfile)) body: UpdateProfile) {
    return this.settings.updateProfile(ctx, user, body);
  }

  @Post('onboarding/dismiss')
  @RequireTenant('admin')
  dismissOnboarding(@Tenant() ctx: TenantContext) {
    return this.settings.dismissOnboarding(ctx);
  }
}
