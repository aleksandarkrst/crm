import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, companies, contacts, dealContacts, deals, funnelStages } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { optionalText, PaginationQuery } from '../../../shared/validation/common';
import { assertOwnerIsMember } from '../owner';

const money = z.union([z.number(), z.string()]).transform((v) => String(v)).pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Invalid amount'));
const champLevel = z.union([z.literal(0), z.literal(8), z.literal(17), z.literal(25)]);

export const CreateDeal = z.object({
  title: z.string().trim().min(1).max(200),
  funnelId: z.uuid(),
  companyId: z.uuid().nullish(),
  primaryContactId: z.uuid().nullish(),
  ownerUserId: z.uuid().nullish(),
  source: optionalText(80),
  amount: money.optional(),
  closeDate: z.iso.date().nullish(),
  // Discovery notes (proposal "What you told us"). Empty text clears a field.
  headline: optionalText(200),
  need: optionalText(1000),
  constraint: optionalText(500),
  decisionMaker: optionalText(200),
  discoveryDate: z.iso.date().nullish(),
});
export const UpdateDeal = CreateDeal.partial().extend({
  champ: z.object({ C: champLevel, H: champLevel, M: champLevel, P: champLevel }).optional(),
});
export const MoveDeal = z.object({ stageId: z.uuid() });
export const DealsQuery = PaginationQuery.extend({
  funnelId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  ownerUserId: z.uuid().optional(),
});
export type CreateDeal = z.infer<typeof CreateDeal>;
export type UpdateDeal = z.infer<typeof UpdateDeal>;
export type DealsQuery = z.infer<typeof DealsQuery>;
export type MoveDeal = z.infer<typeof MoveDeal>;

@Injectable()
export class DealsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  /** Board/list view: deals with company, primary contact and stage names joined in. */
  list(ctx: TenantContext, query: DealsQuery) {
    const filters: (SQL | undefined)[] = [];
    if (query.funnelId) filters.push(eq(deals.funnelId, query.funnelId));
    if (query.stageId) filters.push(eq(deals.stageId, query.stageId));
    if (query.companyId) filters.push(eq(deals.companyId, query.companyId));
    if (query.ownerUserId) filters.push(eq(deals.ownerUserId, query.ownerUserId));
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
      return rows.map((r) => ({ ...r, contactIds: links.filter((l) => l.dealId === r.deal.id).map((l) => l.contactId) }));
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.select().from(deals).where(eq(deals.id, id));
      if (!row) throw new NotFoundException('Deal not found');
      const linked = await tx
        .select({ contact: contacts })
        .from(dealContacts)
        .innerJoin(contacts, eq(contacts.id, dealContacts.contactId))
        .where(eq(dealContacts.dealId, id));
      return { ...row, contacts: linked.map((l) => l.contact) };
    });
  }

  /** New deals start in the first stage of their funnel. */
  create(ctx: TenantContext, input: CreateDeal) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [first] = await tx
          .select({ id: funnelStages.id })
          .from(funnelStages)
          .where(eq(funnelStages.funnelId, input.funnelId))
          .orderBy(asc(funnelStages.position))
          .limit(1);
        if (!first) throw new BadRequestException('Funnel has no stages');
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        const [row] = await tx
          .insert(deals)
          .values({ ownerUserId: ctx.userId, ...input, tenantId: ctx.tenantId, stageId: first.id })
          .returning();
        await this.log(tx, ctx, row!.id, 'RS', 'Deal created', input.source ? `Source: ${input.source}` : null);
        await this.audit.record(tx, ctx, { action: 'deal.created', entityType: 'deal', entityId: row!.id });
        return row!;
      })
      .catch(mapDbError);
  }

  /** Changing the funnel (a different target persona) restarts the deal at that funnel's first stage. */
  update(ctx: TenantContext, id: string, input: UpdateDeal) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        const patch: Partial<typeof deals.$inferInsert> = { ...input };
        if (input.champ) patch.fitScore = input.champ.C + input.champ.H + input.champ.M + input.champ.P;
        if (input.funnelId) {
          const [current] = await tx.select({ funnelId: deals.funnelId }).from(deals).where(eq(deals.id, id));
          if (!current) throw new NotFoundException('Deal not found');
          if (current.funnelId === input.funnelId) delete patch.funnelId;
          else {
            const [first] = await tx
              .select({ id: funnelStages.id })
              .from(funnelStages)
              .where(eq(funnelStages.funnelId, input.funnelId))
              .orderBy(asc(funnelStages.position))
              .limit(1);
            if (!first) throw new BadRequestException('Funnel has no stages');
            Object.assign(patch, { stageId: first.id, stageEnteredAt: new Date(), closedAt: null });
          }
        }
        const [row] = await tx.update(deals).set(patch).where(eq(deals.id, id)).returning();
        if (!row) throw new NotFoundException('Deal not found');
        await this.audit.record(tx, ctx, { action: 'deal.updated', entityType: 'deal', entityId: id, data: input });
        return row;
      })
      .catch(mapDbError);
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
          .where(and(eq(funnelStages.id, stageId), eq(funnelStages.funnelId, deal.funnelId)));
        if (!stage) throw new BadRequestException("Stage does not belong to this deal's funnel");
        if (stage.id === deal.stageId) return deal;

        const now = new Date();
        const [row] = await tx
          .update(deals)
          .set({ stageId: stage.id, stageEnteredAt: now, closedAt: stage.isWon ? now : null })
          .where(eq(deals.id, id))
          .returning();
        await this.log(tx, ctx, id, stage.channel, `Moved to ${stage.name}`, `Next activity: ${stage.activity}`);
        await this.audit.record(tx, ctx, { action: 'deal.stage_changed', entityType: 'deal', entityId: id, data: { from: deal.stageId, to: stage.id } });
        if (stage.isWon) await this.jobs.send('crm.deal-won', { tenantId: ctx.tenantId, dealId: id, actorUserId: ctx.userId }, tx);
        return row!;
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

  private async log(tx: Tx, ctx: TenantContext, dealId: string, channel: (typeof activities.$inferInsert)['channel'], title: string, detail: string | null) {
    await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel, title, detail });
  }
}
