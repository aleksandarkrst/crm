import { Body, Controller, Delete, Get, Patch, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { type AuthUser, CurrentUser, RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { UpdateProfile, UpdateWorkspace } from './settings.schemas';
import { SettingsService } from './settings.service';
import { MAX_LOGO_BYTES, type UploadedLogo } from './workspace-logo';

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

  /** The workspace logo (CD-378) as an image; every member can see it. 404 without one. */
  @Get('workspace/logo')
  @RequireTenant('member')
  async getLogo(@Tenant() ctx: TenantContext, @Res({ passthrough: true }) res: Response) {
    const logo = await this.settings.getLogo(ctx);
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(logo.content);
  }

  /**
   * multipart/form-data `file`: a PNG or JPG of at most 1 MB (400 with the reason otherwise).
   * Multer stops at twice that, so a slightly larger file still gets the clear 400, not a 413.
   */
  @Put('workspace/logo')
  @RequireTenant('admin')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 2 * MAX_LOGO_BYTES, files: 1, fields: 0 } }))
  setLogo(@Tenant() ctx: TenantContext, @UploadedFile() file: UploadedLogo | undefined) {
    return this.settings.setLogo(ctx, file);
  }

  @Delete('workspace/logo')
  @RequireTenant('admin')
  removeLogo(@Tenant() ctx: TenantContext) {
    return this.settings.removeLogo(ctx);
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
}
