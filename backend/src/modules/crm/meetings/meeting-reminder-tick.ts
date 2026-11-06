import { Body, Controller, HttpCode, Injectable, Module, Post } from '@nestjs/common';
import { and, eq, gt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { DatabaseService } from '../../../shared/database/database.service';
import { meetingParticipants, meetingReminders, meetings, memberships } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';

/** A reminder "at the start" still goes out this long after it. */
const START_GRACE_MS = 2 * 60_000;

/**
 * The meeting reminders that are due (CD-376), for the worker's "crm.meeting-reminders-tick"
 * (every minute, MeetingJobs) and the dev trigger below.
 */
@Injectable()
export class MeetingReminderTick {
  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Claims the workspace's reminders due at `now` and queues their emails ("crm.meeting-reminder")
   * in one transaction, so each goes out once per start: a planned meeting starting now or later
   * (a short grace for "at the start"), whose time for the reminder has come, and not yet sent for
   * this start; its owner still on the meeting and in the workspace. Answers how many.
   */
  queueDue(tenantId: string, now: Date = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const claimed = await tx
        .update(meetingReminders)
        .set({ sentFor: sql`${meetings.startsAt}` })
        .from(meetings)
        .where(
          and(
            eq(meetings.tenantId, meetingReminders.tenantId),
            eq(meetings.id, meetingReminders.meetingId),
            eq(meetings.status, 'planned'),
            gt(meetings.startsAt, new Date(now.getTime() - START_GRACE_MS)),
            lte(sql`${meetings.startsAt} - make_interval(mins => ${meetingReminders.minutesBefore})`, now),
            sql`${meetingReminders.sentFor} is distinct from ${meetings.startsAt}`,
            sql`exists (select 1 from ${meetingParticipants} p where p.meeting_id = ${meetings.id} and p.kind = 'internal' and p.user_id = ${meetingReminders.userId})`,
            sql`exists (select 1 from ${memberships} ms where ms.tenant_id = ${meetingReminders.tenantId} and ms.user_id = ${meetingReminders.userId})`,
          ),
        )
        .returning({ id: meetingReminders.id, startsAt: meetings.startsAt });
      for (const r of claimed) {
        const startsAt = r.startsAt.toISOString();
        await this.jobs.send('crm.meeting-reminder', { tenantId, reminderId: r.id, startsAt }, tx, { singletonKey: `${r.id}:${startsAt}` });
      }
      return claimed.length;
    });
  }
}

const Tick = z.object({ now: z.iso.datetime().optional() });
type Tick = z.infer<typeof Tick>;

/** Development only (AUTH_MODE=dev): the reminder tick for the caller's workspace at `now` (tests). */
@Controller('dev/meetings')
export class DevMeetingRemindersController {
  constructor(private readonly tick: MeetingReminderTick) {}

  @Post('reminders-tick')
  @RequireTenant('member')
  @HttpCode(200)
  async run(@Tenant() ctx: TenantContext, @Body(new ZodPipe(Tick)) body: Tick) {
    return { queued: await this.tick.queueDue(ctx.tenantId, body.now ? new Date(body.now) : new Date()) };
  }
}

@Module({ controllers: [DevMeetingRemindersController], providers: [MeetingReminderTick] })
export class MeetingsDevModule {}
