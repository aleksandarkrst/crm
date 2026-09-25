import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { BILLING_FREQUENCIES, products } from '../../../shared/database/schema';
import { nonEmptyPatch, optionalText, PaginationQuery } from '../../../shared/validation/common';

const decimal = (max: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().min(0).max(max))
    .transform((v) => v.toFixed(2));

const ProductFields = z.object({
  name: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  /** What one unit is, e.g. "hour" or "license". */
  unit: optionalText(40),
  unitPrice: decimal(999_999_999),
  /** Default quantity; the product's price is unit price × quantity. */
  quantity: decimal(9_999_999),
  vatRate: decimal(100),
  billingFrequency: z.enum(BILLING_FREQUENCIES),
  /** Recurring only: how many times it is billed; null renews until canceled. */
  billingCycles: z.number().int().min(1).max(1000).nullable(),
});
export const CreateProduct = ProductFields.partial().required({ name: true });
export const UpdateProduct = nonEmptyPatch(ProductFields.partial());
export const ProductsQuery = PaginationQuery.extend({ billingFrequency: z.enum(BILLING_FREQUENCIES).optional() });
export type CreateProduct = z.infer<typeof CreateProduct>;
export type UpdateProduct = z.infer<typeof UpdateProduct>;
export type ProductsQuery = z.infer<typeof ProductsQuery>;

/** A one-time product has no billing cycles. */
const normalize = <T extends { billingFrequency?: string; billingCycles?: number | null }>(input: T): T =>
  input.billingFrequency === 'one_time' ? { ...input, billingCycles: null } : input;

/**
 * The catalog of products and services that deals are priced from (CD-83). Products have no
 * currency: a deal line takes the number in its deal's currency.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: TenantContext, query: ProductsQuery) {
    const filters: (SQL | undefined)[] = [];
    if (query.billingFrequency) filters.push(eq(products.billingFrequency, query.billingFrequency));
    if (query.q) filters.push(ilike(products.name, `%${query.q}%`));
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx.select().from(products).where(and(...filters)).orderBy(asc(products.name)).limit(query.limit).offset(query.offset),
    );
  }

  create(ctx: TenantContext, input: CreateProduct) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.insert(products).values({ ...normalize(input), tenantId: ctx.tenantId }).returning();
        await this.audit.record(tx, ctx, { action: 'product.created', entityType: 'product', entityId: row!.id });
        return row!;
      })
      .catch(mapDbError);
  }

  /** Deals keep the prices they were given: changing a product doesn't change existing deal lines. */
  update(ctx: TenantContext, id: string, input: UpdateProduct) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.update(products).set(normalize(input)).where(eq(products.id, id)).returning();
        if (!row) throw new NotFoundException('Product not found');
        await this.audit.record(tx, ctx, { action: 'product.updated', entityType: 'product', entityId: id, data: input });
        return row;
      })
      .catch(mapDbError);
  }

  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx.delete(products).where(eq(products.id, id)).returning({ id: products.id });
        if (!row) throw new NotFoundException('Product not found');
        await this.audit.record(tx, ctx, { action: 'product.deleted', entityType: 'product', entityId: id });
      })
      .catch(mapDbError);
  }
}
