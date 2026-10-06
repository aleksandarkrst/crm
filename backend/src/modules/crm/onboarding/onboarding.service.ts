import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import {
  activities,
  type BillingFrequency,
  auditLogs,
  companies,
  contacts,
  dealContacts,
  dealLines,
  deals,
  dealTasks,
  documentTemplates,
  funnels,
  funnelStages,
  invitations,
  meetings,
  memberships,
  products,
  SAMPLE_KINDS,
  type SampleKind,
  sampleRecords,
  tenants,
  visitPlanLines,
} from '../../../shared/database/schema';
import { StageHistoryService } from '../deals/stage-history.service';
import { SAMPLE_COMPANIES, SAMPLE_CONTACTS, SAMPLE_DEALS, SAMPLE_PRODUCTS, SAMPLE_SOURCE, type SampleDeal } from './sample-data';

/**
 * The workspace's activation steps (CD-115), in the order the checklist shows them: colleagues
 * invited, the first contact, company, product and deal added, the first document template set
 * up, and the first funnel set up.
 */
export const ONBOARDING_STEPS = ['invite', 'records', 'template', 'funnel'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
/** What "records" is made of: one of each, sample data not counted. */
export const ONBOARDING_RECORDS = ['contact', 'company', 'product', 'deal'] as const satisfies readonly SampleKind[];

/** Changes to the playbook that count as "set up your funnel". */
const FUNNEL_ACTIONS = ['funnel.created', 'funnel.updated', 'funnel.deleted', 'funnel.stage_created', 'funnel.stage_updated', 'funnel.stage_deleted', 'funnel.stages_reordered'];

type Counts = Record<SampleKind, number>;
const zeroCounts = (): Counts => ({ company: 0, contact: 0, product: 0, deal: 0 });
const DAY = 86_400_000;

/** The calendar date `days` from now in the workspace's time zone (what "due today" means there). */
const dateIn = (timeZone: string, days: number) => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(Date.now() + days * DAY));

/**
 * First-run onboarding (CD-68), for owners and admins: the getting-started checklist, whose steps
 * are derived from the workspace's own records (sample records don't count), its dismissal, and
 * the sample data that can be loaded and removed again in one click.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly history: StageHistoryService,
  ) {}

  async state(ctx: TenantContext) {
    const [membership] = await this.database.db
      .select({ dismissedAt: memberships.onboardingDismissedAt })
      .from(memberships)
      .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.userId)));
    // memberships and invitations have no RLS, so they are filtered by tenant here.
    const [{ members }] = (await this.database.db.select({ members: count() }).from(memberships).where(eq(memberships.tenantId, ctx.tenantId))) as [{ members: number }];
    const [{ invited }] = (await this.database.db
      .select({ invited: count() })
      .from(invitations)
      .where(and(eq(invitations.tenantId, ctx.tenantId), isNull(invitations.revokedAt)))) as [{ invited: number }];

    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const sample = await this.sampleIds(tx);
      const tables = { contact: contacts, company: companies, product: products, deal: deals };
      const records = {} as Record<SampleKind, boolean>;
      for (const kind of ONBOARDING_RECORDS) {
        const table = tables[kind];
        const ids = sample[kind];
        const [row] = await tx
          .select({ id: table.id })
          .from(table)
          .where(ids.length ? notInArray(table.id, ids) : undefined)
          .limit(1);
        records[kind] = Boolean(row);
      }
      const [template] = await tx.select({ id: documentTemplates.id }).from(documentTemplates).limit(1);
      const [funnelChange] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(inArray(auditLogs.action, FUNNEL_ACTIONS)).limit(1);
      const done: Record<OnboardingStep, boolean> = {
        invite: members > 1 || invited > 0,
        records: ONBOARDING_RECORDS.every((k) => records[k]),
        template: Boolean(template),
        funnel: Boolean(funnelChange),
      };
      const counts = zeroCounts();
      for (const kind of SAMPLE_KINDS) counts[kind] = sample[kind].length;
      return {
        steps: ONBOARDING_STEPS.map((key) => ({
          key,
          done: done[key],
          // The records step lists which of the four are there yet.
          ...(key === 'records' ? { items: ONBOARDING_RECORDS.map((k) => ({ key: k, done: records[k] })) } : {}),
        })),
        complete: ONBOARDING_STEPS.every((key) => done[key]),
        dismissed: Boolean(membership?.dismissedAt),
        sampleData: { loaded: SAMPLE_KINDS.some((k) => counts[k] > 0), counts },
      };
    });
  }

  /** Per user: each owner or admin finishes or dismisses their own checklist. */
  async dismiss(ctx: TenantContext, dismissed: boolean) {
    await this.database.db
      .update(memberships)
      .set({ onboardingDismissedAt: dismissed ? new Date() : null })
      .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.userId)));
    return this.state(ctx);
  }

  /** Creates the sample records in the first funnel, all in one transaction, and marks each of them. */
  async loadSampleData(ctx: TenantContext) {
    await this.database
      .withTenant(ctx.tenantId, async (tx) => {
        // Load and remove run one at a time per workspace (a double click can't load twice).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sample_data'), hashtext(${ctx.tenantId}))`);
        const [already] = await tx.select({ id: sampleRecords.recordId }).from(sampleRecords).limit(1);
        if (already) throw new ConflictException('Sample data is already loaded. Remove it first to load it again.');

        const [funnel] = await tx.select({ id: funnels.id }).from(funnels).orderBy(asc(funnels.position), asc(funnels.createdAt)).limit(1);
        if (!funnel) throw new ConflictException('This workspace has no funnel to put the sample deals in.');
        const stages = await tx
          .select()
          .from(funnelStages)
          .where(and(eq(funnelStages.funnelId, funnel.id), isNull(funnelStages.deletedAt)))
          .orderBy(asc(funnelStages.position));
        const open = stages.filter((s) => !s.isWon);
        const won = stages.find((s) => s.isWon);
        if (open.length === 0) throw new ConflictException('The first funnel has no open stages to put the sample deals in.');
        const [workspace] = await tx.select({ currency: tenants.currency, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
        const currency = workspace?.currency ?? 'EUR';
        const timezone = workspace?.timezone ?? 'UTC';
        const marks: { kind: SampleKind; recordId: string }[] = [];

        const productIds = new Map<string, { id: string; unitPrice: string; vatRate: string; billingFrequency: BillingFrequency; billingCycles: number | null }>();
        for (const { key, ...p } of SAMPLE_PRODUCTS) {
          const [row] = await tx.insert(products).values({ ...p, tenantId: ctx.tenantId }).returning({ id: products.id });
          productIds.set(key, { id: row!.id, unitPrice: p.unitPrice, vatRate: p.vatRate, billingFrequency: p.billingFrequency, billingCycles: p.billingCycles });
          marks.push({ kind: 'product', recordId: row!.id });
        }
        const companyIds = new Map<string, string>();
        for (const { key, ...c } of SAMPLE_COMPANIES) {
          const [row] = await tx
            .insert(companies)
            .values({ ...c, source: SAMPLE_SOURCE, ownerUserId: ctx.userId, tenantId: ctx.tenantId })
            .returning({ id: companies.id });
          companyIds.set(key, row!.id);
          marks.push({ kind: 'company', recordId: row!.id });
        }
        const contactIds = new Map<string, string>();
        for (const { key, company, ...c } of SAMPLE_CONTACTS) {
          const [row] = await tx
            .insert(contacts)
            .values({ ...c, companyId: companyIds.get(company)!, ownerUserId: ctx.userId, tenantId: ctx.tenantId })
            .returning({ id: contacts.id });
          contactIds.set(key, row!.id);
          marks.push({ kind: 'contact', recordId: row!.id });
        }
        for (const d of SAMPLE_DEALS) {
          const stage = d.stage === 'won' ? (won ?? open[open.length - 1]!) : open[Math.min(d.stage.open, open.length - 1)]!;
          const dealId = await this.sampleDeal(tx, ctx, d, { funnelId: funnel.id, first: stages[0]!, stage, currency, timezone, companyIds, contactIds, productIds });
          marks.push({ kind: 'deal', recordId: dealId });
        }
        await tx.insert(sampleRecords).values(marks.map((m) => ({ ...m, tenantId: ctx.tenantId })));
        await this.audit.record(tx, ctx, { action: 'sample_data.loaded', entityType: 'tenant', entityId: ctx.tenantId, data: { records: marks.length } });
      })
      .catch(mapDbError);
    return this.state(ctx);
  }

  /**
   * Deletes exactly the records the sample load created. Deals go with their lines, tasks,
   * activities and history. A sample company, contact or product that real records now use (a
   * real deal or a meeting at a sample company, say) is kept, and becomes an ordinary record. So is
   * a sample deal with meetings (a meeting can't lose its deal, CD-213).
   */
  async removeSampleData(ctx: TenantContext) {
    const result = await this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sample_data'), hashtext(${ctx.tenantId}))`);
        const ids = await this.sampleIds(tx);
        const removed = zeroCounts();
        const kept = zeroCounts();
        if (ids.deal.length) {
          // A meeting needs its deal (CD-213): a sample deal with meetings stays, and so do its company and contact.
          const used = await tx.select({ id: meetings.dealId }).from(meetings).where(inArray(meetings.dealId, ids.deal));
          const keep = new Set(used.flatMap((u) => (u.id ? [u.id] : [])));
          const drop = ids.deal.filter((id) => !keep.has(id));
          if (drop.length) removed.deal = (await tx.delete(deals).where(inArray(deals.id, drop)).returning({ id: deals.id })).length;
          kept.deal = keep.size;
        }

        if (ids.contact.length) {
          const used = await tx.select({ id: deals.primaryContactId }).from(deals).where(inArray(deals.primaryContactId, ids.contact));
          const keep = new Set(used.map((u) => u.id));
          const drop = ids.contact.filter((id) => !keep.has(id));
          if (drop.length) {
            await tx.delete(dealContacts).where(inArray(dealContacts.contactId, drop));
            removed.contact = (await tx.delete(contacts).where(inArray(contacts.id, drop)).returning({ id: contacts.id })).length;
          }
          kept.contact = keep.size;
        }
        if (ids.company.length) {
          const usedByDeals = await tx.select({ id: deals.companyId }).from(deals).where(inArray(deals.companyId, ids.company));
          const usedByContacts = await tx.select({ id: contacts.companyId }).from(contacts).where(inArray(contacts.companyId, ids.company));
          const usedByMeetings = await tx.select({ id: meetings.companyId }).from(meetings).where(inArray(meetings.companyId, ids.company));
          const usedByPlans = await tx.select({ id: visitPlanLines.companyId }).from(visitPlanLines).where(inArray(visitPlanLines.companyId, ids.company));
          const keep = new Set([...usedByDeals, ...usedByContacts, ...usedByMeetings, ...usedByPlans].map((u) => u.id));
          const drop = ids.company.filter((id) => !keep.has(id));
          if (drop.length) removed.company = (await tx.delete(companies).where(inArray(companies.id, drop)).returning({ id: companies.id })).length;
          kept.company = keep.size;
        }
        if (ids.product.length) {
          const used = await tx.select({ id: dealLines.productId }).from(dealLines).where(inArray(dealLines.productId, ids.product));
          const keep = new Set(used.map((u) => u.id));
          const drop = ids.product.filter((id) => !keep.has(id));
          if (drop.length) removed.product = (await tx.delete(products).where(inArray(products.id, drop)).returning({ id: products.id })).length;
          kept.product = keep.size;
        }
        await tx.delete(sampleRecords);
        await this.audit.record(tx, ctx, { action: 'sample_data.removed', entityType: 'tenant', entityId: ctx.tenantId, data: { removed, kept } });
        return { removed, kept };
      })
      .catch(mapDbError);
    return { ...result, state: await this.state(ctx) };
  }

  private async sampleIds(tx: Tx): Promise<Record<SampleKind, string[]>> {
    const ids: Record<SampleKind, string[]> = { company: [], contact: [], product: [], deal: [] };
    for (const r of await tx.select({ kind: sampleRecords.kind, id: sampleRecords.recordId }).from(sampleRecords)) ids[r.kind].push(r.id);
    return ids;
  }

  /** One sample deal with its lines, people, history, activities and task, as the app would make them. */
  private async sampleDeal(
    tx: Tx,
    ctx: TenantContext,
    d: SampleDeal,
    refs: {
      funnelId: string;
      first: typeof funnelStages.$inferSelect;
      stage: typeof funnelStages.$inferSelect;
      currency: string;
      timezone: string;
      companyIds: Map<string, string>;
      contactIds: Map<string, string>;
      productIds: Map<string, { id: string; unitPrice: string; vatRate: string; billingFrequency: BillingFrequency; billingCycles: number | null }>;
    },
  ): Promise<string> {
    const now = Date.now();
    const at = (days: number) => new Date(now - days * DAY);
    const created = at(d.ageDays);
    const moved = d.stage !== 'won' && refs.stage.id === refs.first.id ? created : at(Math.max(1, Math.floor(d.ageDays / 2)));
    const isWon = refs.stage.isWon;
    const amount = d.lines.reduce((sum, l) => sum + l.quantity * Number(refs.productIds.get(l.product)!.unitPrice), 0);
    const [deal] = await tx
      .insert(deals)
      .values({
        tenantId: ctx.tenantId,
        title: d.title,
        funnelId: refs.funnelId,
        stageId: refs.stage.id,
        companyId: refs.companyIds.get(d.company)!,
        primaryContactId: refs.contactIds.get(d.contact)!,
        ownerUserId: ctx.userId,
        source: SAMPLE_SOURCE,
        amount: amount.toFixed(2),
        currency: refs.currency,
        closeDate: dateIn(refs.timezone, d.closeInDays),
        headline: d.headline ?? null,
        need: d.need ?? null,
        lastContactAt: at(d.lastContactDays),
        stageEnteredAt: moved,
        closedAt: isWon ? moved : null,
        lostAt: d.lost ? at(d.lastContactDays) : null,
        lostReason: d.lost?.reason ?? null,
        lostNote: d.lost?.note ?? null,
        createdAt: created,
      })
      .returning({ id: deals.id });
    const dealId = deal!.id;

    await this.history.record(tx, ctx, { dealId, kind: 'created', fromStageId: null, toStageId: refs.first.id, outcome: refs.first.isWon ? 'won' : 'open' }, created);
    if (refs.stage.id !== refs.first.id) await this.history.record(tx, ctx, { dealId, kind: 'moved', fromStageId: refs.first.id, toStageId: refs.stage.id, outcome: isWon ? 'won' : 'open' }, moved);
    if (d.lost) await this.history.record(tx, ctx, { dealId, kind: 'lost', fromStageId: refs.stage.id, toStageId: refs.stage.id, outcome: 'lost' }, at(d.lastContactDays));

    for (const [position, line] of d.lines.entries()) {
      const p = refs.productIds.get(line.product)!;
      await tx.insert(dealLines).values({
        tenantId: ctx.tenantId,
        dealId,
        productId: p.id,
        position,
        quantity: line.quantity.toFixed(2),
        unitPrice: p.unitPrice,
        vatRate: p.vatRate,
        startDate: dateIn(refs.timezone, Math.max(d.closeInDays, 0)),
        billingFrequency: p.billingFrequency,
        billingCycles: p.billingCycles,
      });
    }
    for (const other of d.others ?? []) await tx.insert(dealContacts).values({ tenantId: ctx.tenantId, dealId, contactId: refs.contactIds.get(other)! });

    const log = (channel: (typeof activities.$inferInsert)['channel'], title: string, detail: string | null, occurredAt: Date) =>
      tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel, title, detail, occurredAt });
    await log(null, 'Deal created', `Source: ${SAMPLE_SOURCE}`, created);
    if (refs.stage.id !== refs.first.id) await log(null, `Moved to ${refs.stage.name}`, null, moved);
    if (d.activity) await log(d.activity.channel, d.activity.title, d.activity.detail, at(d.activity.daysAgo));
    if (d.lost) await log('NT', `Marked as lost: ${d.lost.reason}`, d.lost.note, at(d.lastContactDays));
    if (d.task) {
      const dueDate = dateIn(refs.timezone, d.task.dueInDays);
      await tx.insert(dealTasks).values({
        tenantId: ctx.tenantId,
        dealId,
        stageId: refs.stage.id,
        label: d.task.label,
        offPlaybook: true,
        blocksAdvance: false,
        dueDate,
        assigneeUserId: ctx.userId,
        channel: d.task.channel,
      });
      await log(d.task.channel, 'Task added: ' + d.task.label, 'Due ' + dueDate, created);
    }
    return dealId;
  }
}
