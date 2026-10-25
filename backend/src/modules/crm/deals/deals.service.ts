import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, not, or, type SQL, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, companies, contacts, DEAL_OUTCOMES, SALE_TYPES, dealContacts, dealDocuments, type DealOutcome, deals, dealStageStates, dealTasks, funnels, funnelStages, LOST_REASONS, meetings, QUALIFICATION_STEPS, tenants } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { ListQuery, nonEmptyPatch, optionalText } from '../../../shared/validation/common';
import { currencyCode } from '../currency';
import { CustomFieldsService, CustomFieldValuesInput } from '../custom-fields/custom-fields.service';
import { opportunityReadiness } from '../companies/company-status';
import { CompanyStatusService } from '../companies/company-status.service';
import { assertOwnerIsMember, userNameOf } from '../owner';
import { RecordHistoryService } from '../history/record-history.service';
import { APPROVAL_STATUSES, approvalStatus, approvalStatusSql, resetApproval } from './proposal-approval';
import { StageHistoryService } from './stage-history.service';
import { advanceBlockers, skipBlocker, stageLateDays, wonBlocker } from './stage-gate';

const money = z.union([z.number(), z.string()]).transform((v) => String(v)).pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Invalid amount'));
// CHAMP and the fit score are switched off (CD-362); the columns stay until a later contract migration.
// const champLevel = z.union([z.literal(0), z.literal(8), z.literal(17), z.literal(25)]);
const currency = currencyCode;

export const CreateDeal = z.object({
  title: z.string().trim().min(1).max(200),
  funnelId: z.uuid(),
  // Every opportunity has a company, and only one that is an opportunity or a client (CD-360).
  companyId: z.uuid(),
  /** Capital or transactional (CD-360); the New opportunity dialog asks for it. */
  saleType: z.enum(SALE_TYPES).nullish(),
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
  /** Custom field values by field id (CD-15); null or '' clears one. */
  customFields: CustomFieldValuesInput,
});
export const UpdateDeal = nonEmptyPatch(
  CreateDeal.partial().extend({
    // champ: z.object({ C: champLevel, H: champLevel, M: champLevel, P: champLevel }).optional(),
    // Qualification (CD-362). Empty text and null clear a field; the steps are replaced as a whole.
    sponsorContactId: z.uuid().nullish(),
    powerSponsorContactId: z.uuid().nullish(),
    pain: optionalText(2000),
    painSolution: optionalText(2000),
    qualificationSteps: z.array(z.enum(QUALIFICATION_STEPS)).transform((steps) => [...new Set(steps)]).optional(),
    qualificationOther: optionalText(1000),
    /** The Qualified switch: the server records who turned it on and when. */
    qualified: z.boolean().optional(),
  }),
);
export const MoveDeal = z.object({ stageId: z.uuid() });
export const MarkLost = z.object({ reason: z.enum(LOST_REASONS), note: optionalText(1000) });
export const DealsQuery = ListQuery.extend({
  funnelId: z.uuid().optional(),
  stageId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  ownerUserId: z.uuid().optional(),
  outcome: z.enum(DEAL_OUTCOMES).optional(),
  saleType: z.enum(SALE_TYPES).optional(),
  /** Its proposal's approval (CD-120), whatever the stage. */
  approvalStatus: z.enum(APPROVAL_STATUSES).optional(),
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

/** Days past the stage's target (CD-363); won and lost deals are never late. */
const lateDaysOf = (deal: { lostAt: Date | null; stageEnteredAt: Date }, isWon: boolean, targetDays: number | null, now: Date): number =>
  isWon || deal.lostAt ? 0 : stageLateDays(deal.stageEnteredAt, targetDays, now);

/**
 * Only a company that is an opportunity or a client can enter the Pipeline (CD-360): a lead is a
 * 409 with what it still misses (the company page's list), and so is a Not interested company that
 * isn't complete (set back from Lead by hand, it would slip past otherwise). Opportunities, clients
 * and past clients pass; a company of another workspace is a 400.
 */
async function assertCanEnterPipeline(tx: Tx, companyId: string) {
  // Locked while it decides: a concurrent change of its status (set back to Lead) waits for this deal.
  // `for update`, not `for share`: the status recompute later in the transaction takes this lock anyway,
  // and two shared holders upgrading at once deadlock.
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for('update');
  if (!company) throw new BadRequestException('Pick a company of this workspace');
  if (company.status !== 'lead' && company.status !== 'not_interested') return;
  const people = await tx.select().from(contacts).where(eq(contacts.companyId, companyId));
  const { blockers } = opportunityReadiness(company, people);
  if (company.status === 'not_interested' && !blockers.length) return;
  const missing = blockers.length ? `: ${blockers.length === 1 ? '1 thing is' : `${blockers.length} things are`} missing` : ' (it was set back to Lead by hand)';
  throw new ConflictException({
    message: `${company.name} ${company.status === 'lead' ? 'is still a lead' : "is Not interested and isn't complete"}. Only an opportunity or a client can enter the Pipeline${missing}.`,
    blockers,
  });
}

@Injectable()
export class DealsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly history: StageHistoryService,
    private readonly customFields: CustomFieldsService,
    private readonly storage: StorageService,
    private readonly changes: RecordHistoryService,
    private readonly status: CompanyStatusService,
  ) {}

  /** Board/list view: deals with company, primary contact and stage names joined in. */
  list(ctx: TenantContext, query: DealsQuery) {
    const filters: (SQL | undefined)[] = [];
    if (query.funnelId) filters.push(eq(deals.funnelId, query.funnelId));
    if (query.stageId) filters.push(eq(deals.stageId, query.stageId));
    if (query.companyId) filters.push(eq(deals.companyId, query.companyId));
    if (query.ownerUserId) filters.push(eq(deals.ownerUserId, query.ownerUserId));
    if (query.saleType) filters.push(eq(deals.saleType, query.saleType));
    if (query.ids) filters.push(inArray(deals.id, query.ids));
    if (query.outcome === 'lost') filters.push(isNotNull(deals.lostAt));
    else if (query.outcome) filters.push(isNull(deals.lostAt), query.outcome === 'won' ? eq(funnelStages.isWon, true) : not(funnelStages.isWon));
    if (query.approvalStatus) filters.push(sql`${approvalStatusSql} = ${query.approvalStatus}`);
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
          // The stage's own target, else the funnel's (CD-363): "late" on the Pipeline card.
          stageTargetDays: sql<number | null>`coalesce(${funnelStages.targetDays}, ${funnels.targetDays})`,
          funnelApproval: funnels.proposalApproval,
          ownerName: userNameOf(deals.ownerUserId),
        })
        .from(deals)
        .innerJoin(funnelStages, eq(funnelStages.id, deals.stageId))
        .innerJoin(funnels, eq(funnels.id, deals.funnelId))
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
      // Each deal's "documentation complete" per stage (CD-363), for the gate on the deal screen.
      const states = await tx
        .select({ dealId: dealStageStates.dealId, stageId: dealStageStates.stageId, docsComplete: dealStageStates.docsComplete, docsCompleteAt: dealStageStates.docsCompleteAt, docsCompleteByUserId: dealStageStates.docsCompleteByUserId })
        .from(dealStageStates)
        .where(inArray(dealStageStates.dealId, rows.map((r) => r.deal.id)));
      const now = new Date();
      return rows.map(({ stageIsWon, stageTargetDays, funnelApproval, ...r }) => ({
        ...r,
        deal: {
          ...r.deal,
          outcome: dealOutcome(r.deal, stageIsWon),
          approvalStatus: approvalStatus(funnelApproval, r.deal),
          stageLateDays: lateDaysOf(r.deal, stageIsWon, stageTargetDays, now),
          stageStates: states.filter((st) => st.dealId === r.deal.id).map(({ dealId: _, ...st }) => st),
        },
        contactIds: links.filter((l) => l.dealId === r.deal.id).map((l) => l.contactId),
      }));
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [found] = await tx.select().from(deals).where(eq(deals.id, id));
      if (!found) throw new NotFoundException('Opportunity not found');
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
        await assertCanEnterPipeline(tx, input.companyId);
        // A create that sends custom field values (the New deal dialog) must fill the required ones.
        const { customFields: cfInput, ...fields } = input;
        const cf = await this.customFields.validate(tx, 'deal', cfInput, { requireAll: cfInput !== undefined });
        // tenants is a platform table without RLS, so filter by the caller's tenant explicitly.
        const [workspace] = await tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, ctx.tenantId));
        const [row] = await tx
          .insert(deals)
          .values({ ownerUserId: ctx.userId, currency: workspace?.currency, ...fields, customFields: cf.set, tenantId: ctx.tenantId, stageId: first.id, closedAt: first.isWon ? new Date() : null })
          .returning();
        await this.history.record(tx, ctx, { dealId: row!.id, kind: 'created', fromStageId: null, toStageId: first.id, outcome: first.isWon ? 'won' : 'open' }, row!.createdAt);
        await this.log(tx, ctx, row!.id, null, 'Opportunity created', input.source ? `Source: ${input.source}` : null);
        await this.audit.record(tx, ctx, { action: 'deal.created', entityType: 'deal', entityId: row!.id });
        await this.notifyAssigned(tx, ctx, row!.id, null, row!.ownerUserId);
        await this.status.recompute(tx, ctx, [row!.companyId]);
        return { ...row!, outcome: dealOutcome(row!, first.isWon) };
      })
      .catch(mapDbError);
  }

  /**
   * Changing the funnel (a different target persona) restarts the deal at that funnel's first
   * stage, and says so on the timeline ("Moved to funnel …"). With a `version` (If-Match), a field
   * someone else changed since that version is a 409 conflict (RecordHistoryService).
   */
  update(ctx: TenantContext, id: string, input: UpdateDeal, version?: Date) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        if (version) {
          const [locked] = await tx.select().from(deals).where(eq(deals.id, id)).for('update');
          if (!locked) throw new NotFoundException('Opportunity not found');
          await this.changes.assertNoConflict(tx, ctx, 'deal', locked, input, version);
        }
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        const [before] = await tx.select({ ownerUserId: deals.ownerUserId, companyId: deals.companyId }).from(deals).where(eq(deals.id, id));
        if (!before) throw new NotFoundException('Opportunity not found');
        // Another company: it must be able to enter the Pipeline too (CD-360).
        if (input.companyId && input.companyId !== before.companyId) {
          // Both companies in id order, as the status recompute takes them, so opposite moves can't deadlock.
          const both = [before.companyId, input.companyId].filter((c): c is string => !!c);
          await tx.select({ id: companies.id }).from(companies).where(inArray(companies.id, both)).orderBy(companies.id).for('update');
          await assertCanEnterPipeline(tx, input.companyId);
        }
        await this.assertContactsExist(tx, [input.sponsorContactId, input.powerSponsorContactId]);
        const { customFields: cfInput, qualified, ...fields } = input;
        const patch: PgUpdateSetSource<typeof deals> = { ...fields };
        if (cfInput !== undefined) patch.customFields = this.customFields.merged(deals.customFields, await this.customFields.validate(tx, 'deal', cfInput));
        // if (input.champ) patch.fitScore = input.champ.C + input.champ.H + input.champ.M + input.champ.P;
        let qualifiedChange: boolean | null = null;
        if (qualified !== undefined) {
          const [current] = await tx.select({ qualifiedAt: deals.qualifiedAt }).from(deals).where(eq(deals.id, id));
          if (!current) throw new NotFoundException('Opportunity not found');
          // Turning it on again keeps the first author and date; only a real change is logged.
          if (qualified !== !!current.qualifiedAt) {
            Object.assign(patch, qualified ? { qualifiedAt: new Date(), qualifiedByUserId: ctx.userId } : { qualifiedAt: null, qualifiedByUserId: null });
            qualifiedChange = qualified;
          }
        }
        let funnelChange: { from: string; to: typeof funnelStages.$inferSelect; funnel: string; at: Date } | null = null;
        if (input.funnelId) {
          const [current] = await tx.select({ funnelId: deals.funnelId, stageId: deals.stageId, lostAt: deals.lostAt }).from(deals).where(eq(deals.id, id));
          if (!current) throw new NotFoundException('Opportunity not found');
          if (current.funnelId === input.funnelId) delete patch.funnelId;
          else {
            if (current.lostAt) throw new ConflictException('This opportunity is lost. Reopen it before changing its funnel.');
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
        if (!row) throw new NotFoundException('Opportunity not found');
        if (funnelChange) {
          const { from, to, funnel, at } = funnelChange;
          await this.history.record(tx, ctx, { dealId: id, kind: 'funnel_changed', fromStageId: from, toStageId: to.id, outcome: to.isWon ? 'won' : 'open' }, at);
          await this.log(tx, ctx, id, null, `Moved to funnel ${funnel}`, `Restarted at ${to.name} · next activity: ${to.activity}`);
          // Approval is the funnel's (CD-120): the new one asks again, its own approver.
          await resetApproval(tx, ctx, id, `Moved to funnel ${funnel}`);
        }
        if (qualifiedChange !== null) await this.log(tx, ctx, id, null, qualifiedChange ? 'Marked Qualified' : 'No longer Qualified', null);
        if (before && input.ownerUserId !== undefined) await this.notifyAssigned(tx, ctx, id, before.ownerUserId, row.ownerUserId);
        await this.audit.record(tx, ctx, { action: 'deal.updated', entityType: 'deal', entityId: id, data: input });
        // Another company, or a funnel change into a won stage, moves the company status (CD-358).
        if (before?.companyId !== row.companyId || funnelChange) await this.status.recompute(tx, ctx, [before?.companyId, row.companyId]);
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
        if (!deal) throw new NotFoundException('Opportunity not found');
        const [stage] = await tx
          .select()
          .from(funnelStages)
          .where(and(eq(funnelStages.id, stageId), eq(funnelStages.funnelId, deal.funnelId), isNull(funnelStages.deletedAt)));
        if (!stage) throw new BadRequestException("Stage does not belong to this opportunity's funnel");
        if (deal.lostAt) throw new ConflictException('This opportunity is lost. Reopen it before moving it to another stage.');
        if (stage.id === deal.stageId) return { ...deal, outcome: dealOutcome(deal, stage.isWon) };
        await this.assertCanAdvance(tx, deal, stage);

        const now = new Date();
        const [row] = await tx
          .update(deals)
          .set({ stageId: stage.id, stageEnteredAt: now, closedAt: stage.isWon ? now : null })
          .where(eq(deals.id, id))
          .returning();
        await this.history.record(tx, ctx, { dealId: id, kind: 'moved', fromStageId: deal.stageId, toStageId: stage.id, outcome: stage.isWon ? 'won' : 'open' }, now);
        await this.log(tx, ctx, id, null, `Moved to ${stage.name}`, `Next activity: ${stage.activity}`);
        await this.audit.record(tx, ctx, { action: 'deal.stage_changed', entityType: 'deal', entityId: id, data: { from: deal.stageId, to: stage.id } });
        if (stage.isWon) await this.jobs.send('crm.deal-won', { tenantId: ctx.tenantId, dealId: id, actorUserId: ctx.userId }, tx);
        await this.status.recompute(tx, ctx, [deal.companyId]);
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
        if (!current) throw new NotFoundException('Opportunity not found');
        const { deal, stageIsWon } = current;
        if (deal.lostAt) throw new ConflictException('This opportunity is already marked as lost.');
        if (stageIsWon) throw new ConflictException("A won opportunity can't be marked as lost. Move it out of the won stage first.");

        const now = new Date();
        const [row] = await tx
          .update(deals)
          .set({ lostAt: now, lostReason: input.reason, lostNote: input.note ?? null })
          .where(eq(deals.id, id))
          .returning();
        await this.history.record(tx, ctx, { dealId: id, kind: 'lost', fromStageId: deal.stageId, toStageId: deal.stageId, outcome: 'lost' }, now);
        await this.log(tx, ctx, id, 'NT', `Marked as lost: ${input.reason}`, input.note ?? null);
        await this.audit.record(tx, ctx, { action: 'deal.lost', entityType: 'deal', entityId: id, data: input });
        await this.status.recompute(tx, ctx, [deal.companyId]);
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
        if (!current) throw new NotFoundException('Opportunity not found');
        const { deal, stage } = current;
        if (!deal.lostAt) throw new ConflictException('Only lost opportunities can be reopened.');

        const now = new Date();
        const [row] = await tx.update(deals).set({ lostAt: null, lostReason: null, lostNote: null }).where(eq(deals.id, id)).returning();
        const outcome = dealOutcome(row!, stage.isWon);
        await this.history.record(tx, ctx, { dealId: id, kind: 'reopened', fromStageId: deal.stageId, toStageId: deal.stageId, outcome }, now);
        await this.log(tx, ctx, id, 'NT', 'Reopened', `Back in ${stage.name} (was lost: ${deal.lostReason})`);
        await this.audit.record(tx, ctx, { action: 'deal.reopened', entityType: 'deal', entityId: id });
        await this.status.recompute(tx, ctx, [deal.companyId]);
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

  /**
   * Deleting a deal also deletes its lines, to-dos, activities, contact links and generated
   * documents (FK cascade); the documents' files are removed once that has committed. A deal with
   * meetings can't be deleted (409, CD-213): every meeting needs a deal, so they have to be deleted
   * or moved to another deal first (the foreign key backs this up).
   */
  async remove(ctx: TenantContext, id: string) {
    const files = await this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [deal] = await tx.select({ title: deals.title, companyId: deals.companyId }).from(deals).where(eq(deals.id, id));
        if (!deal) throw new NotFoundException('Opportunity not found');
        const [booked] = await tx.select({ n: count() }).from(meetings).where(eq(meetings.dealId, id));
        if (booked && booked.n > 0) {
          const what = booked.n === 1 ? '1 meeting' : `${booked.n} meetings`;
          throw new ConflictException(`${deal.title} has ${what}. Delete them or move them to another opportunity first.`);
        }
        const docs = await tx.select({ key: dealDocuments.storageKey }).from(dealDocuments).where(eq(dealDocuments.dealId, id));
        const [row] = await tx.delete(deals).where(eq(deals.id, id)).returning({ id: deals.id });
        if (!row) throw new NotFoundException('Opportunity not found');
        await this.audit.record(tx, ctx, { action: 'deal.deleted', entityType: 'deal', entityId: id });
        await this.status.recompute(tx, ctx, [deal.companyId]);
        return docs.flatMap((d) => (d.key ? [d.key] : []));
      })
      .catch(mapDbError);
    for (const key of files) await this.storage.delete(ctx.tenantId, key);
  }

  /**
   * A deal as the API answers it: its outcome, how many days it is past its stage's target
   * (CD-363), and its state in each stage ("documentation complete", who and when).
   */
  private async present(tx: Tx, deal: typeof deals.$inferSelect) {
    const [stage] = await tx
      .select({ isWon: funnelStages.isWon, targetDays: sql<number | null>`coalesce(${funnelStages.targetDays}, ${funnels.targetDays})`, approval: funnels.proposalApproval })
      .from(funnelStages)
      .innerJoin(funnels, eq(funnels.id, funnelStages.funnelId))
      .where(eq(funnelStages.id, deal.stageId));
    const stageStates = await tx
      .select({ stageId: dealStageStates.stageId, docsComplete: dealStageStates.docsComplete, docsCompleteAt: dealStageStates.docsCompleteAt, docsCompleteByUserId: dealStageStates.docsCompleteByUserId })
      .from(dealStageStates)
      .where(eq(dealStageStates.dealId, deal.id));
    return { ...deal, outcome: dealOutcome(deal, !!stage?.isWon), approvalStatus: approvalStatus(!!stage?.approval, deal), stageLateDays: lateDaysOf(deal, !!stage?.isWon, stage?.targetDays ?? null, new Date()), stageStates };
  }

  /**
   * "Remind the owner" (CD-363): queues an email to whoever answers for the deal's stage (the stage
   * owner, else the deal's owner) and notes it on the timeline. Not for won or lost deals, and once an
   * hour per stage at most: the timeline entry is what it checks.
   */
  remindStageOwner(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .select({ ownerUserId: deals.ownerUserId, lostAt: deals.lostAt, stageOwnerUserId: funnelStages.ownerUserId, stageName: funnelStages.name, isWon: funnelStages.isWon })
          .from(deals)
          .innerJoin(funnelStages, eq(funnelStages.id, deals.stageId))
          .where(eq(deals.id, id));
        if (!row) throw new NotFoundException('Opportunity not found');
        if (row.isWon || row.lostAt) throw new ConflictException('This opportunity is closed; there is nothing to remind anyone about.');
        const recipientUserId = row.stageOwnerUserId ?? row.ownerUserId;
        if (!recipientUserId) throw new ConflictException('Nobody owns this stage or this opportunity yet. Pick an owner first.');
        if (recipientUserId === ctx.userId) throw new BadRequestException('You are the owner here, so there is nobody to remind.');
        const title = `Reminded the owner of ${row.stageName}`;
        const [recent] = await tx
          .select({ id: activities.id })
          .from(activities)
          .where(and(eq(activities.dealId, id), eq(activities.title, title), sql`${activities.createdAt} > now() - interval '1 hour'`))
          .limit(1);
        if (recent) throw new ConflictException('The owner was reminded less than an hour ago. Give them a little time.');
        await this.jobs.send('crm.stage-reminder', { tenantId: ctx.tenantId, dealId: id, recipientUserId, actorUserId: ctx.userId }, tx);
        await this.log(tx, ctx, id, null, title, null);
        return { recipientUserId };
      })
      .catch(mapDbError);
  }

  /**
   * The advance gate (CD-363): a forward move needs the current stage's gates to pass, and in a gated
   * funnel Won is reached only from the last stage before it. Backward moves pass. 409 with the reasons.
   */
  private async assertCanAdvance(tx: Tx, deal: typeof deals.$inferSelect, target: typeof funnelStages.$inferSelect) {
    const stages = await tx.select().from(funnelStages).where(and(eq(funnelStages.funnelId, deal.funnelId), isNull(funnelStages.deletedAt)));
    const current = stages.find((s) => s.id === deal.stageId);
    if (!current || target.position <= current.position) return;
    const [tasks, [state]] = await Promise.all([
      tx
        .select({ checklistItemId: dealTasks.checklistItemId, offPlaybook: dealTasks.offPlaybook, blocksAdvance: dealTasks.blocksAdvance, done: dealTasks.done })
        .from(dealTasks)
        .where(and(eq(dealTasks.dealId, deal.id), eq(dealTasks.stageId, current.id))),
      tx.select({ docsComplete: dealStageStates.docsComplete }).from(dealStageStates).where(and(eq(dealStageStates.dealId, deal.id), eq(dealStageStates.stageId, current.id))),
    ]);
    const blockers = advanceBlockers({ stage: current, tasks, stageState: state ?? null });
    const route = target.isWon ? wonBlocker(current, stages) : skipBlocker(current, target, stages);
    if (route) blockers.unshift(route);
    if (blockers.length) throw new ConflictException({ message: `This opportunity can't move to ${target.name} yet: ${blockers.join('; ')}.`, blockers });
  }

  /** The first stage of a funnel: where new deals start, and where a funnel change restarts one. */
  private async firstStage(tx: Tx, funnelId: string) {
    const [first] = await tx.select().from(funnelStages).where(and(eq(funnelStages.funnelId, funnelId), isNull(funnelStages.deletedAt))).orderBy(asc(funnelStages.position)).limit(1);
    if (!first) throw new BadRequestException('Funnel has no stages');
    return first;
  }

  /** Sponsors are this workspace's contacts (RLS hides the others, so they read as missing). */
  private async assertContactsExist(tx: Tx, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((v): v is string => !!v))];
    if (!wanted.length) return;
    const found = await tx.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, wanted));
    if (found.length !== wanted.length) throw new BadRequestException('Contact not found');
  }

  private async log(tx: Tx, ctx: TenantContext, dealId: string, channel: (typeof activities.$inferInsert)['channel'], title: string, detail: string | null) {
    await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel, title, detail });
  }
}
