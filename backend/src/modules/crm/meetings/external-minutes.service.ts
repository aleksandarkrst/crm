import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ENV, type Env } from '../../../infrastructure/config/config.module';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import {
  contacts,
  type CustomerEmailLanguage,
  type MinutesDeliveryStatus,
  type MinutesRecipientKind,
  meetingMinutes,
  meetingMinutesRecipients,
  meetingMinutesSends,
  meetingParticipants,
  meetings,
  memberships,
  tenants,
  users,
} from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { nonEmptyPatch } from '../../../shared/validation/common';
import { ActivitiesService } from '../deals/activities.service';
import { userNameOf } from '../owner';
import { type ApiMeeting, MeetingsService } from './meetings.service';
import { type MinutesEmail, minutesEmail, minutesTemplate } from './minutes-email';

/** Limits of the external minutes (spec 7.1). */
export const EXTERNAL_BODY_MAX = 10_000;
export const EXTERNAL_SUBJECT_MAX = 300;
/** Recipients of one send, per kind. */
const RECIPIENTS_MAX = 50;

const ids = z
  .array(z.uuid())
  .max(RECIPIENTS_MAX)
  .transform((v) => [...new Set(v)]);

/** A save of the external text: the fields sent replace the stored ones. */
export const SaveExternalMinutes = nonEmptyPatch(
  z.object({
    subject: z.string().max(EXTERNAL_SUBJECT_MAX).optional(),
    body: z.string().max(EXTERNAL_BODY_MAX).optional(),
  }),
);
export type SaveExternalMinutes = z.infer<typeof SaveExternalMinutes>;

/**
 * Preview and send: the text, the contacts it goes to (external participants of the meeting with
 * an email) and the members copied. Strict: there is no field for typed addresses, and an unknown
 * field (`to: ["someone@…"]`) is refused rather than ignored.
 */
export const MinutesEmailRequest = z.strictObject({
  subject: z.string().trim().min(1, 'Write a subject').max(EXTERNAL_SUBJECT_MAX),
  body: z
    .string()
    .max(EXTERNAL_BODY_MAX)
    .refine((v) => v.trim().length > 0, 'Write the minutes before sending them'),
  toContactIds: z.array(z.uuid()).min(1, 'Pick at least one recipient').max(RECIPIENTS_MAX).transform((v) => [...new Set(v)]),
  ccUserIds: ids.default([]),
});
export type MinutesEmailRequest = z.infer<typeof MinutesEmailRequest>;

export interface ApiMinutesRecipient {
  id: string;
  kind: MinutesRecipientKind;
  contactId: string | null;
  userId: string | null;
  name: string;
  email: string;
  status: MinutesDeliveryStatus;
  error: string | null;
  sentAt: Date | null;
}

/** One send of the external minutes: an exact copy of what was sent, and each recipient's delivery. */
export interface ApiMinutesSend {
  id: string;
  meetingId: string;
  senderUserId: string | null;
  senderName: string;
  senderEmail: string;
  subject: string;
  body: string;
  language: CustomerEmailLanguage;
  /** failed when any recipient failed, queued while any is still queued, else sent. */
  status: MinutesDeliveryStatus;
  recipients: ApiMinutesRecipient[];
  createdAt: Date;
}

export interface ApiExternalMinutes {
  subject: string;
  body: string;
  /** The template was filled in (the first time someone opened the tab). */
  prefilled: boolean;
  /** The version (If-Match) of the external text; null before it was written. */
  updatedAt: Date | null;
  updatedByName: string | null;
  /** The language of the email's fixed text (the workspace's customer email language). */
  language: CustomerEmailLanguage;
  lastSend: ApiMinutesSend | null;
  /** The text differs from what was last sent. */
  changedSinceLastSend: boolean;
}

/** The aggregate status of one send's recipients. */
export const deliveryOf = (statuses: readonly MinutesDeliveryStatus[]): MinutesDeliveryStatus =>
  statuses.includes('failed') ? 'failed' : statuses.includes('queued') ? 'queued' : 'sent';

const usableEmail = (email: string | null | undefined): email is string => !!email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
const subjectLine = (subject: string) => subject.replace(/[\r\n]+/g, ' ').trim();

interface Prepared {
  meeting: typeof meetings.$inferSelect;
  email: MinutesEmail;
  to: { contactId: string; name: string; email: string }[];
  cc: { userId: string; name: string; email: string }[];
  sender: { name: string; email: string };
  language: CustomerEmailLanguage;
}

/**
 * The external minutes of a meeting (CD-133): a separate text for the customer, prefilled once
 * from a template, and sent by email to the meeting's external participants who have an email
 * (CC: workspace members). Only a held meeting's minutes are sent; the people who may change the
 * meeting send them and write the text (organizer, internal participants, admins, owners).
 *
 * A send stores an exact copy of the email's text and one row per recipient (queued), writes the
 * deal timeline's "Minutes sent" (and last contact) and queues "crm.meeting-minutes-email", all
 * in one transaction. The worker sends one email to the recipients still queued (contacts in To,
 * members in Cc) and marks each sent or failed; Retry queues the failed ones again.
 *
 * The internal minutes never reach the email: `minutesEmail` only takes the external text and
 * facts about the sender and the workspace. They are read here only for the template and "Copy
 * from internal minutes", which return text for the user to edit.
 */
@Injectable()
export class ExternalMinutesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly meetings: MeetingsService,
    private readonly activities: ActivitiesService,
    private readonly jobs: JobsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The external text. The first time anyone opens it, it is filled from the template (and that is
   * remembered); after that nothing is copied from the internal minutes automatically.
   */
  getExternal(ctx: TenantContext, meetingId: string): Promise<ApiExternalMinutes> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [meeting] = await tx.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, meetingId));
        if (!meeting) throw new NotFoundException('Meeting not found');
        const [existing] = await tx.select({ prefilledAt: meetingMinutes.externalPrefilledAt }).from(meetingMinutes).where(eq(meetingMinutes.meetingId, meetingId));
        if (!existing?.prefilledAt) {
          if (!existing) await tx.insert(meetingMinutes).values({ tenantId: ctx.tenantId, meetingId }).onConflictDoNothing({ target: [meetingMinutes.tenantId, meetingMinutes.meetingId] });
          const row = await this.lockMinutes(tx, meetingId);
          if (row && !row.externalPrefilledAt) {
            const filled = await this.template(tx, ctx, meetingId);
            const now = new Date();
            await tx
              .update(meetingMinutes)
              .set({ externalSubject: filled.subject, externalBody: filled.body, externalPrefilledAt: now, externalUpdatedAt: now })
              .where(eq(meetingMinutes.id, row.id));
          }
        }
        return this.present(tx, ctx, meetingId);
      })
      .catch(mapDbError);
  }

  /**
   * Saves the subject and/or body. With If-Match (the text's `updatedAt`; the epoch before it
   * was written), a change someone else made since then to a part sent here is a 409 conflict.
   */
  saveExternal(ctx: TenantContext, meetingId: string, input: SaveExternalMinutes, version?: Date): Promise<ApiExternalMinutes> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.meetings.lockForChange(tx, ctx, meetingId, 'edit');
        const row = await this.lockMinutes(tx, meetingId);
        const fields = {
          ...(input.subject !== undefined ? { externalSubject: input.subject } : {}),
          ...(input.body !== undefined ? { externalBody: input.body } : {}),
        };
        if (row && version && row.externalUpdatedAt && row.externalUpdatedAt.getTime() > version.getTime() && row.externalUpdatedByUserId !== ctx.userId) {
          const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => (row[k] ?? '') !== fields[k]);
          if (changed.length) await this.conflict(tx, row, changed);
        }
        const now = new Date();
        const set = { ...fields, externalUpdatedAt: now, externalUpdatedByUserId: ctx.userId };
        // Written before anyone opened it: the template no longer applies.
        if (row) await tx.update(meetingMinutes).set({ ...set, externalPrefilledAt: row.externalPrefilledAt ?? now }).where(eq(meetingMinutes.id, row.id));
        else await tx.insert(meetingMinutes).values({ ...set, tenantId: ctx.tenantId, meetingId, externalPrefilledAt: now });
        await this.audit.record(tx, ctx, { action: 'meeting.external_minutes_updated', entityType: 'meeting', entityId: meetingId, data: { fields: Object.keys(input) } });
        return this.present(tx, ctx, meetingId);
      })
      .catch(mapDbError);
  }

  /** "Copy from internal minutes": the template made from the internal minutes as they are now. Nothing is saved. */
  copyInternal(ctx: TenantContext, meetingId: string): Promise<{ subject: string; body: string }> {
    return this.database.withTenant(ctx.tenantId, (tx) => this.template(tx, ctx, meetingId));
  }

  /** The email exactly as Send would send it now (same checks as sending). */
  preview(ctx: TenantContext, meetingId: string, input: MinutesEmailRequest): Promise<MinutesEmail> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => (await this.prepare(tx, ctx, meetingId, input)).email)
      .catch(mapDbError);
  }

  /** Records the send and queues the email; the worker delivers it. */
  send(ctx: TenantContext, meetingId: string, input: MinutesEmailRequest): Promise<ApiMinutesSend> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const p = await this.prepare(tx, ctx, meetingId, input);
        const [send] = await tx
          .insert(meetingMinutesSends)
          .values({
            tenantId: ctx.tenantId,
            meetingId,
            senderUserId: ctx.userId,
            senderName: p.sender.name,
            senderEmail: p.sender.email,
            subject: p.email.subject,
            body: input.body,
            language: p.language,
          })
          .returning({ id: meetingMinutesSends.id });
        const sendId = send!.id;
        await tx.insert(meetingMinutesRecipients).values([
          ...p.to.map((r) => ({ tenantId: ctx.tenantId, sendId, meetingId, kind: 'to' as const, contactId: r.contactId, userId: null, name: r.name, email: r.email })),
          ...p.cc.map((r) => ({ tenantId: ctx.tenantId, sendId, meetingId, kind: 'cc' as const, contactId: null, userId: r.userId, name: r.name, email: r.email })),
        ]);
        if (p.meeting.dealId) {
          const list = (people: { name: string; email: string }[]) => people.map((r) => `${r.name} (${r.email})`).join(', ');
          const detail = [`To: ${list(p.to)}`, p.cc.length ? `Cc: ${list(p.cc)}` : null, `Subject: ${p.email.subject}`].filter(Boolean).join('\n');
          await this.activities.record(tx, ctx, p.meeting.dealId, { channel: 'EM', title: `Minutes sent · ${p.meeting.title}`, detail }, { countsAsContact: true });
        }
        await this.jobs.send('crm.meeting-minutes-email', { tenantId: ctx.tenantId, sendId }, tx);
        await this.audit.record(tx, ctx, { action: 'meeting.minutes_sent', entityType: 'meeting', entityId: meetingId, data: { sendId, to: p.to.length, cc: p.cc.length } });
        return (await this.loadSends(tx, meetingId, sendId))[0]!;
      })
      .catch(mapDbError);
  }

  /** Every send of the meeting, newest first. */
  listSends(ctx: TenantContext, meetingId: string): Promise<ApiMinutesSend[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [meeting] = await tx.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, meetingId));
      if (!meeting) throw new NotFoundException('Meeting not found');
      return this.loadSends(tx, meetingId);
    });
  }

  /** Queues the recipients of a send that failed again (only those). 409 when none failed. */
  retry(ctx: TenantContext, meetingId: string, sendId: string): Promise<ApiMinutesSend> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.meetings.lockForChange(tx, ctx, meetingId, 'edit');
        const [send] = await tx
          .select({ id: meetingMinutesSends.id })
          .from(meetingMinutesSends)
          .where(and(eq(meetingMinutesSends.id, sendId), eq(meetingMinutesSends.meetingId, meetingId)));
        if (!send) throw new NotFoundException('Send not found');
        const again = await tx
          .update(meetingMinutesRecipients)
          .set({ status: 'queued', error: null, updatedAt: new Date() })
          .where(and(eq(meetingMinutesRecipients.sendId, sendId), eq(meetingMinutesRecipients.status, 'failed')))
          .returning({ id: meetingMinutesRecipients.id });
        if (!again.length) throw new ConflictException('Nothing to retry: no recipient of this send failed.');
        await this.jobs.send('crm.meeting-minutes-email', { tenantId: ctx.tenantId, sendId }, tx);
        await this.audit.record(tx, ctx, { action: 'meeting.minutes_retried', entityType: 'meeting', entityId: meetingId, data: { sendId, recipients: again.length } });
        return (await this.loadSends(tx, meetingId, sendId))[0]!;
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Checks a preview or send and builds the email: the meeting is held (409) and the caller may
   * change it (403); every recipient is an external participant of this meeting with an email
   * (400); every CC is a member of the workspace with an email (400).
   */
  private async prepare(tx: Tx, ctx: TenantContext, meetingId: string, input: MinutesEmailRequest): Promise<Prepared> {
    const meeting = await this.meetings.lockForChange(tx, ctx, meetingId, 'edit');
    if (meeting.status !== 'held') throw new ConflictException('Minutes can only be sent for a held meeting. Mark it as held first.');

    const external = await tx
      .select({ contactId: meetingParticipants.contactId, name: contacts.fullName, email: contacts.email })
      .from(meetingParticipants)
      .innerJoin(contacts, eq(contacts.id, meetingParticipants.contactId))
      .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.kind, 'external')));
    const byContact = new Map(external.map((c) => [c.contactId!, c]));
    const to = input.toContactIds.map((id) => {
      const c = byContact.get(id);
      if (!c) throw new BadRequestException("Minutes go only to this meeting's external participants");
      if (!usableEmail(c.email)) throw new BadRequestException(`${c.name} has no email address`);
      return { contactId: id, name: c.name, email: c.email.trim() };
    });

    const members = input.ccUserIds.length
      ? await tx
          .select({ userId: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')`, email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.tenantId, ctx.tenantId), inArray(memberships.userId, input.ccUserIds)))
      : [];
    if (members.length !== input.ccUserIds.length) throw new BadRequestException('CC recipients must be members of this workspace');
    const byMember = new Map(members.map((m) => [m.userId, m]));
    const cc = input.ccUserIds.map((id) => {
      const m = byMember.get(id)!;
      if (!usableEmail(m.email)) throw new BadRequestException(`${m.name} has no email address`);
      return { userId: id, name: m.name, email: m.email.trim() };
    });

    const [me] = await tx.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')`, email: users.email }).from(users).where(eq(users.id, ctx.userId));
    if (!me || !usableEmail(me.email)) throw new BadRequestException('Your account has no email address for the customer to reply to');
    const sender = { name: me.name, email: me.email.trim() };
    // tenants is a platform table without RLS, so filter by the caller's tenant explicitly.
    const [workspace] = await tx.select({ name: tenants.name, language: tenants.customerEmailLanguage }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const language = workspace?.language ?? 'en';

    const email = minutesEmail({
      language,
      subject: input.subject,
      body: input.body,
      workspaceName: workspace?.name ?? 'Pultly',
      sender,
      mailFrom: this.env.MAIL_FROM,
      to: to.map(({ name, email }) => ({ name, email })),
      cc: cc.map(({ name, email }) => ({ name, email })),
    });
    return { meeting, email, to, cc, sender, language };
  }

  /** The template from the meeting and its internal minutes as they are now (spec 7.1). */
  private async template(tx: Tx, ctx: TenantContext, meetingId: string): Promise<{ subject: string; body: string }> {
    const meeting: ApiMeeting = await this.meetings.load(tx, ctx, meetingId);
    const [workspace] = await tx
      .select({ name: tenants.name, language: tenants.customerEmailLanguage, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const [internal] = await tx.select({ agreements: meetingMinutes.agreements, nextSteps: meetingMinutes.nextSteps }).from(meetingMinutes).where(eq(meetingMinutes.meetingId, meetingId));
    const filled = minutesTemplate({
      language: workspace?.language ?? 'en',
      timeZone: workspace?.timezone ?? 'UTC',
      workspaceName: workspace?.name ?? '',
      meeting,
      internalNames: meeting.participants.filter((p) => p.kind === 'internal').map((p) => p.name),
      externalNames: meeting.participants.filter((p) => p.kind === 'external').map((p) => p.name),
      agreements: internal?.agreements ?? '',
      nextSteps: (internal?.nextSteps ?? []).map((s) => ({ text: s.text, dueDate: s.dueDate ?? null })),
    });
    return { subject: filled.subject.slice(0, EXTERNAL_SUBJECT_MAX), body: filled.body.slice(0, EXTERNAL_BODY_MAX) };
  }

  private async lockMinutes(tx: Tx, meetingId: string) {
    const [row] = await tx.select().from(meetingMinutes).where(eq(meetingMinutes.meetingId, meetingId)).for('update');
    return row;
  }

  /** The 409 of a conflicting edit, in the shape the app shows ("… It now says …"). */
  private async conflict(tx: Tx, row: typeof meetingMinutes.$inferSelect, fields: ('externalSubject' | 'externalBody')[]): Promise<never> {
    const [who] = row.externalUpdatedByUserId
      ? await tx
          .select({ name: sql<string>`coalesce(${users.displayName}, ${users.email})` })
          .from(users)
          .where(eq(users.id, row.externalUpdatedByUserId))
      : [];
    const name = who?.name ?? 'Someone';
    const parts = fields.map((f) => (f === 'externalSubject' ? 'the subject' : 'the text'));
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: `${name} changed the external minutes while you were editing. Your change to ${parts.join(' and ')} wasn't saved.`,
      conflicts: fields.map((f) => ({ field: f === 'externalSubject' ? 'subject' : 'body', value: row[f] ?? '', label: null, changedBy: name, changedAt: row.externalUpdatedAt })),
    });
  }

  private async present(tx: Tx, ctx: TenantContext, meetingId: string): Promise<ApiExternalMinutes> {
    const [row] = await tx
      .select({
        subject: meetingMinutes.externalSubject,
        body: meetingMinutes.externalBody,
        prefilledAt: meetingMinutes.externalPrefilledAt,
        updatedAt: meetingMinutes.externalUpdatedAt,
        updatedByName: userNameOf(meetingMinutes.externalUpdatedByUserId),
      })
      .from(meetingMinutes)
      .where(eq(meetingMinutes.meetingId, meetingId));
    const [workspace] = await tx.select({ language: tenants.customerEmailLanguage }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const [lastSend] = await this.loadSends(tx, meetingId, undefined, 1);
    const subject = row?.subject ?? '';
    const body = row?.body ?? '';
    return {
      subject,
      body,
      prefilled: !!row?.prefilledAt,
      updatedAt: row?.updatedAt ?? null,
      updatedByName: row?.updatedAt ? (row.updatedByName ?? null) : null,
      language: workspace?.language ?? 'en',
      lastSend: lastSend ?? null,
      changedSinceLastSend: !!lastSend && (lastSend.subject !== subjectLine(subject) || lastSend.body !== body),
    };
  }

  /** Sends of a meeting (or one of them), newest first, with their recipients: people first, then copies. */
  private async loadSends(tx: Tx, meetingId: string, sendId?: string, limit?: number): Promise<ApiMinutesSend[]> {
    let query = tx
      .select()
      .from(meetingMinutesSends)
      .where(and(eq(meetingMinutesSends.meetingId, meetingId), sendId ? eq(meetingMinutesSends.id, sendId) : undefined))
      .orderBy(desc(meetingMinutesSends.createdAt), desc(meetingMinutesSends.id))
      .$dynamic();
    if (limit) query = query.limit(limit);
    const sends = await query;
    if (!sends.length) return [];
    const recipients = await tx
      .select()
      .from(meetingMinutesRecipients)
      .where(inArray(meetingMinutesRecipients.sendId, sends.map((s) => s.id)))
      .orderBy(desc(meetingMinutesRecipients.kind), asc(meetingMinutesRecipients.createdAt), asc(meetingMinutesRecipients.name));
    return sends.map((s) => {
      const mine = recipients
        .filter((r) => r.sendId === s.id)
        .map((r) => ({ id: r.id, kind: r.kind, contactId: r.contactId, userId: r.userId, name: r.name, email: r.email, status: r.status, error: r.error, sentAt: r.sentAt }));
      return {
        id: s.id,
        meetingId: s.meetingId,
        senderUserId: s.senderUserId,
        senderName: s.senderName,
        senderEmail: s.senderEmail,
        subject: s.subject,
        body: s.body,
        language: s.language,
        status: deliveryOf(mine.map((r) => r.status)),
        recipients: mine,
        createdAt: s.createdAt,
      };
    });
  }
}
