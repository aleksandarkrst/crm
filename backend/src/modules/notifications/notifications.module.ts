import { Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { JobsService } from '../../shared/events/jobs.service';
import { zonedNow } from './digest-content';
import { DigestService } from './digest.service';

/**
 * Notifications (CD-16). The settings themselves are the caller's membership columns, read and
 * changed through /api/profile (`dailyDigest`, `notifyDealAssigned`). Emails are sent by the
 * worker (notification-jobs.ts).
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly digests: DigestService) {}

  /** What the caller's daily digest for this workspace contains right now (workspace "today"). */
  @Get('digest')
  @RequireTenant('member')
  digest(@Tenant() ctx: TenantContext) {
    return this.digests.today(ctx.tenantId, ctx.userId);
  }
}

/**
 * Development only (registered when AUTH_MODE=dev): sends the caller's digest now, whatever the
 * time and even if today's went out already, so it can be tried and tested without waiting for 8:00.
 */
@Controller('dev/digest')
export class DevDigestController {
  constructor(
    private readonly digests: DigestService,
    private readonly jobs: JobsService,
  ) {}

  @Post()
  @RequireTenant('member')
  @HttpCode(202)
  async sendNow(@Tenant() ctx: TenantContext) {
    const who = await this.digests.recipient(ctx.tenantId, ctx.userId);
    const date = zonedNow(who?.timezone ?? 'UTC').date;
    await this.jobs.send('notifications.daily-digest', { tenantId: ctx.tenantId, userId: ctx.userId, date, force: true });
    return { date };
  }
}

@Module({ controllers: [NotificationsController], providers: [DigestService] })
export class NotificationsModule {}

@Module({ controllers: [DevDigestController], providers: [DigestService] })
export class NotificationsDevModule {}
