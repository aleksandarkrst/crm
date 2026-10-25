import { and, eq, ne, sql } from 'drizzle-orm';
import type { TenantContext } from '../../../shared/authorization';
import type { Tx } from '../../../shared/database/database.service';
import { activities, dealDocuments, dealTasks, deals, funnels } from '../../../shared/database/schema';

/**
 * A proposal's approval (CD-120), one rule per funnel: Not required (the funnel doesn't ask for
 * it), Not requested, Pending approval, Approved. Revoking goes back to Not requested.
 */
export const APPROVAL_STATUSES = ['not_required', 'not_requested', 'pending', 'approved'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export function approvalStatus(funnelRequires: boolean, deal: { approvalRequestedAt: Date | null; approvedAt: Date | null }): ApprovalStatus {
  if (!funnelRequires) return 'not_required';
  return deal.approvedAt ? 'approved' : deal.approvalRequestedAt ? 'pending' : 'not_requested';
}

/** The same, in SQL (deals joined with their funnel), for the list's filter and rows. */
export const approvalStatusSql = sql<ApprovalStatus>`case when not ${funnels.proposalApproval} then 'not_required' when ${deals.approvedAt} is not null then 'approved' when ${deals.approvalRequestedAt} is not null then 'pending' else 'not_requested' end`;

/**
 * Clears a deal's request and approval when what was approved no longer stands: a new proposal,
 * another funnel. The activity says why; nothing happens when there was nothing to clear.
 */
export async function resetApproval(tx: Tx, ctx: TenantContext, dealId: string, why: string): Promise<void> {
  const [row] = await tx.select({ requested: deals.approvalRequestedAt, approved: deals.approvedAt, taskId: deals.approvalTaskId }).from(deals).where(eq(deals.id, dealId));
  if (!row || (!row.requested && !row.approved)) return;
  await closeApprovalTask(tx, ctx, dealId, row.taskId, false);
  await tx.update(deals).set({ approvalRequestedAt: null, approvalRequestedByUserId: null, approvedAt: null, approvedByUserId: null, approvalTaskId: null }).where(eq(deals.id, dealId));
  await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel: null, title: row.approved ? 'Proposal approval reset' : 'Approval request reset', detail: why });
}

/**
 * The opportunity's proposal changed (CD-120): a new one generated or uploaded, or the one it had
 * deleted. What was sent and what was approved was the old one, so both are cleared: the new one is
 * approved (when the funnel asks for it) and sent again. Funnels without approval clear the sent date too.
 */
export async function proposalReplaced(tx: Tx, ctx: TenantContext, dealId: string, why: string): Promise<void> {
  await tx
    .update(deals)
    .set({ proposalSentAt: null })
    .where(and(eq(deals.id, dealId), sql`${deals.proposalSentAt} is not null`));
  await resetApproval(tx, ctx, dealId, why);
}

/** The deal's proposal that counts (one per opportunity): any but a failed generation. */
export async function currentProposal(tx: Tx, dealId: string) {
  const [row] = await tx
    .select({ id: dealDocuments.id, name: dealDocuments.name, status: dealDocuments.status })
    .from(dealDocuments)
    .where(and(eq(dealDocuments.dealId, dealId), eq(dealDocuments.docType, 'Proposal'), ne(dealDocuments.status, 'failed')))
    .limit(1);
  return row;
}

/**
 * The approver's "Approve the proposal" task (CD-120) once the request is decided: ticked when it is
 * approved, removed when it is declined, revoked or reset, so no stale task stays on their Today.
 * A task someone already deleted is simply gone.
 */
export async function closeApprovalTask(tx: Tx, ctx: TenantContext, dealId: string, taskId: string | null, approved: boolean): Promise<void> {
  if (!taskId) return;
  const which = and(eq(dealTasks.id, taskId), eq(dealTasks.dealId, dealId));
  if (approved) await tx.update(dealTasks).set({ done: true, doneAt: new Date(), doneByUserId: ctx.userId }).where(and(which, eq(dealTasks.done, false)));
  else await tx.delete(dealTasks).where(which);
}
