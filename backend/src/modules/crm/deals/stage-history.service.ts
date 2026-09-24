import { Injectable } from '@nestjs/common';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { type DealOutcome, dealStageHistory, type StageChangeKind } from '../../../shared/database/schema';
import { PaginationQuery } from '../../../shared/validation/common';

export const StageHistoryQuery = PaginationQuery.extend({ dealId: z.uuid().optional() });
export type StageHistoryQuery = z.infer<typeof StageHistoryQuery>;

export interface StageChange {
  dealId: string;
  kind: StageChangeKind;
  fromStageId: string | null;
  toStageId: string;
  outcome: DealOutcome;
}

/**
 * Stage history of deals (CD-61): every stage or outcome change, with when and by whom. Rows are
 * written by DealsService inside the transaction that changes the deal, so history and deal
 * can't disagree.
 */
@Injectable()
export class StageHistoryService {
  constructor(private readonly database: DatabaseService) {}

  /** Oldest first, so the client can walk each deal's path through the funnel. */
  list(ctx: TenantContext, query: StageHistoryQuery) {
    const filters: (SQL | undefined)[] = [];
    if (query.dealId) filters.push(eq(dealStageHistory.dealId, query.dealId));
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select()
        .from(dealStageHistory)
        .where(and(...filters))
        .orderBy(asc(dealStageHistory.changedAt), asc(dealStageHistory.id))
        .limit(query.limit)
        .offset(query.offset),
    );
  }

  /** Records one change; call it with the transaction that changes the deal. */
  async record(tx: Tx, ctx: TenantContext, change: StageChange, changedAt = new Date()): Promise<void> {
    await tx.insert(dealStageHistory).values({ ...change, tenantId: ctx.tenantId, changedAt, changedByUserId: ctx.userId });
  }
}
