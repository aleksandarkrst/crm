import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { requestActor } from '../../../shared/database/request-context';
import { companies, contacts, deals, funnels, funnelStages, HISTORY_ENTITY_TYPES, type HistoryEntityType, memberships, products, recordChanges, users } from '../../../shared/database/schema';

export const HistoryQuery = z.object({
  entityType: z.enum(HISTORY_ENTITY_TYPES),
  entityId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

type ChangeRow = typeof recordChanges.$inferSelect;

/** Fields whose values are ids; the history shows the name instead. */
const ID_FIELDS = new Set(['stageId', 'funnelId', 'companyId', 'primaryContactId', 'ownerUserId', 'dealId', 'organizerUserId']);
/** Id fields that name a member. */
const USER_FIELDS = new Set(['ownerUserId', 'organizerUserId']);

/** How a conflict message names a field ("Your change to the closing date wasn't saved"). */
const FIELD_NAMES: Record<string, string> = {
  title: 'the title',
  funnelId: 'the funnel',
  companyId: 'the company',
  primaryContactId: 'the primary contact',
  ownerUserId: 'the owner',
  source: 'the source',
  amount: 'the amount',
  currency: 'the currency',
  closeDate: 'the closing date',
  fitScore: 'the fit score',
  headline: 'the headline',
  need: 'the need',
  constraint: 'the constraint',
  decisionMaker: 'the decision maker',
  discoveryDate: 'the discovery date',
  name: 'the name',
  industry: 'the industry',
  hq: 'the HQ',
  teamSize: 'the team size',
  domain: 'the domain',
  notes: 'the notes',
  fullName: 'the name',
  jobTitle: 'the job title',
  email: 'the email',
  phone: 'the phone',
  linkedin: 'the LinkedIn profile',
  buyerRole: 'the buyer role',
  // meetings (CD-130)
  type: 'the type',
  startsAt: 'the start',
  endsAt: 'the end',
  location: 'the location',
  agenda: 'the agenda',
  dealId: 'the deal',
  organizerUserId: 'the organizer',
  status: 'the status',
  cancelReason: 'the cancellation reason',
  // meeting minutes (CD-132)
  summary: 'the summary',
  agreements: 'the agreements',
  nextSteps: 'the next steps',
};
const ENTITY_NAMES: Record<HistoryEntityType, string> = { deal: 'deal', company: 'company', contact: 'contact', meeting: 'meeting' };

/** A patch field → the history field it changes (the fit score is stored from the CHAMP scores). */
const historyField = (field: string) => (field === 'champ' ? 'fitScore' : field);

export interface HistoryEntry {
  id: string;
  action: ChangeRow['action'];
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  /** Names for id values (stage, funnel, company, contact, deal, owner, organizer), null otherwise. */
  oldLabel: string | null;
  newLabel: string | null;
  /** The record's name (created, deleted) or the product of a deal line, as it was then. */
  label: string | null;
  /** Who made the change: null for the system (imports without a user, jobs). */
  actor: { userId: string | null; name: string } | null;
  changedAt: Date;
}

/**
 * The version a client edited, from `If-Match` (the record's `updatedAt`, quoted or not, as an
 * ETag). No header, or `*`, means "no version": the update is last-write-wins, as before CD-20.
 */
export function parseVersion(header: string | undefined): Date | undefined {
  const raw = header?.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  if (!raw || raw === '*') return undefined;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) throw new BadRequestException("If-Match must be the record's updatedAt, e.g. \"2026-09-24T10:15:00.123Z\"");
  return at;
}

/**
 * Change history of deals, companies, contacts and meetings (CD-69, CD-130). Triggers write it
 * (drizzle/0020_record_changes_rls.sql); this reads it with readable names, and uses it to decide
 * whether an update conflicts with a change made since the client's version (CD-20).
 */
@Injectable()
export class RecordHistoryService {
  constructor(private readonly database: DatabaseService) {}

  /** Newest first. `more` says whether older entries exist beyond this page. */
  list(ctx: TenantContext, query: HistoryQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(recordChanges)
        .where(and(eq(recordChanges.entityType, query.entityType), eq(recordChanges.entityId, query.entityId)))
        .orderBy(desc(recordChanges.changedAt), desc(recordChanges.id))
        .limit(query.limit + 1)
        .offset(query.offset);
      const page = rows.slice(0, query.limit);
      return { entries: await this.present(tx, ctx, page), more: rows.length > query.limit };
    });
  }

  /**
   * Optimistic concurrency. Call inside the update's transaction, after locking the row
   * (`select … for update`). If the record changed since `version`, the fields this update sends
   * are checked against the history: a field someone else changed since then, to a value other
   * than the one sent, is a conflict (409, naming who, which fields and their current values).
   * Changes to other fields are merged, and so are changes made earlier by the same browser tab.
   */
  async assertNoConflict(
    tx: Tx,
    ctx: TenantContext,
    entity: HistoryEntityType,
    current: { id: string; updatedAt: Date } & Record<string, unknown>,
    patch: Record<string, unknown>,
    version: Date | undefined,
  ): Promise<void> {
    if (!version || current.updatedAt.getTime() <= version.getTime()) return;
    const sent = Object.keys(patch).filter((k) => patch[k] !== undefined);
    if (sent.length === 0) return;
    const clientId = requestActor.getStore()?.clientId;
    const changes = await tx
      .select()
      .from(recordChanges)
      .where(
        and(
          eq(recordChanges.entityType, entity),
          eq(recordChanges.entityId, current.id),
          eq(recordChanges.action, 'updated'),
          gt(recordChanges.changedAt, version),
          inArray(recordChanges.field, [...new Set(sent.map(historyField))]),
          clientId ? or(isNull(recordChanges.clientId), ne(recordChanges.clientId, clientId)) : undefined,
        ),
      )
      .orderBy(desc(recordChanges.changedAt));
    const conflicting = changes.filter((c, i) => changes.findIndex((d) => d.field === c.field) === i).filter((c) => !sameValue(c.field!, current, patch));
    if (conflicting.length === 0) return;

    const [latest] = await this.present(tx, ctx, conflicting.slice(0, 1));
    const who =
      latest?.actor?.userId === ctx.userId ? 'You' : latest?.actor ? (latest.actor.name === FORMER_MEMBER ? 'A former member' : latest.actor.name) : 'Someone';
    const whileYou = who === 'You' ? 'in another window while you were editing' : 'while you were editing';
    const fields = conflicting.map((c) => FIELD_NAMES[c.field!] ?? c.field!);
    const list = fields.length === 1 ? fields[0] : `${fields.slice(0, -1).join(', ')} and ${fields.at(-1)}`;
    const now = await this.present(tx, ctx, conflicting);
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: `${who} changed this ${ENTITY_NAMES[entity]} ${whileYou}. Your change to ${list} wasn't saved.`,
      conflicts: now.map((e) => ({
        field: e.field,
        value: e.newValue,
        label: e.newLabel,
        changedBy: e.actor?.name ?? null,
        changedAt: e.changedAt,
      })),
      current,
    });
  }

  /** Adds readable names: members by name ("Former member" once they left), ids as names. */
  private async present(tx: Tx, ctx: TenantContext, rows: ChangeRow[]): Promise<HistoryEntry[]> {
    const ids = {
      stageId: new Set<string>(),
      funnelId: new Set<string>(),
      companyId: new Set<string>(),
      primaryContactId: new Set<string>(),
      dealId: new Set<string>(),
      user: new Set<string>(),
      product: new Set<string>(),
    };
    for (const r of rows) {
      if (r.actorUserId) ids.user.add(r.actorUserId);
      if (r.field && ID_FIELDS.has(r.field)) {
        for (const v of [r.oldValue, r.newValue]) {
          if (typeof v !== 'string') continue;
          if (USER_FIELDS.has(r.field)) ids.user.add(v);
          else ids[r.field as 'stageId' | 'funnelId' | 'companyId' | 'primaryContactId' | 'dealId'].add(v);
        }
      }
      // Lines keep the product's name from when they changed; a change of product needs both names.
      for (const v of [r.oldValue, r.newValue]) {
        const productId = (v as { productId?: unknown } | null)?.productId;
        if (typeof productId === 'string') ids.product.add(productId);
      }
    }
    const names = new Map<string, string>();
    const load = async (set: Set<string>, query: (list: string[]) => Promise<{ id: string; name: string | null }[]>) => {
      if (set.size === 0) return;
      for (const row of await query([...set])) if (row.name) names.set(row.id, row.name);
    };
    await load(ids.stageId, (list) => tx.select({ id: funnelStages.id, name: funnelStages.name }).from(funnelStages).where(inArray(funnelStages.id, list)));
    await load(ids.funnelId, (list) => tx.select({ id: funnels.id, name: funnels.label }).from(funnels).where(inArray(funnels.id, list)));
    await load(ids.companyId, (list) => tx.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, list)));
    await load(ids.primaryContactId, (list) => tx.select({ id: contacts.id, name: contacts.fullName }).from(contacts).where(inArray(contacts.id, list)));
    await load(ids.dealId, (list) => tx.select({ id: deals.id, name: deals.title }).from(deals).where(inArray(deals.id, list)));
    await load(ids.product, (list) => tx.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, list)));
    // users is global: only people who are members of this workspace now are named.
    await load(ids.user, (list) =>
      tx
        .select({ id: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')` })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, ctx.tenantId), inArray(memberships.userId, list))),
    );

    const labelOf = (field: string | null, value: unknown): string | null => {
      if (!field || !ID_FIELDS.has(field) || typeof value !== 'string') return null;
      const fallback = USER_FIELDS.has(field)
        ? FORMER_MEMBER
        : field === 'companyId'
          ? 'Deleted company'
          : field === 'primaryContactId'
            ? 'Deleted contact'
            : field === 'dealId'
              ? 'Deleted deal'
              : 'Deleted';
      return names.get(value) ?? fallback;
    };
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      field: r.field,
      oldValue: withProductName(r.oldValue, names),
      newValue: withProductName(r.newValue, names),
      oldLabel: labelOf(r.field, r.oldValue),
      newLabel: labelOf(r.field, r.newValue),
      label: r.label,
      actor: r.actorUserId ? { userId: names.has(r.actorUserId) ? r.actorUserId : null, name: names.get(r.actorUserId) ?? FORMER_MEMBER } : null,
      changedAt: r.changedAt,
    }));
  }
}

const FORMER_MEMBER = 'Former member';

/** Line values get the current product name next to a product id (for "product A → B"). */
function withProductName(value: unknown, names: Map<string, string>): unknown {
  const productId = (value as { productId?: unknown } | null)?.productId;
  if (typeof productId !== 'string') return value;
  return { ...(value as object), productName: names.get(productId) ?? null };
}

/** The update sends the value the record already has (someone made the same change): no conflict. */
function sameValue(field: string, current: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  if (field === 'fitScore') return JSON.stringify(current.champ ?? null) === JSON.stringify(patch.champ ?? null);
  const a = current[field];
  const b = patch[field];
  if (field === 'amount') return Number(a) === Number(b);
  // Lists and objects (a meeting's next steps) compare by value.
  if ((a !== null && typeof a === 'object') || (b !== null && typeof b === 'object')) return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');
}

