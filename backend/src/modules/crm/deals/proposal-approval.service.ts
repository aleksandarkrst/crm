import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, dealDocuments, deals, funnels, funnelStages, tenants } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { zonedParts } from '../../../shared/time/zoned-time';
import { userNameOf } from '../owner';
import { DealTasksService } from './deal-tasks.service';
import { approvalStatus, closeApprovalTask } from './proposal-approval';

/**
 * Proposal approval (CD-120): the funnel says whether proposals need approval and who approves.
 * Anyone who works the opportunity requests it (the approver gets an email); the approver, owners
 * and admins approve or revoke (403 for anyone else). A proposal is marked as sent only once it is
 * approved, when the funnel asks for that. Every step is an activity and an audit row. A request
 * also gives the approver a task due today, closed again when the request is decided.
 */
@Injectable()
export class ProposalApprovalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly tasks: DealTasksService,
  ) {}

  request(ctx: TenantContext, dealId: string) {
    return this.run(ctx, dealId, async (tx, d) => {
      if (!d.proposalApproval) throw new ConflictException("Proposals in this funnel don't need approval.");
      if (d.isWon || d.lostAt) throw new ConflictException('This opportunity is closed.');
      const status = approvalStatus(true, d);
      if (status === 'pending') throw new ConflictException('Approval is already requested.');
      if (status === 'approved') throw new ConflictException('The proposal is already approved.');
      if (!d.approverUserId) throw new ConflictException('This funnel has no approver yet. An admin picks one in Settings → Funnels.');
      const [proposal] = await tx
        .select({ id: dealDocuments.id })
        .from(dealDocuments)
        .where(and(eq(dealDocuments.dealId, dealId), eq(dealDocuments.docType, 'Proposal'), eq(dealDocuments.status, 'ready')))
        .limit(1);
      if (!proposal) throw new ConflictException('Add the proposal first: generate it or import your own on the Documents tab.');
      const [workspace] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      const task = await this.tasks.insertExtra(tx, ctx, dealId, {
        stageId: d.stageId,
        label: 'Approve the proposal',
        blocksAdvance: false,
        assigneeUserId: d.approverUserId,
        dueDate: zonedParts(new Date(), workspace?.timezone ?? 'UTC').date,
      });
      await tx.update(deals).set({ approvalRequestedAt: new Date(), approvalRequestedByUserId: ctx.userId, approvedAt: null, approvedByUserId: null, approvalTaskId: task.id }).where(eq(deals.id, dealId));
      await this.log(tx, ctx, dealId, 'Approval requested', `From ${d.approverName ?? 'the approver'}`);
      await this.jobs.send('crm.approval-requested', { tenantId: ctx.tenantId, dealId, approverUserId: d.approverUserId, actorUserId: ctx.userId }, tx);
      await this.audit.record(tx, ctx, { action: 'deal.approval_requested', entityType: 'deal', entityId: dealId, data: { approverUserId: d.approverUserId } });
    });
  }

  approve(ctx: TenantContext, dealId: string) {
    return this.run(ctx, dealId, async (tx, d) => {
      this.assertMayDecide(ctx, d);
      const status = approvalStatus(d.proposalApproval, d);
      if (status === 'not_required') throw new ConflictException("Proposals in this funnel don't need approval.");
      if (status === 'approved') throw new ConflictException('The proposal is already approved.');
      if (status === 'not_requested') throw new ConflictException('Nobody has requested approval yet.');
      await closeApprovalTask(tx, ctx, dealId, d.approvalTaskId, true);
      await tx.update(deals).set({ approvedAt: new Date(), approvedByUserId: ctx.userId, approvalTaskId: null }).where(eq(deals.id, dealId));
      await this.log(tx, ctx, dealId, 'Proposal approved', null);
      await this.audit.record(tx, ctx, { action: 'deal.approved', entityType: 'deal', entityId: dealId });
    });
  }

  /** Back to Not requested, from Pending or Approved; the activity keeps it. */
  revoke(ctx: TenantContext, dealId: string) {
    return this.run(ctx, dealId, async (tx, d) => {
      this.assertMayDecide(ctx, d);
      const status = approvalStatus(d.proposalApproval, d);
      if (status !== 'pending' && status !== 'approved') throw new ConflictException('There is no approval to revoke.');
      await closeApprovalTask(tx, ctx, dealId, d.approvalTaskId, false);
      await tx.update(deals).set({ approvalRequestedAt: null, approvalRequestedByUserId: null, approvedAt: null, approvedByUserId: null, approvalTaskId: null }).where(eq(deals.id, dealId));
      await this.log(tx, ctx, dealId, status === 'approved' ? 'Proposal approval revoked' : 'Approval request declined', null);
      await this.audit.record(tx, ctx, { action: 'deal.approval_revoked', entityType: 'deal', entityId: dealId, data: { was: status } });
    });
  }

  /** "Send proposal" (marks it as sent; nothing is emailed yet): blocked until approved when the funnel asks for approval. */
  markSent(ctx: TenantContext, dealId: string) {
    return this.run(ctx, dealId, async (tx, d) => {
      const status = approvalStatus(d.proposalApproval, d);
      if (status !== 'not_required' && status !== 'approved') {
        throw new ConflictException(`The proposal needs approval by ${d.approverName ?? "the funnel's approver"} before it is sent.`);
      }
      await tx.update(deals).set({ proposalSentAt: new Date() }).where(eq(deals.id, dealId));
      await this.log(tx, ctx, dealId, 'Proposal sent', null);
      await this.audit.record(tx, ctx, { action: 'deal.proposal_sent', entityType: 'deal', entityId: dealId });
    });
  }

  private assertMayDecide(ctx: TenantContext, d: { approverUserId: string | null }) {
    if (d.approverUserId !== ctx.userId && !hasRole(ctx.role, 'admin')) throw new ForbiddenException("Only the funnel's approver, owners and admins can approve or revoke a proposal.");
  }

  /** Locks the deal, runs the step and answers with its approval as the page shows it. */
  private run(ctx: TenantContext, dealId: string, step: (tx: Tx, d: Awaited<ReturnType<ProposalApprovalService['load']>>) => Promise<void>) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const d = await this.load(tx, dealId, true);
        await step(tx, d);
        const after = await this.load(tx, dealId, false);
        return {
          approvalStatus: approvalStatus(after.proposalApproval, after),
          approvalRequestedAt: after.approvalRequestedAt,
          approvalRequestedByUserId: after.approvalRequestedByUserId,
          approvedAt: after.approvedAt,
          approvedByUserId: after.approvedByUserId,
          proposalSentAt: after.proposalSentAt,
        };
      })
      .catch(mapDbError);
  }

  private async load(tx: Tx, dealId: string, lock: boolean) {
    const q = tx
      .select({
        approvalRequestedAt: deals.approvalRequestedAt,
        approvalRequestedByUserId: deals.approvalRequestedByUserId,
        approvedAt: deals.approvedAt,
        approvedByUserId: deals.approvedByUserId,
        proposalSentAt: deals.proposalSentAt,
        approvalTaskId: deals.approvalTaskId,
        stageId: deals.stageId,
        lostAt: deals.lostAt,
        isWon: funnelStages.isWon,
        proposalApproval: funnels.proposalApproval,
        approverUserId: funnels.approverUserId,
        approverName: userNameOf(funnels.approverUserId),
      })
      .from(deals)
      .innerJoin(funnels, eq(funnels.id, deals.funnelId))
      .innerJoin(funnelStages, eq(funnelStages.id, deals.stageId))
      .where(eq(deals.id, dealId));
    const [d] = lock ? await q.for('update', { of: deals }) : await q;
    if (!d) throw new NotFoundException('Opportunity not found');
    return d;
  }

  private async log(tx: Tx, ctx: TenantContext, dealId: string, title: string, detail: string | null) {
    await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel: null, title, detail });
  }
}

