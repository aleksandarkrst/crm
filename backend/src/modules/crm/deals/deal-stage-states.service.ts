import { Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { activities, deals, dealStageStates, funnelStages } from '../../../shared/database/schema';

export const SetDocsComplete = z.object({ complete: z.boolean() });
export type SetDocsComplete = z.infer<typeof SetDocsComplete>;

/**
 * A deal's state per stage (CD-363): "Documentation complete, ready to send", ticked by anyone who
 * can work the deal, with who and when. The advance gate (stage-gate.ts) reads it.
 */
@Injectable()
export class DealStageStatesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  setDocsComplete(ctx: TenantContext, dealId: string, stageId: string, input: SetDocsComplete) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [deal] = await tx.select({ funnelId: deals.funnelId }).from(deals).where(eq(deals.id, dealId));
        if (!deal) throw new NotFoundException('Opportunity not found');
        const [stage] = await tx
          .select({ name: funnelStages.name })
          .from(funnelStages)
          .where(and(eq(funnelStages.id, stageId), eq(funnelStages.funnelId, deal.funnelId), isNull(funnelStages.deletedAt)));
        if (!stage) throw new NotFoundException("Stage not found in this opportunity's funnel");

        const [current] = await tx.select().from(dealStageStates).where(and(eq(dealStageStates.dealId, dealId), eq(dealStageStates.stageId, stageId)));
        if ((current?.docsComplete ?? false) === input.complete) return current ?? emptyState(dealId, stageId);
        const now = new Date();
        const set = input.complete ? { docsComplete: true, docsCompleteAt: now, docsCompleteByUserId: ctx.userId, updatedAt: now } : { docsComplete: false, docsCompleteAt: null, docsCompleteByUserId: null, updatedAt: now };
        const [row] = await tx
          .insert(dealStageStates)
          .values({ tenantId: ctx.tenantId, dealId, stageId, ...set })
          .onConflictDoUpdate({ target: [dealStageStates.tenantId, dealStageStates.dealId, dealStageStates.stageId], set })
          .returning();
        await tx.insert(activities).values({
          tenantId: ctx.tenantId,
          dealId,
          actorUserId: ctx.userId,
          channel: null,
          title: input.complete ? `Documentation marked complete in ${stage.name}` : `Documentation no longer complete in ${stage.name}`,
          detail: null,
        });
        await this.audit.record(tx, ctx, { action: 'deal.docs_complete', entityType: 'deal', entityId: dealId, data: { stageId, complete: input.complete } });
        return row!;
      })
      .catch(mapDbError);
  }
}

/** The state of a stage nobody has ticked yet. */
export const emptyState = (dealId: string, stageId: string) => ({ dealId, stageId, docsComplete: false, docsCompleteAt: null, docsCompleteByUserId: null });
