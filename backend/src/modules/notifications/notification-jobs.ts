import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { companies, dailyDigests, deals, funnelStages, memberships, tenants, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { type JobAttempt, JobsService } from '../../shared/events/jobs.service';
import { dealAssignedEmail, digestEmail, digestItemCount, isDigestHour, isEmptyDigest, zonedNow } from './digest-content';
import { DigestService } from './digest.service';

/** How often the worker looks for workspaces where it is digest time. */
export const DIGEST_TICK_CRON = '*/15 * * * *';

/**
 * Worker side of the notifications module (CD-16):
 * - "notifications.digest-tick" (cron, every 15 minutes, in UTC): for each workspace where it is
 *   between 8:00 and 11:59 local time, queues a digest for every member who has it on and hasn't
 *   had today's yet;
 * - "notifications.daily-digest": builds and sends one member's digest, or records it as skipped
 *   when it would be empty. `daily_digests` makes it once a day per member and workspace;
 * - "crm.deal-assigned": emails the new owner of a deal if someone else assigned it and they
 *   want that email.
 * Failed sends throw, so pg-boss retries them (MAIL_RETRY_LIMIT).
 */
@Injectable()
export class NotificationJobs implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationJobs.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    private readonly digests: DigestService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('notifications.digest-tick', () => this.tick());
    await this.jobs.work('notifications.daily-digest', (data, attempt) => this.sendDigest(data, attempt));
    await this.jobs.work('crm.deal-assigned', (data) => this.sendDealAssigned(data));
    await this.jobs.schedule('notifications.digest-tick', DIGEST_TICK_CRON);
  }

  async tick(now: Date = new Date()): Promise<void> {
    const workspaces = await this.database.db.select({ id: tenants.id, timezone: tenants.timezone }).from(tenants);
    for (const w of workspaces) {
      const local = zonedNow(w.timezone, now);
      if (!isDigestHour(local.hour)) continue;
      const members = await this.database.db
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, w.id), eq(memberships.dailyDigest, true), isNotNull(users.email)));
      if (!members.length) continue;
      const handled = await this.database.withTenant(w.id, (tx) =>
        tx
          .select({ userId: dailyDigests.userId })
          .from(dailyDigests)
          .where(and(eq(dailyDigests.digestDate, local.date), inArray(dailyDigests.userId, members.map((m) => m.userId)))),
      );
      const done = new Set(handled.map((h) => h.userId));
      for (const m of members) {
        if (done.has(m.userId)) continue;
        await this.jobs.send('notifications.daily-digest', { tenantId: w.id, userId: m.userId, date: local.date }, undefined, { singletonKey: `${w.id}:${m.userId}:${local.date}` });
      }
    }
  }

  async sendDigest({ tenantId, userId, date, force }: JobPayloads['notifications.daily-digest'], attempt: JobAttempt): Promise<void> {
    const who = await this.digests.recipient(tenantId, userId);
    if (!who?.email || (!who.dailyDigest && !force)) return;

    // Claim the day: a new row, or a failed one being retried. Sent, skipped or in-flight days are left alone.
    const claimed = await this.database.withTenant(tenantId, (tx) =>
      tx
        .insert(dailyDigests)
        .values({ tenantId, userId, digestDate: date, status: 'sending' })
        .onConflictDoUpdate({
          target: [dailyDigests.tenantId, dailyDigests.userId, dailyDigests.digestDate],
          set: { status: 'sending', error: null },
          setWhere: force ? undefined : sql`${dailyDigests.status} = 'failed'`,
        })
        .returning({ id: dailyDigests.id }),
    );
    if (!claimed.length) return;
    const record = (set: Partial<typeof dailyDigests.$inferInsert>) =>
      this.database.withTenant(tenantId, (tx) => tx.update(dailyDigests).set(set).where(eq(dailyDigests.id, claimed[0]!.id)));

    const digest = await this.digests.load(tenantId, userId, date);
    if (isEmptyDigest(digest)) {
      await record({ status: 'skipped', itemCount: 0 });
      return;
    }
    if (this.mailer.notDelivered) {
      await record({ status: 'failed', error: this.mailer.notDelivered });
      return;
    }
    const message = digestEmail({ to: who.email, memberName: who.name, workspaceName: who.workspaceName, appUrl: this.env.APP_URL, digest });
    try {
      await this.mailer.send(message);
    } catch (err) {
      // "failed" either way: a retry claims it again; after the last attempt it stays failed.
      await record({ status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
      if (attempt.lastAttempt) this.logger.warn(`Daily digest for ${who.email} (${tenantId}, ${date}) failed after retries`);
      throw err;
    }
    await record({ status: 'sent', itemCount: digestItemCount(digest), sentAt: new Date() });
  }

  async sendDealAssigned({ tenantId, dealId, assigneeUserId, actorUserId }: JobPayloads['crm.deal-assigned']): Promise<void> {
    if (assigneeUserId === actorUserId) return;
    const [assignee] = await this.database.db
      .select({ email: users.email, name: users.displayName, wants: memberships.notifyDealAssigned, workspaceName: tenants.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, assigneeUserId)));
    if (!assignee?.email || !assignee.wants) return;
    const [actor] = await this.database.db.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'A teammate')` }).from(users).where(eq(users.id, actorUserId));

    const [deal] = await this.database.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: deals.id,
          title: deals.title,
          ownerUserId: deals.ownerUserId,
          company: companies.name,
          stage: funnelStages.name,
          amount: deals.amount,
          currency: deals.currency,
          closeDate: sql<string | null>`${deals.closeDate}::text`,
        })
        .from(deals)
        .innerJoin(funnelStages, eq(funnelStages.id, deals.stageId))
        .leftJoin(companies, eq(companies.id, deals.companyId))
        .where(eq(deals.id, dealId)),
    );
    // Deleted, or given to someone else again before this ran: nothing to tell.
    if (!deal || deal.ownerUserId !== assigneeUserId) return;
    if (this.mailer.notDelivered) {
      this.logger.warn(`Deal-assigned email for deal ${dealId} not sent: ${this.mailer.notDelivered}`);
      return;
    }

    await this.mailer.send(
      dealAssignedEmail({ to: assignee.email, assigneeName: assignee.name, actorName: actor?.name ?? 'A teammate', workspaceName: assignee.workspaceName, appUrl: this.env.APP_URL, deal }),
    );
  }
}

/** Registered in the worker (WorkerModule). */
@Module({ providers: [DigestService, NotificationJobs] })
export class NotificationsWorkerModule {}
