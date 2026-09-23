import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { dealLines, deals, PAYMENT_SCHEDULES } from '../../../shared/database/schema';
import { nonEmptyPatch, PaginationQuery } from '../../../shared/validation/common';

const decimal = (max: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().min(0).max(max))
    .transform((v) => v.toFixed(2));

const Milestone = z.object({
  label: z.string().trim().max(100),
  pct: z.coerce.number().min(0).max(100),
  date: z.iso.date().optional().or(z.literal('').transform(() => undefined)),
});

export const CreateDealLine = z.object({
  productId: z.uuid().nullish(),
  position: z.number().int().min(0).max(1000).optional(),
  quantity: decimal(9_999_999).optional(),
  unitPrice: decimal(999_999_999).optional(),
  vatRate: decimal(100).optional(),
  schedule: z.enum(PAYMENT_SCHEDULES).optional(),
  startDate: z.iso.date().nullish(),
  months: z.coerce.number().int().min(1).max(120).optional(),
  milestones: z.array(Milestone).max(24).optional(),
});
export const UpdateDealLine = nonEmptyPatch(CreateDealLine);
export type CreateDealLine = z.infer<typeof CreateDealLine>;
export type UpdateDealLine = z.infer<typeof UpdateDealLine>;

/**
 * Deal lines: products on a deal with quantity, price, VAT and payment schedule. Every change
 * recalculates the deal amount (sum of net line values) in the same transaction.
 */
@Injectable()
export class DealLinesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** All lines of the workspace (the dashboard forecasts payments across every deal). */
  list(ctx: TenantContext, page: PaginationQuery) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx.select().from(dealLines).orderBy(asc(dealLines.dealId), asc(dealLines.position), asc(dealLines.createdAt)).limit(page.limit).offset(page.offset),
    );
  }

  create(ctx: TenantContext, dealId: string, input: CreateDealLine) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .insert(dealLines)
          .values({ ...input, milestones: input.milestones ?? defaultMilestones(), tenantId: ctx.tenantId, dealId })
          .returning();
        await this.syncAmount(tx, dealId);
        await this.audit.record(tx, ctx, { action: 'deal_line.created', entityType: 'deal', entityId: dealId, data: { lineId: row!.id } });
        return row!;
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateDealLine) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.update(dealLines).set(input).where(eq(dealLines.id, id)).returning();
        if (!row) throw new NotFoundException('Deal line not found');
        await this.syncAmount(tx, row.dealId);
        return row;
      })
      .catch(mapDbError);
  }

  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.delete(dealLines).where(eq(dealLines.id, id)).returning({ dealId: dealLines.dealId });
        if (!row) throw new NotFoundException('Deal line not found');
        await this.syncAmount(tx, row.dealId);
        await this.audit.record(tx, ctx, { action: 'deal_line.deleted', entityType: 'deal', entityId: row.dealId, data: { lineId: id } });
      })
      .catch(mapDbError);
  }

  private async syncAmount(tx: Tx, dealId: string) {
    const total = sql`coalesce((select round(sum(${dealLines.quantity} * ${dealLines.unitPrice}), 2) from ${dealLines} where ${dealLines.dealId} = ${dealId}), 0)`;
    const [deal] = await tx.update(deals).set({ amount: total }).where(eq(deals.id, dealId)).returning({ id: deals.id });
    if (!deal) throw new NotFoundException('Deal not found');
  }
}

const defaultMilestones = () => [
  { label: 'On signature', pct: 40 },
  { label: 'On delivery', pct: 60 },
];
