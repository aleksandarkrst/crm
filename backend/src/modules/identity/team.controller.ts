import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser, RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { RateLimit } from '../../shared/rate-limit';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { CreateInvitation, TeamService, UpdateMember } from './team.service';

const Id = new ZodPipe(UuidParam);
const Token = new ZodPipe(z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, 'Invalid invitation link'));

@Controller()
export class TeamController {
  constructor(private readonly team: TeamService) {}

  /** Members and pending invitations of the current tenant. */
  @Get('team')
  @RequireTenant('member')
  list(@Tenant() ctx: TenantContext) {
    return this.team.list(ctx);
  }

  @Post('team/invitations')
  @RateLimit('email')
  @RequireTenant('admin')
  invite(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateInvitation)) body: CreateInvitation) {
    return this.team.invite(ctx, body);
  }

  /** Emails the invitation again (same link, 7 more days). */
  @Post('team/invitations/:id/resend')
  @RateLimit('email')
  @RequireTenant('admin')
  @HttpCode(200)
  resend(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.team.resend(ctx, id);
  }

  /** The invitation's token, for "Copy link" when the email doesn't arrive. */
  @Get('team/invitations/:id/link')
  @RequireTenant('admin')
  link(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.team.link(ctx, id);
  }

  @Delete('team/invitations/:id')
  @RequireTenant('admin')
  @HttpCode(204)
  revoke(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.team.revoke(ctx, id);
  }

  @Patch('team/members/:userId')
  @RequireTenant('admin')
  updateMember(@Tenant() ctx: TenantContext, @Param('userId', Id) userId: string, @Body(new ZodPipe(UpdateMember)) body: UpdateMember) {
    return this.team.updateMember(ctx, userId, body);
  }

  /** Admins remove members; members may remove themselves (leave the workspace). */
  @Delete('team/members/:userId')
  @RequireTenant('member')
  @HttpCode(204)
  removeMember(@Tenant() ctx: TenantContext, @Param('userId', Id) userId: string) {
    return this.team.removeMember(ctx, userId);
  }

  // ------------------------------------------------------------ invitee side (no tenant yet)
  @Get('invitations/:token')
  @RateLimit('signIn')
  preview(@Param('token', Token) token: string) {
    return this.team.preview(token);
  }

  @Post('invitations/:token/accept')
  @RateLimit('signIn')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('token', Token) token: string) {
    return this.team.accept(user, token);
  }
}
