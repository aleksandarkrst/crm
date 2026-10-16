import { Body, Controller, HttpCode, Injectable, Logger, Module, type OnApplicationBootstrap, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { tenants } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { PeopleModule, PeopleWorkerModule } from '../people';
import { AbsenceService } from './absence.service';
import { ApprovalsService } from './approvals.service';
import { TimeoffNoticeMailer } from './balance-notices';
import { BalancesService } from './balances.service';
import { EntitlementsService } from './entitlements.service';
import { ReasonsService } from './reasons.service';
import { TimeoffRequestMailer } from './request-notices';
import { RequestsService } from './requests.service';
import { TimeoffModule } from './timeoff.module';

/** Daily at 02:30 UTC: after midnight everywhere the app is used, before the working day. */
export const TIMEOFF_DAILY_CRON = '30 2 * * *';

/**
 * The worker's side of time off (milestone 16): `timeoff.daily` keeps every active employee's
 * vacation entitlement rows up to date in every workspace (this year, and next year from 1 October;
 * spec 5.4), records the carry-over that expired on 1 July and queues the "Carry-over expiring"
 * reminders of 1 May and 1 June (CD-164); `timeoff.notice-email` sends one time off email. Later
 * issues add the open sick leave extension and the approval reminders.
 */
@Injectable()
export class TimeoffJobs implements OnApplicationBootstrap {
  private readonly logger = new Logger(TimeoffJobs.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly entitlements: EntitlementsService,
    private readonly balances: BalancesService,
    private readonly approvals: ApprovalsService,
    private readonly mailer: TimeoffNoticeMailer,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('timeoff.daily', async (data) => {
      await this.daily(data.now ? new Date(data.now) : new Date(), data.tenantId);
    });
    await this.jobs.work('timeoff.notice-email', (data) => this.mailer.send(data));
    await this.jobs.schedule('timeoff.daily', TIMEOFF_DAILY_CRON);
  }

  async daily(now: Date, onlyTenantId?: string): Promise<DailyResult> {
    const workspaces = onlyTenantId ? [{ id: onlyTenantId }] : await this.database.db.select({ id: tenants.id }).from(tenants);
    const total: DailyResult = { changed: 0, expired: 0, reminders: 0, approvals: 0, absent: 0 };
    for (const w of workspaces) {
      const changed = await this.entitlements.ensureWorkspace(w.id, now);
      const expired = await this.balances.recordExpiries(w.id, now);
      const reminders = await this.balances.queueExpiringReminders(w.id, now);
      const approvals = await this.approvals.queueApprovalReminders(w.id, now);
      const absent = await this.approvals.queueManagerAbsentNotices(w.id, now);
      if (changed || expired || reminders || approvals || absent) this.logger.log(`Workspace ${w.id}: ${changed} entitlement(s) updated, ${expired} expiry record(s), ${reminders} carry-over reminder(s), ${approvals} approval reminder(s), ${absent} manager-absent notice(s)`);
      total.changed += changed;
      total.expired += expired;
      total.reminders += reminders;
      total.approvals += approvals;
      total.absent += absent;
    }
    return total;
  }
}

export interface DailyResult {
  changed: number;
  expired: number;
  reminders: number;
  /** "Request waiting" summaries and "Manager absent" notices queued (CD-166). */
  approvals: number;
  absent: number;
}

@Module({ imports: [PeopleWorkerModule], providers: [EntitlementsService, BalancesService, ReasonsService, RequestsService, ApprovalsService, AbsenceService, TimeoffRequestMailer, TimeoffNoticeMailer, TimeoffJobs] })
export class TimeoffWorkerModule {}

const Daily = z.object({ now: z.iso.datetime().optional() });
type Daily = z.infer<typeof Daily>;

/** Development only (AUTH_MODE=dev): the daily job for the caller's workspace at `now` (tests). */
@Controller('dev/timeoff')
export class DevTimeoffController {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly balances: BalancesService,
    private readonly approvals: ApprovalsService,
  ) {}

  @Post('daily')
  @RequireTenant('member')
  @HttpCode(200)
  async daily(@Tenant() ctx: TenantContext, @Body(new ZodPipe(Daily)) body: Daily): Promise<DailyResult> {
    const now = body.now ? new Date(body.now) : new Date();
    const changed = await this.entitlements.ensureWorkspace(ctx.tenantId, now);
    const expired = await this.balances.recordExpiries(ctx.tenantId, now);
    const reminders = await this.balances.queueExpiringReminders(ctx.tenantId, now);
    const approvals = await this.approvals.queueApprovalReminders(ctx.tenantId, now);
    const absent = await this.approvals.queueManagerAbsentNotices(ctx.tenantId, now);
    return { changed, expired, reminders, approvals, absent };
  }
}

// The services come from TimeoffModule (one instance each: a second ReasonsService would provision the defaults twice).
@Module({ imports: [PeopleModule, TimeoffModule], controllers: [DevTimeoffController] })
export class TimeoffDevModule {}
