import { Body, Controller, HttpCode, Injectable, Logger, Module, type OnApplicationBootstrap, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { tenants } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { PeopleModule, PeopleWorkerModule } from '../people';
import { EntitlementsService } from './entitlements.service';

/** Daily at 02:30 UTC: after midnight everywhere the app is used, before the working day. */
export const TIMEOFF_DAILY_CRON = '30 2 * * *';

/**
 * The worker's side of time off (milestone 16): `timeoff.daily` keeps every active employee's
 * vacation entitlement rows up to date in every workspace (this year, and next year from 1 October;
 * spec 5.4). Later issues add the open sick leave extension, reminders and the July 1 expiry.
 */
@Injectable()
export class TimeoffJobs implements OnApplicationBootstrap {
  private readonly logger = new Logger(TimeoffJobs.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('timeoff.daily', (data) => this.daily(data.now ? new Date(data.now) : new Date(), data.tenantId));
    await this.jobs.schedule('timeoff.daily', TIMEOFF_DAILY_CRON);
  }

  async daily(now: Date, onlyTenantId?: string): Promise<void> {
    const workspaces = onlyTenantId ? [{ id: onlyTenantId }] : await this.database.db.select({ id: tenants.id }).from(tenants);
    for (const w of workspaces) {
      const changed = await this.entitlements.ensureWorkspace(w.id, now);
      if (changed) this.logger.log(`Updated ${changed} vacation entitlement(s) in workspace ${w.id}`);
    }
  }
}

@Module({ imports: [PeopleWorkerModule], providers: [EntitlementsService, TimeoffJobs] })
export class TimeoffWorkerModule {}

const Daily = z.object({ now: z.iso.datetime().optional() });
type Daily = z.infer<typeof Daily>;

/** Development only (AUTH_MODE=dev): the daily job for the caller's workspace at `now` (tests). */
@Controller('dev/timeoff')
export class DevTimeoffController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Post('daily')
  @RequireTenant('member')
  @HttpCode(200)
  async daily(@Tenant() ctx: TenantContext, @Body(new ZodPipe(Daily)) body: Daily) {
    return { changed: await this.entitlements.ensureWorkspace(ctx.tenantId, body.now ? new Date(body.now) : new Date()) };
  }
}

@Module({ imports: [PeopleModule], controllers: [DevTimeoffController], providers: [EntitlementsService] })
export class TimeoffDevModule {}
