import { eq, sql } from 'drizzle-orm';
import type { TenantContext } from '../../../shared/authorization';
import type { Tx } from '../../../shared/database/database.service';
import { activities, deals, funnels } from '../../../shared/database/schema';

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
  const [row] = await tx.select({ requested: deals.approvalRequestedAt, approved: deals.approvedAt }).from(deals).where(eq(deals.id, dealId));
  if (!row || (!row.requested && !row.approved)) return;
  await tx.update(deals).set({ approvalRequestedAt: null, approvalRequestedByUserId: null, approvedAt: null, approvedByUserId: null }).where(eq(deals.id, dealId));
  await tx.insert(activities).values({ tenantId: ctx.tenantId, dealId, actorUserId: ctx.userId, channel: null, title: row.approved ? 'Proposal approval reset' : 'Approval request reset', detail: why });
}
