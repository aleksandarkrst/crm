import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { BILLING_FREQUENCIES, dealLines, deals, DISCOUNT_KINDS, TAX_MODES } from '../../../shared/database/schema';
import { type DealRowsQuery, optionalText } from '../../../shared/validation/common';
import { currencyCode } from '../currency';
import { dealTotals, isRecurring, type LineInput } from './deal-value';

const decimal = (max: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().min(0).max(max))
    .transform((v) => v.toFixed(2));

const Cycles = z.number().int().min(1).max(1000).nullable();

const DealLineInput = z
  .object({
    /** Keep the id of a line that stays; leave it out for a new line. */
    id: z.uuid().optional(),
    productId: z.uuid(),
    description: optionalText(2000),
    startDate: z.iso.date().nullish(),
    quantity: decimal(9_999_999),
    unitPrice: decimal(999_999_999),
    discountKind: z.enum(DISCOUNT_KINDS).default('percent'),
    discountValue: decimal(999_999_999).default('0.00'),
    vatRate: decimal(100),
    billingFrequency: z.enum(BILLING_FREQUENCIES),
    billingCycles: Cycles.optional(),
  })
  .refine((l) => l.discountKind !== 'percent' || Number(l.discountValue) <= 100, { message: 'A percentage discount is at most 100', path: ['discountValue'] });

const DiscountInput = z
  .object({ id: z.string().max(64).optional(), label: z.string().trim().max(100).default(''), kind: z.enum(DISCOUNT_KINDS), value: z.number().min(0).max(999_999_999) })
  .refine((d) => d.kind !== 'percent' || d.value <= 100, { message: 'A percentage discount is at most 100', path: ['value'] });

const InstallmentInput = z.object({
  id: z.string().max(64).optional(),
  description: z.string().trim().max(200).default(''),
  date: z.iso.date().nullable(),
  amount: z.number().min(0).max(999_999_999),
});

/** Everything the "Products" dialog of a deal saves at once (CD-83). */
export const SaveDealProducts = z.object({
  /** ISO 4217; the prices are read in it. Changing it keeps the numbers (there are no exchange rates). */
  currency: currencyCode.optional(),
  taxMode: z.enum(TAX_MODES),
  lines: z.array(DealLineInput).max(50),
  discounts: z.array(DiscountInput).max(10).default([]),
  installments: z.array(InstallmentInput).max(60).default([]),
});
export type SaveDealProducts = z.infer<typeof SaveDealProducts>;

const toLineInput = (l: { quantity: string; unitPrice: string; vatRate: string; discountKind: LineInput['discountKind']; discountValue: string; billingFrequency: LineInput['billingFrequency']; billingCycles: number | null }): LineInput => ({
  quantity: Number(l.quantity),
  unitPrice: Number(l.unitPrice),
  vatRate: Number(l.vatRate),
  discountKind: l.discountKind,
  discountValue: Number(l.discountValue),
  billingFrequency: l.billingFrequency,
  billingCycles: l.billingCycles,
});

/**
 * Products on a deal (CD-83). The deal screen saves its products, currency, tax mode, discounts
 * and installments together; the lines are matched by id, so unchanged lines stay as they are (and
 * the change history shows only what changed). The deal amount is recalculated in the same
 * transaction.
 */
@Injectable()
export class DealLinesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** All lines of the workspace (Overview forecasts payments across every deal). */
  list(ctx: TenantContext, page: DealRowsQuery) {
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select()
        .from(dealLines)
        .where(page.dealIds ? inArray(dealLines.dealId, page.dealIds) : undefined)
        .orderBy(asc(dealLines.dealId), asc(dealLines.position), asc(dealLines.createdAt)).limit(page.limit).offset(page.offset),
    );
  }

  save(ctx: TenantContext, dealId: string, input: SaveDealProducts) {
    if (input.installments.length && input.lines.some((l) => isRecurring(l))) {
      throw new BadRequestException('Installments are for deals with one-time products only. Remove the recurring products or the installments.');
    }
    const lines = input.lines.map((l) => ({ ...l, billingCycles: l.billingFrequency === 'one_time' ? null : (l.billingCycles ?? null) }));
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [deal] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
        if (!deal) throw new NotFoundException('Deal not found');
        const existing = await tx.select({ id: dealLines.id }).from(dealLines).where(eq(dealLines.dealId, dealId));
        const known = new Set(existing.map((l) => l.id));
        const kept = new Set<string>();
        for (const [position, { id, ...line }] of lines.entries()) {
          const values = { ...line, description: line.description ?? null, startDate: line.startDate ?? null, position };
          if (id && known.has(id) && !kept.has(id)) {
            kept.add(id);
            await tx.update(dealLines).set(values).where(eq(dealLines.id, id));
          } else {
            await tx.insert(dealLines).values({ ...values, tenantId: ctx.tenantId, dealId });
          }
        }
        const gone = existing.map((l) => l.id).filter((id) => !kept.has(id));
        if (gone.length) await tx.delete(dealLines).where(inArray(dealLines.id, gone));

        const discounts = input.discounts.map((d) => ({ ...d, id: d.id || randomUUID() }));
        const installments = input.installments.map((i) => ({ ...i, id: i.id || randomUUID() }));
        const totals = dealTotals(lines.map(toLineInput), input.taxMode, discounts);
        await tx
          .update(deals)
          .set({ taxMode: input.taxMode, discounts, installments, amount: totals.subtotal.toFixed(2), ...(input.currency ? { currency: input.currency } : {}) })
          .where(eq(deals.id, dealId));
        await this.audit.record(tx, ctx, { action: 'deal.products_saved', entityType: 'deal', entityId: dealId, data: { lines: lines.length, taxMode: input.taxMode } });
        const saved = await tx.select().from(dealLines).where(eq(dealLines.dealId, dealId)).orderBy(asc(dealLines.position));
        return { lines: saved, totals };
      })
      .catch(mapDbError);
  }

  /** Recalculates a deal's amount from its lines (e.g. after something else changed them). */
  async syncAmount(tx: Tx, dealId: string) {
    const [deal] = await tx.select({ taxMode: deals.taxMode, discounts: deals.discounts }).from(deals).where(eq(deals.id, dealId));
    if (!deal) throw new NotFoundException('Deal not found');
    const lines = await tx.select().from(dealLines).where(eq(dealLines.dealId, dealId));
    const totals = dealTotals(lines.map(toLineInput), deal.taxMode, deal.discounts);
    await tx.update(deals).set({ amount: totals.subtotal.toFixed(2) }).where(eq(deals.id, dealId));
  }
}
