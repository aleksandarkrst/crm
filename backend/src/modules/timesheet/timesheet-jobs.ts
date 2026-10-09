import { Body, Controller, HttpCode, Injectable, Logger, Module, type OnApplicationBootstrap, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { tenants } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { PeopleModule, PeopleWorkerModule } from '../people';
import { TimesheetDeadlines } from './deadlines';
import { TimesheetNoticeMailer, TimesheetNotices } from './notices';

/** How often the worker looks at the deadlines. */
export const TIMESHEET_TICK_CRON = '*/15 * * * *';

/**
 * The worker's side of the timesheet: `timesheet.tick` every 15 minutes runs, for every workspace,
 * auto submit at the deadline (CD-153) and then queues the reminders and after-deadline emails
 * (CD-154); `timesheet.notice-email` sends one of them.
 */
@Injectable()
export class TimesheetJobs implements OnApplicationBootstrap {
  private readonly logger = new Logger(TimesheetJobs.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly deadlines: TimesheetDeadlines,
    private readonly notices: TimesheetNotices,
    private readonly mailer: TimesheetNoticeMailer,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('timesheet.tick', () => this.tick());
    await this.jobs.work('timesheet.notice-email', (data) => this.mailer.send(data));
    await this.jobs.schedule('timesheet.tick', TIMESHEET_TICK_CRON);
  }

  async tick(now: Date = new Date()): Promise<void> {
    const workspaces = await this.database.db.select({ id: tenants.id }).from(tenants);
    for (const w of workspaces) {
      const submitted = await this.deadlines.autoSubmitDue(w.id, now);
      if (submitted) this.logger.log(`Auto-submitted ${submitted} timesheet week(s) in workspace ${w.id}`);
      await this.notices.queueDue(w.id, now);
    }
  }
}

@Module({ imports: [PeopleWorkerModule], providers: [TimesheetDeadlines, TimesheetNotices, TimesheetNoticeMailer, TimesheetJobs] })
export class TimesheetWorkerModule {}

const Tick = z.object({ now: z.iso.datetime().optional() });
type Tick = z.infer<typeof Tick>;

/** Development only (AUTH_MODE=dev): the tick for the caller's workspace at `now` (tests): auto submit, then the emails. */
@Controller('dev/timesheet')
export class DevTimesheetController {
  constructor(
    private readonly deadlines: TimesheetDeadlines,
    private readonly notices: TimesheetNotices,
  ) {}

  @Post('deadline-tick')
  @RequireTenant('member')
  @HttpCode(200)
  async tick(@Tenant() ctx: TenantContext, @Body(new ZodPipe(Tick)) body: Tick) {
    const now = body.now ? new Date(body.now) : new Date();
    const submitted = await this.deadlines.autoSubmitDue(ctx.tenantId, now);
    return { submitted, emails: await this.notices.queueDue(ctx.tenantId, now) };
  }
}

@Module({ imports: [PeopleModule], controllers: [DevTimesheetController], providers: [TimesheetDeadlines, TimesheetNotices] })
export class TimesheetDevModule {}
