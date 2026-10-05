import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { JobsService } from '../../../shared/events/jobs.service';
import {
  companies,
  contacts,
  deals,
  MEETING_STATUSES,
  MEETING_TYPES,
  type MeetingStatus,
  type MeetingType,
  meetingMinutes,
  meetingParticipants,
  meetings,
  memberships,
  tenants,
  users,
} from '../../../shared/database/schema';
import { formatTimeRange } from '../../../shared/time/zoned-time';
import { IdList, nonEmptyPatch, optionalText } from '../../../shared/validation/common';
import { ActivitiesService } from '../deals/activities.service';
import { RecordHistoryService } from '../history/record-history.service';
import { userNameOf } from '../owner';
import type { InviteKind } from './meeting-invite';
import { canManageMeeting, isNotClosed, type MeetingChange, meetingChangeError, NOT_CLOSED_AFTER_MS } from './meeting-rules';

const instant = z.iso.datetime({ offset: true });
/** Ids of people, without duplicates (the same person can't be added twice). */
const people = z
  .array(z.uuid())
  .max(100)
  .transform((ids) => [...new Set(ids)]);

const meetingFields = {
  title: z.string().trim().min(1).max(200),
  type: z.enum(MEETING_TYPES),
  startsAt: instant,
  endsAt: instant,
  location: optionalText(300),
  agenda: optionalText(5000),
  companyId: z.uuid(),
  /** Optional; when set it must be a deal of the meeting's company. */
  dealId: z.uuid().nullish(),
  /** Defaults to the caller on create. Must be a member; always an internal participant. */
  organizerUserId: z.uuid().optional(),
  /** Members besides the organizer. On update the set is replaced (the organizer is always kept). */
  internalUserIds: people.optional(),
  /** Contacts of the workspace. On update the set is replaced. */
  externalContactIds: people.optional(),
};
const END_AFTER_START = 'The end must be after the start';
/** The meeting's internal minutes have a summary (CD-132): the calendar's "Recorded", else "Missing". */
const minutesRecorded = sql`exists (select 1 from ${meetingMinutes} mm where mm.meeting_id = ${meetings.id} and btrim(coalesce(mm.summary, '')) <> '')`;


export const CreateMeeting = z
  .object(meetingFields)
  .refine((m) => new Date(m.endsAt).getTime() > new Date(m.startsAt).getTime(), { message: END_AFTER_START, path: ['endsAt'] });
export const UpdateMeeting = nonEmptyPatch(z.object(meetingFields).partial());
export const CancelMeeting = z
  .object({ reason: optionalText(1000) })
  .nullish()
  .transform((v) => v ?? {});

const flag = z.enum(['1', 'true', '0', 'false']).transform((v) => v === '1' || v === 'true');
const enumList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));

export const MeetingsQuery = z
  .object({
    /** Meetings overlapping [from, to): starting before `to` and ending after `from`. */
    from: instant.optional(),
    to: instant.optional(),
    /** Organizer or internal participant. */
    userId: z.uuid().optional(),
    companyId: z.uuid().optional(),
    dealId: z.uuid().optional(),
    /** External participant. */
    contactId: z.uuid().optional(),
    type: enumList(MEETING_TYPES).optional(),
    status: enumList(MEETING_STATUSES).optional(),
    notClosed: flag.optional(),
    missingMinutes: flag.optional(),
    ids: IdList.optional(),
    sort: z.enum(['asc', 'desc']).default('asc'),
    limit: z.coerce.number().int().min(1).max(1000).default(500),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine((q) => !q.from || !q.to || new Date(q.from).getTime() < new Date(q.to).getTime(), { message: '"from" must be before "to"', path: ['to'] })
  .refine((q) => q.from || q.to || q.companyId || q.dealId || q.contactId || q.ids, {
    message: 'Give a period (from, to) or one of companyId, dealId, contactId, ids',
  });

export type CreateMeeting = z.infer<typeof CreateMeeting>;
export type UpdateMeeting = z.infer<typeof UpdateMeeting>;
export type CancelMeeting = z.infer<typeof CancelMeeting>;
export type MeetingsQuery = z.infer<typeof MeetingsQuery>;

export interface ApiMeetingParticipant {
  id: string;
  kind: 'internal' | 'external';
  userId: string | null;
  contactId: string | null;
  name: string;
  email: string | null;
  /** The contact was deleted, or the member is no longer in the workspace. */
  deleted: boolean;
}

export interface ApiMeeting {
  id: string;
  title: string;
  type: MeetingType;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  agenda: string | null;
  companyId: string;
  companyName: string;
  dealId: string | null;
  dealTitle: string | null;
  dealOwnerUserId: string | null;
  organizerUserId: string | null;
  organizerName: string | null;
  status: MeetingStatus;
  cancelReason: string | null;
  heldAt: Date | null;
  cancelledAt: Date | null;
  notClosed: boolean;
  participants: ApiMeetingParticipant[];
  /** Recorded once the internal minutes have a summary (CD-132). */
  internalMinutes: 'missing' | 'recorded';
  /** The version of the minutes (null before anyone wrote them): an open minutes tab re-reads them when it changes. */
  minutesUpdatedAt: Date | null;
  /** CD-133 fills this in; until then nothing is sent. */
  externalDelivery: 'not_sent' | 'queued' | 'sent' | 'failed';
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type MeetingRow = typeof meetings.$inferSelect;
interface ListedRow {
  meeting: MeetingRow;
  companyName: string;
  dealTitle: string | null;
  dealOwnerUserId: string | null;
  organizerName: string | null;
  minutesRecorded: boolean;
  minutesUpdatedAt: Date | null;
}

/** Who a meeting's people are, checked against the workspace (members, contacts). */
interface People {
  members: Map<string, string>; // user id → name
  contacts: Map<string, { name: string; email: string | null }>;
}

/**
 * Meetings with customer companies (CD-130). Everyone in the workspace sees all meetings and can
 * create them; changing one takes an owner or admin, its organizer or an internal participant
 * (meeting-rules.ts). A meeting linked to a deal writes its timeline entries in the same
 * transaction: scheduled, held (which counts as contact with the customer) and cancelled.
 *
 * Internal participants are emailed (with an .ics) by the worker, through "crm.meeting-invite" jobs
 * queued in the same transaction (CD-131): when someone else adds them to a planned meeting, and
 * when a planned meeting's time or place changes, it is cancelled or restored. Customers never
 * get these emails.
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly changes: RecordHistoryService,
    private readonly jobs: JobsService,
  ) {}

  list(ctx: TenantContext, query: MeetingsQuery) {
    const now = new Date();
    const filters: (SQL | undefined)[] = [];
    if (query.from) filters.push(gt(meetings.endsAt, new Date(query.from)));
    if (query.to) filters.push(lt(meetings.startsAt, new Date(query.to)));
    if (query.userId) {
      filters.push(
        or(
          eq(meetings.organizerUserId, query.userId),
          sql`exists (select 1 from ${meetingParticipants} p where p.meeting_id = ${meetings.id} and p.user_id = ${query.userId})`,
        ),
      );
    }
    if (query.companyId) filters.push(eq(meetings.companyId, query.companyId));
    if (query.dealId) filters.push(eq(meetings.dealId, query.dealId));
    if (query.contactId) filters.push(sql`exists (select 1 from ${meetingParticipants} p where p.meeting_id = ${meetings.id} and p.contact_id = ${query.contactId})`);
    if (query.type) filters.push(inArray(meetings.type, query.type));
    if (query.status) filters.push(inArray(meetings.status, query.status));
    if (query.notClosed) filters.push(eq(meetings.status, 'planned'), lt(meetings.endsAt, new Date(now.getTime() - NOT_CLOSED_AFTER_MS)));
    // Held without internal minutes: no summary written yet (CD-132).
    if (query.missingMinutes) filters.push(eq(meetings.status, 'held'), sql`not ${minutesRecorded}`);
    if (query.ids) filters.push(inArray(meetings.id, query.ids));
    const order = query.sort === 'desc' ? [desc(meetings.startsAt), desc(meetings.id)] : [asc(meetings.startsAt), asc(meetings.id)];

    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const rows = await this.select(tx)
        .where(and(...filters))
        .orderBy(...order)
        .limit(query.limit + 1)
        .offset(query.offset);
      const page = rows.slice(0, query.limit);
      return { meetings: await this.present(tx, ctx, page, now), more: rows.length > query.limit };
    });
  }

  get(ctx: TenantContext, id: string): Promise<ApiMeeting> {
    return this.database.withTenant(ctx.tenantId, (tx) => this.load(tx, ctx, id));
  }

  /** New meetings are planned; the organizer defaults to the caller and is always an internal participant. */
  create(ctx: TenantContext, input: CreateMeeting): Promise<ApiMeeting> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const organizerUserId = input.organizerUserId ?? ctx.userId;
        await this.assertCompanyAndDeal(tx, input.companyId, input.dealId ?? null);
        const internal = [...new Set([organizerUserId, ...(input.internalUserIds ?? [])])];
        const found = await this.people(tx, ctx, internal, input.externalContactIds ?? []);
        if (!found.members.has(organizerUserId)) throw new BadRequestException('The organizer must be a member of this workspace');
        this.assertAllFound(found, internal, input.externalContactIds ?? []);

        const [row] = await tx
          .insert(meetings)
          .values({
            tenantId: ctx.tenantId,
            title: input.title,
            type: input.type,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            location: input.location ?? null,
            agenda: input.agenda ?? null,
            companyId: input.companyId,
            dealId: input.dealId ?? null,
            organizerUserId,
            createdByUserId: ctx.userId,
          })
          .returning();
        const meeting = row!;
        const { addedUserIds } = await this.syncParticipants(tx, ctx, meeting.id, organizerUserId, found, internal, input.externalContactIds ?? []);
        await this.invite(tx, ctx, meeting.id, 'added', addedUserIds);
        if (meeting.dealId) {
          await this.activities.record(tx, ctx, meeting.dealId, { channel: 'MT', title: `Meeting scheduled · ${meeting.title}`, detail: await this.when(tx, ctx, meeting) });
        }
        await this.audit.record(tx, ctx, { action: 'meeting.created', entityType: 'meeting', entityId: meeting.id });
        return this.load(tx, ctx, meeting.id);
      })
      .catch(mapDbError);
  }

  /**
   * Changes the fields sent; `internalUserIds` and `externalContactIds` replace the sets (the
   * organizer always stays). A cancelled meeting can't be changed until it is restored. With a
   * `version` (If-Match), a field someone else changed since then is a 409 conflict, as on deals.
   */
  update(ctx: TenantContext, id: string, input: UpdateMeeting, version?: Date): Promise<ApiMeeting> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const current = await this.lockForChange(tx, ctx, id, 'edit');
        if (version) await this.changes.assertNoConflict(tx, ctx, 'meeting', comparable(current), comparable(input), version);

        const startsAt = input.startsAt !== undefined ? new Date(input.startsAt) : current.startsAt;
        const endsAt = input.endsAt !== undefined ? new Date(input.endsAt) : current.endsAt;
        if (endsAt.getTime() <= startsAt.getTime()) throw new BadRequestException(END_AFTER_START);
        const companyId = input.companyId ?? current.companyId;
        const dealId = input.dealId !== undefined ? input.dealId : current.dealId;
        if (input.companyId !== undefined || input.dealId !== undefined) await this.assertCompanyAndDeal(tx, companyId, dealId ?? null);
        const organizerUserId = input.organizerUserId ?? current.organizerUserId;

        const newMembers = [...(input.organizerUserId ? [input.organizerUserId] : []), ...(input.internalUserIds ?? [])];
        const found = await this.people(tx, ctx, newMembers, input.externalContactIds ?? []);
        if (input.organizerUserId && !found.members.has(input.organizerUserId)) throw new BadRequestException('The organizer must be a member of this workspace');
        this.assertAllFound(found, newMembers, input.externalContactIds ?? []);

        const { internalUserIds, externalContactIds, ...fields } = input;
        const patch: PgUpdateSetSource<typeof meetings> = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        if (input.startsAt !== undefined) patch.startsAt = startsAt;
        if (input.endsAt !== undefined) patch.endsAt = endsAt;
        // A planned meeting moved to another time or place: its participants' calendars get the new version.
        const planned = current.status === 'planned';
        const moved =
          planned &&
          (startsAt.getTime() !== current.startsAt.getTime() || endsAt.getTime() !== current.endsAt.getTime() || (input.location !== undefined && (input.location ?? null) !== current.location));
        if (moved) patch.icsSequence = sql`${meetings.icsSequence} + 1`;
        const sync = internalUserIds
          ? await this.syncParticipants(tx, ctx, id, organizerUserId, found, internalUserIds, externalContactIds)
          : await this.syncParticipants(tx, ctx, id, organizerUserId, found, [], externalContactIds, true);
        // A change of people alone still moves the version, so the next If-Match is current.
        if (Object.keys(patch).length || sync.changed) await tx.update(meetings).set(Object.keys(patch).length ? patch : { updatedAt: new Date() }).where(eq(meetings.id, id));
        if (planned) {
          await this.invite(tx, ctx, id, 'added', sync.addedUserIds);
          if (moved) await this.invite(tx, ctx, id, 'updated', (await this.internalUserIds(tx, id)).filter((u) => !sync.addedUserIds.includes(u)));
        }
        await this.audit.record(tx, ctx, { action: 'meeting.updated', entityType: 'meeting', entityId: id, data: input });
        return this.load(tx, ctx, id);
      })
      .catch(mapDbError);
  }

  /** Planned → held, not before the start. On a deal: "Meeting held" at the start time, and last contact. */
  markHeld(ctx: TenantContext, id: string): Promise<ApiMeeting> {
    return this.changeStatus(ctx, id, 'held', { status: 'held', heldAt: new Date() }, async (tx, m) => {
      if (!m.dealId) return;
      const entry = { channel: 'MT' as const, title: `Meeting held · ${m.title}`, detail: await this.when(tx, ctx, m), occurredAt: m.startsAt };
      await this.activities.record(tx, ctx, m.dealId, entry, { countsAsContact: true });
    });
  }

  /** Planned → cancelled, with an optional reason. */
  cancel(ctx: TenantContext, id: string, input: CancelMeeting): Promise<ApiMeeting> {
    const reason = input.reason ?? null;
    return this.changeStatus(ctx, id, 'cancel', { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason, icsSequence: sql`${meetings.icsSequence} + 1` }, async (tx, m) => {
      await this.invite(tx, ctx, id, 'cancelled', await this.internalUserIds(tx, id));
      if (!m.dealId) return;
      const when = await this.when(tx, ctx, m);
      await this.activities.record(tx, ctx, m.dealId, { channel: 'MT', title: `Meeting cancelled · ${m.title}`, detail: reason ? `${when}\nReason: ${reason}` : when });
    });
  }

  /** Held → planned ("Undo held"). CD-133 refuses it once external minutes were sent. */
  undoHeld(ctx: TenantContext, id: string): Promise<ApiMeeting> {
    return this.changeStatus(ctx, id, 'undo-held', { status: 'planned', heldAt: null });
  }

  /** Cancelled → planned ("Restore"). The participants' calendars get it back (an update). */
  restore(ctx: TenantContext, id: string): Promise<ApiMeeting> {
    return this.changeStatus(ctx, id, 'restore', { status: 'planned', cancelledAt: null, cancelReason: null, icsSequence: sql`${meetings.icsSequence} + 1` }, async (tx) => {
      await this.invite(tx, ctx, id, 'updated', await this.internalUserIds(tx, id));
    });
  }

  /** Owners and admins only (the route says so). Participants go with the meeting. */
  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.delete(meetings).where(eq(meetings.id, id)).returning({ id: meetings.id, title: meetings.title });
        if (!row) throw new NotFoundException('Meeting not found');
        await this.audit.record(tx, ctx, { action: 'meeting.deleted', entityType: 'meeting', entityId: id, data: { title: row.title } });
      })
      .catch(mapDbError);
  }

  // ------------------------------------------------------------------ helpers

  private changeStatus(
    ctx: TenantContext,
    id: string,
    change: Exclude<MeetingChange, 'edit'>,
    set: PgUpdateSetSource<typeof meetings>,
    after?: (tx: Tx, meeting: MeetingRow) => Promise<void>,
  ): Promise<ApiMeeting> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.lockForChange(tx, ctx, id, change);
        const [row] = await tx.update(meetings).set(set).where(eq(meetings.id, id)).returning();
        await after?.(tx, row!);
        await this.audit.record(tx, ctx, { action: `meeting.${change}`, entityType: 'meeting', entityId: id, data: set.cancelReason ? { reason: set.cancelReason } : undefined });
        return this.load(tx, ctx, id);
      })
      .catch(mapDbError);
  }

  /**
   * Locks the meeting, then checks who is changing it (403) and that its status allows the change
   * (409). The minutes (MeetingMinutesService) use it too: same people, read-only when cancelled.
   */
  async lockForChange(tx: Tx, ctx: TenantContext, id: string, change: MeetingChange): Promise<MeetingRow> {
    const [meeting] = await tx.select().from(meetings).where(eq(meetings.id, id)).for('update');
    if (!meeting) throw new NotFoundException('Meeting not found');
    const internalUserIds = await this.internalUserIds(tx, id);
    if (!canManageMeeting(ctx, { organizerUserId: meeting.organizerUserId, internalUserIds })) {
      throw new ForbiddenException('Only its organizer, its internal participants, admins and owners can change this meeting');
    }
    const error = meetingChangeError(change, meeting, new Date());
    if (error) throw new ConflictException(error);
    return meeting;
  }

  /** The members on the meeting (organizer included). */
  private async internalUserIds(tx: Tx, meetingId: string): Promise<string[]> {
    const rows = await tx
      .select({ userId: meetingParticipants.userId })
      .from(meetingParticipants)
      .where(and(eq(meetingParticipants.meetingId, meetingId), eq(meetingParticipants.kind, 'internal')));
    return rows.flatMap((p) => (p.userId ? [p.userId] : []));
  }

  /**
   * Queues the email to each of these members but the caller, one job each (a retry never emails
   * the others twice). The worker decides at send time whether it still goes (meeting-jobs.ts).
   */
  private async invite(tx: Tx, ctx: TenantContext, meetingId: string, kind: InviteKind, userIds: readonly string[]) {
    for (const userId of new Set(userIds)) {
      if (userId === ctx.userId) continue;
      await this.jobs.send('crm.meeting-invite', { tenantId: ctx.tenantId, meetingId, userIds: [userId], actorUserId: ctx.userId, kind }, tx);
    }
  }

  /** The company must exist; a deal must exist and belong to that company (400 otherwise). */
  private async assertCompanyAndDeal(tx: Tx, companyId: string, dealId: string | null) {
    const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    if (!company) throw new BadRequestException('Company not found');
    if (!dealId) return;
    const [deal] = await tx.select({ companyId: deals.companyId }).from(deals).where(eq(deals.id, dealId));
    if (!deal) throw new BadRequestException('Deal not found');
    if (deal.companyId !== companyId) throw new BadRequestException("The deal belongs to another company. Pick one of the meeting company's deals.");
  }

  /** Names of the given members (of this workspace only: users is global) and contacts. */
  private async people(tx: Tx, ctx: TenantContext, userIds: string[], contactIds: string[]): Promise<People> {
    const members = userIds.length
      ? await tx
          .select({ id: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')` })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.tenantId, ctx.tenantId), inArray(memberships.userId, userIds)))
      : [];
    const found = contactIds.length ? await tx.select({ id: contacts.id, name: contacts.fullName, email: contacts.email }).from(contacts).where(inArray(contacts.id, contactIds)) : [];
    return { members: new Map(members.map((m) => [m.id, m.name])), contacts: new Map(found.map((c) => [c.id, { name: c.name, email: c.email }])) };
  }

  private assertAllFound(found: People, userIds: string[], contactIds: string[]) {
    if (userIds.some((id) => !found.members.has(id))) throw new BadRequestException('Internal participants must be members of this workspace');
    if (contactIds.some((id) => !found.contacts.has(id))) throw new BadRequestException('Contact not found');
  }

  /**
   * Makes the meeting's people match: `internal` (always including the organizer) and, when given,
   * `external`. With `keepInternal`, only the organizer is added if missing and nobody is removed.
   * Rows of deleted contacts and former members (no id any more) are kept. Returns whether
   * anything changed, and the members added.
   */
  private async syncParticipants(
    tx: Tx,
    ctx: TenantContext,
    meetingId: string,
    organizerUserId: string | null,
    found: People,
    internal: string[],
    external: string[] | undefined,
    keepInternal = false,
  ): Promise<{ changed: boolean; addedUserIds: string[] }> {
    const existing = await tx.select().from(meetingParticipants).where(eq(meetingParticipants.meetingId, meetingId));
    const wantedUsers = new Set(internal);
    if (organizerUserId) wantedUsers.add(organizerUserId);
    const haveUsers = new Set(existing.flatMap((p) => (p.userId ? [p.userId] : [])));
    const haveContacts = new Set(existing.flatMap((p) => (p.contactId ? [p.contactId] : [])));
    const remove = existing.filter(
      (p) => (!keepInternal && p.userId && !wantedUsers.has(p.userId)) || (external !== undefined && p.contactId && !external.includes(p.contactId)),
    );
    const addUsers = [...wantedUsers].filter((id) => !haveUsers.has(id));
    const addContacts = (external ?? []).filter((id) => !haveContacts.has(id));
    if (remove.length) await tx.delete(meetingParticipants).where(inArray(meetingParticipants.id, remove.map((p) => p.id)));
    // The organizer may have left the workspace's member list since: only add people we found.
    const rows = [
      ...addUsers.filter((id) => found.members.has(id)).map((userId) => ({ kind: 'internal' as const, userId, contactId: null, name: found.members.get(userId)!, email: null })),
      ...addContacts.map((contactId) => ({ kind: 'external' as const, userId: null, contactId, name: found.contacts.get(contactId)!.name, email: found.contacts.get(contactId)!.email })),
    ];
    if (rows.length) await tx.insert(meetingParticipants).values(rows.map((r) => ({ ...r, tenantId: ctx.tenantId, meetingId })));
    return { changed: remove.length > 0 || rows.length > 0, addedUserIds: rows.flatMap((r) => (r.userId ? [r.userId] : [])) };
  }

  /** "Tue 6 Oct 2026, 10:00–11:00 · <location>", in the workspace time zone, for the deal's timeline. */
  private async when(tx: Tx, ctx: TenantContext, m: Pick<MeetingRow, 'startsAt' | 'endsAt' | 'location'>): Promise<string> {
    // tenants is a platform table without RLS, so filter by the caller's tenant explicitly.
    const [workspace] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const when = formatTimeRange(m.startsAt, m.endsAt, workspace?.timezone ?? 'UTC');
    return m.location ? `${when} · ${m.location}` : when;
  }

  private select(tx: Tx) {
    return tx
      .select({
        meeting: meetings,
        companyName: companies.name,
        dealTitle: deals.title,
        dealOwnerUserId: deals.ownerUserId,
        organizerName: userNameOf(meetings.organizerUserId),
        minutesRecorded: sql<boolean>`${minutesRecorded}`,
        minutesUpdatedAt: sql<Date | null>`(select mm.updated_at from ${meetingMinutes} mm where mm.meeting_id = ${meetings.id})`.mapWith(meetingMinutes.updatedAt),
      })
      .from(meetings)
      .innerJoin(companies, eq(companies.id, meetings.companyId))
      .leftJoin(deals, eq(deals.id, meetings.dealId));
  }

  private async load(tx: Tx, ctx: TenantContext, id: string): Promise<ApiMeeting> {
    const rows = await this.select(tx).where(eq(meetings.id, id));
    if (!rows.length) throw new NotFoundException('Meeting not found');
    return (await this.present(tx, ctx, rows, new Date()))[0]!;
  }

  /**
   * Meetings as the API returns them, with their people: current names and emails while the
   * member or contact exists, the names saved on the meeting otherwise ("deleted"). The organizer
   * comes first, then the other members, then the contacts.
   */
  private async present(tx: Tx, ctx: TenantContext, rows: ListedRow[], now: Date): Promise<ApiMeeting[]> {
    if (!rows.length) return [];
    const people = await tx
      .select({
        participant: meetingParticipants,
        contactName: contacts.fullName,
        contactEmail: contacts.email,
        memberName: sql<string | null>`(select coalesce(u.display_name, u.email) from ${memberships} ms join ${users} u on u.id = ms.user_id where ms.tenant_id = ${ctx.tenantId} and ms.user_id = ${meetingParticipants.userId})`,
      })
      .from(meetingParticipants)
      .leftJoin(contacts, eq(contacts.id, meetingParticipants.contactId))
      .where(inArray(meetingParticipants.meetingId, rows.map((r) => r.meeting.id)))
      .orderBy(asc(meetingParticipants.createdAt), asc(meetingParticipants.name));
    const byMeeting = new Map<string, ApiMeetingParticipant[]>();
    for (const { participant: p, contactName, contactEmail, memberName } of people) {
      const internal = p.kind === 'internal';
      const live = internal ? !!memberName : !!contactName;
      const list = byMeeting.get(p.meetingId) ?? [];
      list.push({
        id: p.id,
        kind: p.kind,
        userId: p.userId,
        contactId: p.contactId,
        name: (internal ? memberName : contactName) ?? p.name,
        email: internal ? null : live ? contactEmail : p.email,
        deleted: !live,
      });
      byMeeting.set(p.meetingId, list);
    }
    return rows.map(({ meeting: m, companyName, dealTitle, dealOwnerUserId, organizerName, minutesRecorded: recorded, minutesUpdatedAt }) => {
      const rank = (p: ApiMeetingParticipant) => (p.kind === 'external' ? 2 : p.userId && p.userId === m.organizerUserId ? 0 : 1);
      const participants = (byMeeting.get(m.id) ?? []).sort((a, b) => rank(a) - rank(b));
      return {
        id: m.id,
        title: m.title,
        type: m.type,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        location: m.location,
        agenda: m.agenda,
        companyId: m.companyId,
        companyName,
        dealId: m.dealId,
        dealTitle: m.dealId ? dealTitle : null,
        dealOwnerUserId: m.dealId ? dealOwnerUserId : null,
        organizerUserId: m.organizerUserId,
        organizerName: m.organizerUserId ? organizerName : null,
        status: m.status,
        cancelReason: m.cancelReason,
        heldAt: m.heldAt,
        cancelledAt: m.cancelledAt,
        notClosed: isNotClosed(m, now),
        participants,
        internalMinutes: recorded ? 'recorded' : 'missing',
        minutesUpdatedAt,
        externalDelivery: 'not_sent',
        createdByUserId: m.createdByUserId,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      };
    });
  }
}

/**
 * Times as ISO strings on both sides, so the conflict check (RecordHistoryService) compares the
 * stored value with the one sent by value rather than by Date object.
 */
function comparable<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = { ...record };
  for (const key of ['startsAt', 'endsAt']) {
    const v = out[key];
    if (v instanceof Date) out[key] = v.toISOString();
    else if (typeof v === 'string') out[key] = new Date(v).toISOString();
  }
  return out as T;
}
