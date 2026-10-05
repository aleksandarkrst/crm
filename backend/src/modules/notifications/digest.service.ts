import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../../shared/database/database.service';
import { companies, deals, dealTasks, funnelStages, meetingMinutes, meetingParticipants, meetings, memberships, tenants, users } from '../../shared/database/schema';
import { buildDigest, type Digest, MINUTES_REMINDER_MS, NOT_CLOSED_AFTER_MS, zonedNow } from './digest-content';

/**
 * Loads a member's daily digest from the CRM tables (read only), inside withTenant so RLS applies:
 * - tasks assigned to them, not done, due today or earlier (the "New task" tasks; playbook to-dos
 *   have no due date), on deals that aren't lost;
 * - their open deals (not won, not lost) without an open task or a planned meeting still ahead:
 *   the "No next step" flag;
 * - meetings (CD-130) starting today that they organize or take part in (planned or held), and
 *   the planned meetings they organize that ended more than 24 hours ago ("Not closed"), and the
 *   held ones they organize that started in the last 7 days without a summary ("Minutes missing", CD-132).
 * "Today" is the workspace's date (its time zone), as on the Today screen.
 */
@Injectable()
export class DigestService {
  constructor(private readonly database: DatabaseService) {}

  /** The workspace's name and time zone, and the member's email and name (null if not a member). */
  async recipient(tenantId: string, userId: string) {
    const [row] = await this.database.db
      .select({
        email: users.email,
        name: users.displayName,
        dailyDigest: memberships.dailyDigest,
        workspaceName: tenants.name,
        timezone: tenants.timezone,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    return row ?? null;
  }

  /** Today's digest for a member, in the workspace time zone (the preview endpoint). */
  async today(tenantId: string, userId: string): Promise<Digest> {
    const who = await this.recipient(tenantId, userId);
    if (!who) throw new NotFoundException('Not a member of this workspace');
    return this.load(tenantId, userId, zonedNow(who.timezone).date);
  }

  load(tenantId: string, userId: string, today: string, now: Date = new Date()): Promise<Digest> {
    return this.database.withTenant(tenantId, async (tx) => {
      // tenants is a platform table without RLS, so filter by the tenant explicitly.
      const [workspace] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
      const timeZone = workspace?.timezone ?? 'UTC';
      const tasks = await tx
        .select({
          id: dealTasks.id,
          title: dealTasks.label,
          dueDate: sql<string>`${dealTasks.dueDate}::text`,
          dealId: deals.id,
          dealTitle: deals.title,
          company: companies.name,
        })
        .from(dealTasks)
        .innerJoin(deals, eq(deals.id, dealTasks.dealId))
        .leftJoin(companies, eq(companies.id, deals.companyId))
        .where(and(eq(dealTasks.assigneeUserId, userId), eq(dealTasks.done, false), isNotNull(dealTasks.dueDate), lte(dealTasks.dueDate, today), isNull(deals.lostAt)))
        .orderBy(asc(dealTasks.dueDate));

      // A next step is an open task from the "New task" dialog (not a stage to-do), as on the Pipeline card.
      const withNextStep = tx
        .select({ dealId: dealTasks.dealId })
        .from(dealTasks)
        .where(and(eq(dealTasks.blocksAdvance, false), eq(dealTasks.done, false)));
      // So is a planned meeting still ahead (CD-130).
      const withMeetingAhead = tx
        .select({ dealId: meetings.dealId })
        .from(meetings)
        .where(and(isNotNull(meetings.dealId), eq(meetings.status, 'planned'), gt(meetings.startsAt, now)));
      const stalled = await tx
        .select({ id: deals.id, title: deals.title, company: companies.name, stage: funnelStages.name })
        .from(deals)
        .innerJoin(funnelStages, eq(funnelStages.id, deals.stageId))
        .leftJoin(companies, eq(companies.id, deals.companyId))
        .where(
          and(eq(deals.ownerUserId, userId), isNull(deals.lostAt), eq(funnelStages.isWon, false), notInArray(deals.id, withNextStep), notInArray(deals.id, withMeetingAhead)),
        );

      const meetingRow = {
        id: meetings.id,
        title: meetings.title,
        startsAt: meetings.startsAt,
        endsAt: meetings.endsAt,
        company: companies.name,
        status: meetings.status,
      };
      const takesPart = or(
        eq(meetings.organizerUserId, userId),
        sql`exists (select 1 from ${meetingParticipants} p where p.meeting_id = ${meetings.id} and p.user_id = ${userId})`,
      );
      const meetingsToday = await tx
        .select(meetingRow)
        .from(meetings)
        .innerJoin(companies, eq(companies.id, meetings.companyId))
        .where(and(takesPart, inArray(meetings.status, ['planned', 'held']), sql`(${meetings.startsAt} at time zone ${timeZone}::text)::date = ${today}::date`))
        .orderBy(asc(meetings.startsAt));
      const notClosed = await tx
        .select(meetingRow)
        .from(meetings)
        .innerJoin(companies, eq(companies.id, meetings.companyId))
        .where(and(eq(meetings.organizerUserId, userId), eq(meetings.status, 'planned'), lt(meetings.endsAt, new Date(now.getTime() - NOT_CLOSED_AFTER_MS))))
        .orderBy(asc(meetings.startsAt))
        .limit(100);
      const minutesMissing = await tx
        .select(meetingRow)
        .from(meetings)
        .innerJoin(companies, eq(companies.id, meetings.companyId))
        .where(
          and(
            eq(meetings.organizerUserId, userId),
            eq(meetings.status, 'held'),
            gte(meetings.startsAt, new Date(now.getTime() - MINUTES_REMINDER_MS)),
            lte(meetings.startsAt, now),
            sql`not exists (select 1 from ${meetingMinutes} mm where mm.meeting_id = ${meetings.id} and btrim(coalesce(mm.summary, '')) <> '')`,
          ),
        )
        .orderBy(asc(meetings.startsAt))
        .limit(100);

      const iso = (rows: typeof meetingsToday) => rows.map((m) => ({ ...m, startsAt: m.startsAt.toISOString(), endsAt: m.endsAt.toISOString() }));
      return buildDigest(today, tasks, stalled, { today: iso(meetingsToday), notClosed: iso(notClosed), minutesMissing: iso(minutesMissing), timeZone, now });
    });
  }
}
