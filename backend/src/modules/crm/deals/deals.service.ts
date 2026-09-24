import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, not, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, companies, contacts, DEAL_OUTCOMES, dealContacts, type DealOutcome, deals, funnels, funnelStages, LOST_REASONS, tenants } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { nonEmptyPatch, optionalText, PaginationQuery } from '../../../shared/validation/common';
import { assertOwnerIsMember, userNameOf } from '../owner';
import { StageHistoryService } from './stage-history.service';

const money = z.union([z.number(), z.string()]).transform((v) => String(v)).pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Invalid amount'));
const champLevel = z.union([z.literal(0), z.literal(8), z.literal(17), z.literal(25)]);
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => /^[A-Z]{3}$/.test(c) && CURRENCIES.has(c), 'Must be an ISO 4217 currency code, e.g. EUR');

export const CreateDeal = z.object({
  title: z.string().trim().min(1).max(200),
  funnelId: z.uuid(),
  companyId: z.uuid().nullish(),
  primaryContactId: z.uuid().nullish(),
  ownerUserId: z.uuid().nullish(),
  source: optionalText(80),
  amount: money.optional(),
  /** ISO 4217. A new deal without one gets the workspace currency. */
  currency: currency.optional(),
  closeDate: z.iso.date().nullish(),
  // Discovery notes (proposal "What you told us"). Empty text clears a field.
  headline: optionalText(200),
  need: optionalText(1000),
  constraint: optionalText(500),
  decisionMaker: optionalText(200),
  discoveryDate: z.iso.date().nullish(),
});
export const UpdateDeal = nonEmptyPatch(
  CreateDeal.partial().extend({
    champ: z.object({ C: champLevel, H: champLevel, M: champLevel, P: champLevel }).optional(),
  }),
);
export const MoveDeal = z.object({ stageId: z.uuid() });
export const MarkLost = z.object({ reason: z.enum(LOST_REASONS), note: optionalText(1000) });
export const DealsQuery = PaginationQuery.extend({
  funnelId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  ownerUserId: z.uuid().optional(),
  outcome: z.enum(DEAL_OUTCOMES).optional(),
});
export type CreateDeal = z.infer<typeof CreateDeal>;
export type UpdateDeal = z.infer<typeof UpdateDeal>;
export type DealsQuery = z.infer<typeof DealsQuery>;
export type MoveDeal = z.infer<typeof MoveDeal>;
export type MarkLost = z.infer<typeof MarkLost>;

/**
 * A deal's outcome. Lost is stored (lost_at, with the reason); won is not: a deal is won while it
 * is in its funnel's won stage, so the stage and the outcome can never disagree. A lost deal keeps
 * the stage it was lost in, and can't be moved until it is reopened.
 */
export const dealOutcome = (deal: { lostAt: Date | null }, stageIsWon: boolean): DealOutcome => (deal.lostAt ? 'lost' : stageIsWon ? 'won' : 'open');

@Injectable()
export class DealsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly history: StageHistoryService,
  ) {}

  /** Board/list view: deals with company, primary contact and stage names joined in. */
  list(ctx: TenantContext, query: DealsQuery) {
    const filters: (SQL | undefined)[] = [];
    if (query.funnelId) filters.push(eq(deals.funnelId, query.funnelId));
    if (query.stageId) filters.push(eq(deals.stageId, query.stageId));
    if (query.companyId) filters.push(eq(deals.companyId, query.companyId));
    if (query.ownerUserId) filters.push(eq(deals.ownerUserId, query.ownerUserId));
    if (query.outcome === 'lost') filters.push(isNotNull(deals.lostAt));
    else if (query.outcome) filters.push(isNull(deals.lostAt), query.outcome === 'won' ? eq(funnelStages.isWon, true) : not(funnelStages.isWon));
    if (query.q) {
      const like = `%${query.q}%`;
      filters.push(or(ilike(deals.title, like), ilike(companies.name, like), ilike(contacts.fullName, like)));
    }
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select({
          deal: deals,
          companyName: companies.name,
          contactName: contacts.fullName,
          contactJobTitle: contacts.jobTitle,
          stageName: funnelStages.name,
          stageActivity: funnelStages.activity,
          stageIsWon: funnelStages.isWon,
          ownerName: userNameOf(deals.ownerUserId),
        })
        .from(deals)
        .innerJoin(funnelStages, eq(funnelStages.id, deals.stageId))
        .leftJoin(companies, eq(companies.id, deals.companyId))
        .leftJoin(contacts, eq(contacts.id, deals.primaryContactId))
        .where(and(...filters))
        .orderBy(asc(funnelStages.position), desc(deals.updatedAt))
        .limit(query.limit)
        .offset(query.offset);
      if (rows.length === 0) return [];
      // Other people linked to each deal (besides the primary contact), for the deal and company screens.
      const links = await tx
        .select({ dealId: dealContacts.dealId, contactId: dealContacts.contactId })
        .from(dealContacts)
        .where(inArray(dealContacts.dealId, rows.map((r) => r.deal.id)));
      return rows.map(({ stageIsWon, ...r }) => ({
        ...r,
        deal: { ...r.deal, outcome: dealOutcome(r.deal, stageIsWon) },
        contactIds: links.filter((l) => l.dealId === r.deal.id).map((l) => l.contactId),
      }));
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [found] = await tx.select().from(deals).where(eq(deals.id, id));
      if (!found) throw new NotFoundException('Deal not found');
      const row = await this.present(tx, found);
      const linked = await tx
        .select({ contact: contacts })
        .from(dealContacts)
        .innerJoin(contacts, eq(contacts.id, dealContacts.contactId))
        .where(eq(dealContacts.dealId, id));
      return { ...row, contacts: linked.map((l) => l.contact) };
    });
  }

  /** New deals start in the first stage of their funnel, in the workspace currency unless given one. */
  create(ctx: TenantContext, input: CreateDeal) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const first = await this.firstStage(tx, input.funnelId);
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        // tenants is a platform table without RLS, so filter by the caller's tenant explicitly.
        const [workspace] = await tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, ctx.tenantId));
        const [row] = await tx
          .insert(deals)
          .values({ ownerUserId: ctx.userId, currency: workspace?.currency, ...input, tenantId: ctx.tenantId, stageId: first.id, closedAt: first.isWon ? new Date() : null })
          .returning();
        await this.history.record(tx, ctx, { dealId: row!.id, kind: 'created', fromStageId: null, toStageId: first.id, outcome: first.isWon ? 'won' : 'open' }, row!.createdAt);
        await this.log(tx, ctx, row!.id, 'RS', 'Deal created', input.source ? `Source: ${input.source}` : null);
        await this.audit.record(tx, ctx, { action: 'deal.created', entityType: 'deal', entityId: row!.id });
        await this.notifyAssigned(tx, ctx, row!.id, null, row!.ownerUserId);
        return { ...row!, outcome: dealOutcome(row!, first.isWon) };
      })
      .catch(mapDbError);
  }

  /**
   * Changing the funnel (a different target persona) restarts the deal at that funnel's first
   * stage, and says so on the timeline ("Moved to funnel …").
   */
  update(ctx: TenantContext, id: string, input: UpdateDeal) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        const [before] = input.ownerUserId !== undefined ? await tx.select({ ownerUserId: deals.ownerUserId }).from(deals).where(eq(deals.id, id)) : [];
        const patch: Partial<typeof deals.$inferInsert> = { ...input };
        if (input.champ) patch.fitScore = input.champ.C + input.champ.H + input.champ.M + input.champ.P;
        let funnelChange: { from: string; to: typeof funnelStages.$inferSelect; funnel: string; at: Date } | null = null;
        if (input.funnelId) {
          const [current] = await tx.select({ funnelId: deals.funnelId, stageId: deals.stageId, lostAt: deals.lostAt }).from(deals).where(eq(deals.id, id));
          if (!current) throw new NotFoundException('Deal not found');
          if (current.funnelId === input.funnelId) delete patch.funnelId;
          else {
            if (current.lostAt) throw new ConflictException('This deal is lost. Reopen it before changing its funnel.');
            const first = await this.firstStage(tx, input.funnelId);
            const [funnel] = await tx.select({ label: funnels.label }).from(funnels).where(eq(funnels.id, input.funnelId));
            const now = new Date();
            Object.assign(patch, { stageId: first.id, stageEnteredAt: now, closedAt: first.isWon ? now : null });
            funnelChange = { from: current.stageId, to: first, funnel: funnel?.label ?? 'another funnel', at: now };
          }
        }
        // Re-sending the current funnel leaves nothing to write (and Drizzle rejects an empty SET).
        const [row] = Object.keys(patch).length
          ? await tx.update(deals).set(patch).where(eq(deals.id, id)).returning()
          : await tx.select().from(deals).where(eq(deals.id, id));
        if (!row) throw new NotFoundException('Deal not found');
        if (funnelChange) {
          const { from, to, funnel, at } = funnelChange;
          await this.history.record(tx, ctx, { dealId: id, kind: 'funnel_changed', fromStageId: from, toStageId: to.id, outcome: to.isWon ? 'won' : 'open' }, at);
          await this.log(tx, ctx, id, 'NT', `Moved to funnel ${funnel}`, `Restarted at ${to.name} · next activity: ${to.activity}`);
        }
        if (before) await this.notifyAssigned(tx, ctx, id, before.ownerUserId, row.ownerUserId);
        await this.audit.record(tx, ctx, { action: 'deal.updated', entityType: 'deal', entityId: id, data: input });
        return this.present(tx, row);
      })
      .catch(mapDbError);
  }

  /**
   * When a deal gets a new owner who isn't the person making the change, tells the notifications
   * module (job "crm.deal-assigned", in this transaction), which emails them if they want that.
   */
  private async notifyAssigned(tx: Tx, ctx: TenantContext, dealId: string, from: string | null, to: string | null) {
    if (!to || to === from || to === ctx.userId) return;
    await this.jobs.send('crm.deal-assigned', { tenantId: ctx.tenantId, dealId, assigneeUserId: to, actorUserId: ctx.userId }, tx);
  }

  /**
   * Moves a deal to another stage of its funnel. Entering the won stage enqueues the
   * "crm.deal-won" job in the same transaction (the future sales → delivery handover).
   */
  moveToStage(ctx: TenantContext, id: string, stageId: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [deal] = await tx.select().from(deals).where(eq(deals.id, id));
        if (!deal) throw new NotFoundException('Deal not found');
        const [stage] = await tx
          .select()
          .from(funnelStages)
          .where(and(eq(funnelStages.id, stageId), eq(funnelStages.funnelId, deal.funnelId), isNull(funnelStages.deletedAt)));
        if (!stage) throw new BadRequestException("Stage does not belong to this deal's funnel");
        if (deal.lostAt) throw new ConflictException('This deal is lost. Reopen it before moving it to another stage.');
        if (stage.id === deal.stageId) return { ...deal, outcome: dealOutcome(deal, stage.isWon) };

        const now = new Date();
        const [row] = await tx
          .update(deals)
          .set({ stageId: stage.id, stageEnteredAt: now, closedAt: stage.isWon ? now : null })
          .where(eq(deals.id, id))
          .returning();
        await this.history.record(tx, ctx, { dealId: id, kind: 'moved', fromStageId: deal.stageId, toStageId: stage.id, outcome: stage.isWon ? 'won' : 'open' }, now);
        await this.log(tx, ctx, id, stage.channel, `Moved to ${stage.name}`, `Next activity: ${stage.activity}`);
        await this.audit.record(tx, ctx, { action: 'deal.stage_changed', entityType: 'deal', entityId: id, data: { from: deal.stageId, to: stage.id } });
        if (stage.isWon) await this.jobs.send('crm.deal-won', { tenantId: ctx.tenantId, dealId: id, actorUserId: ctx.userId }, tx);
        return { ...row!, outcome: dealOutcome(row!, stage.isWon) };
      })
      .catch(mapDbError);
  }

  /**
   * Marks an open deal as lost, with a reason from the pick list and an optional note. The deal
   * keeps its stage (where it was lost). A won deal has to leave the won stage first.
   */
  markLost(ctx: TenantContext, id: string, input: MarkLost) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [current] = await tx
          .select({ deal: deals, stageIsWon: funnelStages.isWon })
          .from(deals)
          .innerJoin(funnelStages, eq(funnelStages.id, deals.stageId))
          .where(eq(deals.id, id));
        if (!current) throw new NotFoundException('Deal not found');
        const { deal, stageIsWon } = current;
        if (deal.lostAt) throw new ConflictException('This deal is already marked as lost.');
        if (stageIsWon) throw new ConflictException("A won deal can't be marked as lost. Move it out of the won stage first.");

        const now = new Date();
        const [row] = await tx
          .update(deals)
          .set({ lostAt: now, lostReason: input.reason, lostNote: input.note ?? null })
          .where(eq(deals.id, id))
          .returning();
        await this.history.record(tx, ctx, { dealId: id, kind: 'lost', fromStageId: deal.stageId, toStageId: deal.stageId, outcome: 'lost' }, now);
        await this.log(tx, ctx, id, 'NT', `Marked as lost: ${input.reason}`, input.note ?? null);
        await this.audit.record(tx, ctx, { action: 'deal.lost', entityType: 'deal', entityId: id, data: input });
        return { ...row!, outcome: dealOutcome(row!, false) };
      })
      .catch(mapDbError);
  }

  /** Reopens a lost deal in the stage it was lost in; the reason and note are cleared. */
  reopen(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [current] = await tx
          .select({ deal: deals, stage: funnelStages })
          .from(deals)
          .innerJoin(funnelStages, eq(funnelStages.id, deals.stageId))
          .where(eq(deals.id, id));
        if (!current) throw new NotFoundException('Deal not found');
        const { deal, stage } = current;
        if (!deal.lostAt) throw new ConflictException('Only lost deals can be reopened.');

        const now = new Date();
        const [row] = await tx.update(deals).set({ lostAt: null, lostReason: null, lostNote: null }).where(eq(deals.id, id)).returning();
        const outcome = dealOutcome(row!, stage.isWon);
        await this.history.record(tx, ctx, { dealId: id, kind: 'reopened', fromStageId: deal.stageId, toStageId: deal.stageId, outcome }, now);
        await this.log(tx, ctx, id, 'NT', 'Reopened', `Back in ${stage.name} (was lost: ${deal.lostReason})`);
        await this.audit.record(tx, ctx, { action: 'deal.reopened', entityType: 'deal', entityId: id });
        return { ...row!, outcome };
      })
      .catch(mapDbError);
  }

  linkContact(ctx: TenantContext, dealId: string, contactId: string) {
    return this.database
      .withTenant(ctx.tenantId, (tx) =>
        tx.insert(dealContacts).values({ tenantId: ctx.tenantId, dealId, contactId }).onConflictDoNothing(),
      )
      .then(() => undefined)
      .catch(mapDbError);
  }

  unlinkContact(ctx: TenantContext, dealId: string, contactId: string) {
    return this.database
      .withTenant(ctx.tenantId, (tx) =>
        tx.delete(dealContacts).where(and(eq(dealContacts.dealId, dealId), eq(dealContacts.contactId, contactId))),
      )
      .then(() => undefined);
  }

  /** Deleting a deal also deletes its lines, to-dos, activities and contact links (FK cascade). */
  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.delete(deals).where(eq(deals.id, id)).returning({ id: deals.id });
        if (!row) throw new NotFoundException('Deal not found');
        await this.audit.record(tx, ctx, { action: 'deal.deleted', entityType: 'deal', entityId: id });
      })
      .catch(mapDbError);
  }

  /** A deal row with its outcome (see dealOutcome). */
  private async present(tx: Tx, deal: typeof deals.$inferSelect) {
    const [stage] = await tx.select({ isWon: funnelStages.isWon }).from(funnelStages).where(eq(funnelStages.id, deal.stageId));
    return { ...deal, outcome: dealOutcome(deal, !!stage?.isWon) };
  }

  /** The first stage of a funnel: where new deals start, and where a funnel change restarts one. */
  private async firstStage(tx: Tx, funnelId: string) {
    const [first] = await tx.select().from(funnelStages).where(and(eq(funnelStages.funnelId, funnelId), isNull(funnelStages.deletedAt))).orderBy(asc(funnelStages.position)).limit(1);
    if (!first) throw new BadRequestException('Funnel has no stages');
    return first;
  }

  private async log(tx: Tx, ctx: TenantContext, dealId: string, channel: (typeof activities.$inferInsert)['channel'], title: string, detail: string | null) {
    await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel, title, detail });
  }
}
