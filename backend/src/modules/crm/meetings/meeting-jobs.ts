import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../../infrastructure/config/config.module';
import { type MailAttachment, Mailer } from '../../../infrastructure/mail/mailer';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { DatabaseService } from '../../../shared/database/database.service';
import { companies, deals, meetingMinutesRecipients, meetingMinutesSends, meetingParticipants, meetingReminders, meetings, memberships, tenants, users } from '../../../shared/database/schema';
import type { JobPayloads } from '../../../shared/events/job-types';
import { type JobAttempt, JobsService } from '../../../shared/events/jobs.service';
import { userNameOf } from '../owner';
import { ProjectLinkJobs } from '../deals/project-link-jobs';
import { CompanyStatusJobs } from '../companies/company-status-jobs';
import { CompanyStatusService } from '../companies/company-status.service';
import { meetingInviteEmail } from './meeting-invite';
import { MeetingReminderTick } from './meeting-reminder-tick';
import { meetingReminderEmail, reminderOf } from './meeting-reminders';
import { minutesEmail, minutesMailMessage } from './minutes-email';

/** How often the worker looks for meeting reminders that are due (CD-376). */
export const MEETING_REMINDERS_CRON = '* * * * *';

/**
 * Worker side of meeting participants (CD-131):
 * - "crm.meeting-invite": emails a member that they were added to a meeting, or that it changed
 *   or was cancelled, with an .ics. Everything is read again now: the meeting as it is (an
 *   invitation to a meeting cancelled since isn't sent, nor a cancellation of one restored since),
 *   whether they still take part and are still a member, and their "Meeting invitations" toggle.
 *   A failed send throws, so pg-boss retries it (MAIL_JOBS).
 * - "identity.member-removed": a member left or was removed. They come off the future planned
 *   meetings; where they organized one, it has no organizer ("Organizer left") until an admin
 *   picks one. Past and held meetings keep them, shown as a former member.
 * - "people.employee-deactivated": an employee left the company and lost their membership (spec
 *   4.8); the same as "identity.member-removed" for their account.
 * - "crm.meeting-reminders-tick" (every minute) and "crm.meeting-reminder": the people's own
 *   reminders (CD-376), see MeetingReminderTick and sendReminder.
 */
@Injectable()
export class MeetingJobs implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeetingJobs.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    private readonly storage: StorageService,
    private readonly reminders: MeetingReminderTick,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The send's stored PDF; a read failure gets a fixed message (the raw one names the storage path). */
  private async pdfOf(tenantId: string, key: string): Promise<Buffer> {
    try {
      return await this.storage.getBuffer(tenantId, key);
    } catch (err) {
      this.logger.error(`Minutes PDF ${key} could not be read: ${err instanceof Error ? err.message : String(err)}`);
      throw new Error('The minutes PDF could not be read.', { cause: err });
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('crm.meeting-invite', (data) => this.sendInvites(data));
    await this.jobs.work('identity.member-removed', (data) => this.memberRemoved(data));
    // An employee who left the company (milestone 13, spec 4.8) is handled like a member who left.
    await this.jobs.work('people.employee-deactivated', async ({ tenantId, userId }) => {
      if (userId) await this.memberRemoved({ tenantId, userId });
    });
    await this.jobs.work('crm.meeting-minutes-email', (data, attempt) => this.sendMinutes(data, attempt));
    await this.jobs.work('crm.meeting-reminders-tick', () => this.remindersTick());
    await this.jobs.work('crm.meeting-reminder', (data) => this.sendReminder(data));
    await this.jobs.schedule('crm.meeting-reminders-tick', MEETING_REMINDERS_CRON);
  }

  async remindersTick(now: Date = new Date()): Promise<void> {
    const workspaces = await this.database.db.select({ id: tenants.id }).from(tenants);
    for (const w of workspaces) await this.reminders.queueDue(w.id, now);
  }

  /**
   * "crm.meeting-reminder": the email to the reminder's owner only. Skipped when the reminder is
   * gone, the meeting moved or isn't planned any more, or its owner left it or the workspace.
   */
  async sendReminder({ tenantId, reminderId, startsAt }: JobPayloads['crm.meeting-reminder']): Promise<void> {
    const found = await this.database.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ reminder: meetingReminders, meeting: meetings, companyName: companies.name })
        .from(meetingReminders)
        .innerJoin(meetings, eq(meetings.id, meetingReminders.meetingId))
        .innerJoin(companies, eq(companies.id, meetings.companyId))
        .where(eq(meetingReminders.id, reminderId));
      if (!row) return null;
      const [onIt] = await tx
        .select({ id: meetingParticipants.id })
        .from(meetingParticipants)
        .where(and(eq(meetingParticipants.meetingId, row.meeting.id), eq(meetingParticipants.kind, 'internal'), eq(meetingParticipants.userId, row.reminder.userId)));
      return onIt ? row : null;
    });
    if (!found || found.meeting.status !== 'planned' || found.meeting.startsAt.getTime() !== new Date(startsAt).getTime()) return;
    const [recipient] = await this.database.db
      .select({ email: users.email, name: users.displayName, workspaceName: tenants.name, timeZone: tenants.timezone })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, found.reminder.userId)));
    if (!recipient?.email) return;
    if (this.mailer.notDelivered) {
      this.logger.warn(`Meeting reminder ${reminderId} not sent: ${this.mailer.notDelivered}`);
      return;
    }
    const m = found.meeting;
    await this.mailer.send(
      meetingReminderEmail({
        to: recipient.email,
        recipientName: recipient.name,
        workspaceName: recipient.workspaceName,
        timeZone: recipient.timeZone,
        appUrl: this.env.APP_URL,
        reminder: reminderOf(found.reminder.minutesBefore, found.reminder.unit),
        meeting: { id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, location: m.location, agenda: m.agenda, companyName: found.companyName },
      }),
    );
  }

  /**
   * "crm.meeting-minutes-email" (CD-133): one email with the send's exact text to its recipients
   * still queued (contacts in To, members in Cc; on a retry only the ones that failed), from the
   * sender's name at the platform's address, replies to the sender. Each recipient becomes sent,
   * or failed with the reason: an address the server refused fails alone. The send's PDF (CD-378) goes with it,
   * the same file on every attempt and retry; a PDF that can't be read fails the attempt rather than
   * going out without it; a send that fails as a
   * whole keeps them queued while pg-boss retries it (MAIL_JOBS) and fails them on the last attempt.
   */
  async sendMinutes({ tenantId, sendId }: JobPayloads['crm.meeting-minutes-email'], attempt: Pick<JobAttempt, 'lastAttempt'> = { lastAttempt: true }): Promise<void> {
    const found = await this.database.withTenant(tenantId, async (tx) => {
      const [send] = await tx.select().from(meetingMinutesSends).where(eq(meetingMinutesSends.id, sendId));
      if (!send) return null;
      const queued = await tx
        .select()
        .from(meetingMinutesRecipients)
        .where(and(eq(meetingMinutesRecipients.sendId, sendId), eq(meetingMinutesRecipients.status, 'queued')))
        .orderBy(asc(meetingMinutesRecipients.createdAt), asc(meetingMinutesRecipients.name));
      return { send, queued };
    });
    if (!found?.queued.length) return;
    const { send, queued } = found;
    const settle = (ids: string[], set: { status: 'sent' | 'failed'; error: string | null; sentAt?: Date }) =>
      ids.length
        ? this.database.withTenant(tenantId, (tx) =>
            tx
              .update(meetingMinutesRecipients)
              .set({ ...set, updatedAt: new Date() })
              .where(and(inArray(meetingMinutesRecipients.id, ids), eq(meetingMinutesRecipients.status, 'queued'))),
          )
        : Promise.resolve();
    const all = queued.map((r) => r.id);
    if (this.mailer.notDelivered) {
      await settle(all, { status: 'failed', error: this.mailer.notDelivered });
      return;
    }

    // tenants is a platform table without RLS: read by id.
    const [workspace] = await this.database.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    const sender = { name: send.senderName, email: send.senderEmail };
    const people = (kind: 'to' | 'cc') => queued.filter((r) => r.kind === kind).map((r) => ({ name: r.name, email: r.email }));
    const email = minutesEmail({
      language: send.language,
      subject: send.subject,
      body: send.body,
      workspaceName: workspace?.name ?? 'Pultly',
      sender,
      mailFrom: this.env.MAIL_FROM,
      to: people('to'),
      cc: people('cc'),
    });
    let rejected: Set<string>;
    try {
      const attachments: MailAttachment[] = send.pdfStorageKey
        ? [{ filename: send.pdfFileName ?? 'Minutes.pdf', contentType: 'application/pdf', content: (await this.pdfOf(tenantId, send.pdfStorageKey)).toString('base64'), encoding: 'base64' }]
        : [];
      const result = await this.mailer.send({ ...minutesMailMessage(email, sender), ...(attachments.length ? { attachments } : {}) });
      rejected = new Set(result.rejected.map((a) => a.trim().toLowerCase()));
    } catch (err) {
      if (attempt.lastAttempt) await settle(all, { status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
      throw err;
    }
    const refused = queued.filter((r) => rejected.has(r.email.trim().toLowerCase())).map((r) => r.id);
    await settle(refused, { status: 'failed', error: 'The mail server refused this address.' });
    await settle(
      all.filter((id) => !refused.includes(id)),
      { status: 'sent', error: null, sentAt: new Date() },
    );
  }

  async sendInvites({ tenantId, meetingId, userIds, actorUserId, kind }: JobPayloads['crm.meeting-invite']): Promise<void> {
    const wanted = userIds.filter((id) => id !== actorUserId);
    if (!wanted.length) return;
    const found = await this.database.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ meeting: meetings, companyName: companies.name, dealTitle: deals.title, organizerName: userNameOf(meetings.organizerUserId) })
        .from(meetings)
        .innerJoin(companies, eq(companies.id, meetings.companyId))
        .leftJoin(deals, eq(deals.id, meetings.dealId))
        .where(eq(meetings.id, meetingId));
      if (!row) return null;
      const people = await tx
        .select({ userId: meetingParticipants.userId })
        .from(meetingParticipants)
        .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.kind, 'internal'), inArray(meetingParticipants.userId, wanted)));
      return { ...row, participants: new Set(people.map((p) => p.userId)) };
    });
    // Deleted, or its status changed since: the newer change sends its own email, if any.
    if (!found) return;
    const status = found.meeting.status;
    if (kind === 'cancelled' ? status !== 'cancelled' : status !== 'planned') return;

    const recipients = await this.database.db
      .select({ userId: users.id, email: users.email, name: users.displayName, wants: memberships.notifyMeetingInvites, workspaceName: tenants.name, timeZone: tenants.timezone })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, wanted)));
    // The organizer gets no invitation (CD-376, as in Google Calendar): the meeting is theirs, and
    // their own reminders tell them about it.
    const due = recipients.filter((r) => r.email && r.wants && found.participants.has(r.userId) && r.userId !== found.meeting.organizerUserId);
    if (!due.length) return;
    if (this.mailer.notDelivered) {
      this.logger.warn(`Meeting email (${kind}) for meeting ${meetingId} not sent: ${this.mailer.notDelivered}`);
      return;
    }
    const [actor] = await this.database.db.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'A teammate')` }).from(users).where(eq(users.id, actorUserId));

    const m = found.meeting;
    for (const r of due) {
      await this.mailer.send(
        meetingInviteEmail({
          kind,
          to: r.email!,
          recipientName: r.name,
          actorName: actor?.name ?? 'A teammate',
          workspaceName: r.workspaceName,
          timeZone: r.timeZone,
          appUrl: this.env.APP_URL,
          mailFrom: this.env.MAIL_FROM,
          meeting: {
            id: m.id,
            title: m.title,
            startsAt: m.startsAt,
            endsAt: m.endsAt,
            location: m.location,
            companyName: found.companyName,
            dealTitle: m.dealId ? found.dealTitle : null,
            organizerName: m.organizerUserId ? found.organizerName : null,
            icsSequence: m.icsSequence,
          },
        }),
      );
    }
  }

  async memberRemoved({ tenantId, userId }: JobPayloads['identity.member-removed'], now: Date = new Date()): Promise<void> {
    // Back in the workspace before this ran: nothing to do.
    const [member] = await this.database.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    if (member) return;
    await this.database.withTenant(tenantId, async (tx) => {
      const upcoming = tx
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(eq(meetings.status, 'planned'), gt(meetings.startsAt, now)));
      await tx.delete(meetingParticipants).where(and(eq(meetingParticipants.userId, userId), inArray(meetingParticipants.meetingId, upcoming)));
      await tx.delete(meetingReminders).where(and(eq(meetingReminders.userId, userId), inArray(meetingReminders.meetingId, upcoming)));
      // A meeting saved without a deal before CD-213 can't change (meetings_deal_required), so it
      // keeps the former member as its organizer rather than failing this job.
      await tx
        .update(meetings)
        .set({ organizerUserId: null })
        .where(and(eq(meetings.organizerUserId, userId), eq(meetings.status, 'planned'), gt(meetings.startsAt, now), isNotNull(meetings.dealId)));
    });
  }
}

/** Registered in the worker (WorkerModule). */
@Module({ providers: [MeetingJobs, MeetingReminderTick, ProjectLinkJobs, CompanyStatusService, CompanyStatusJobs] })
export class CrmWorkerModule {}
