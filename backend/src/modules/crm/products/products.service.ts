import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, ilike, ne, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { BILLING_KINDS, dealLines, deals, PRODUCT_TYPES, products, tenants } from '../../../shared/database/schema';
import { nonEmptyPatch, PaginationQuery } from '../../../shared/validation/common';
import { currencyCode } from '../currency';

const decimal = (max: number) =>
  z
    .union([z.number(), z.string()])
    .transform((v) => Number(v))
    .pipe(z.number().min(0).max(max))
    .transform((v) => v.toFixed(2));

export const CreateProduct = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(PRODUCT_TYPES).optional(),
  billingKind: z.enum(BILLING_KINDS).optional(),
  unitPrice: decimal(999_999_999).optional(),
  vatRate: decimal(100).optional(),
  /** ISO 4217 (CD-77). A new product without one gets the workspace currency. */
  currency: currencyCode.optional(),
});
export const UpdateProduct = nonEmptyPatch(CreateProduct.partial());
export const ProductsQuery = PaginationQuery.extend({
  type: z.enum(PRODUCT_TYPES).optional(),
  billingKind: z.enum(BILLING_KINDS).optional(),
});
export type CreateProduct = z.infer<typeof CreateProduct>;
export type UpdateProduct = z.infer<typeof UpdateProduct>;
export type ProductsQuery = z.infer<typeof ProductsQuery>;

/** The catalog of products and services that deals are priced from. */
@Injectable()
export class ProductsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: TenantContext, query: ProductsQuery) {
    const filters: (SQL | undefined)[] = [];
    if (query.type) filters.push(eq(products.type, query.type));
    if (query.billingKind) filters.push(eq(products.billingKind, query.billingKind));
    if (query.q) filters.push(ilike(products.name, `%${query.q}%`));
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx.select().from(products).where(and(...filters)).orderBy(asc(products.name)).limit(query.limit).offset(query.offset),
    );
  }

  create(ctx: TenantContext, input: CreateProduct) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        // tenants is a platform table without RLS, so filter by the caller's tenant explicitly.
        const [workspace] = await tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, ctx.tenantId));
        const [row] = await tx.insert(products).values({ currency: workspace?.currency, ...input, tenantId: ctx.tenantId }).returning();
        await this.audit.record(tx, ctx, { action: 'product.created', entityType: 'product', entityId: row!.id });
        return row!;
      })
      .catch(mapDbError);
  }

  /**
   * A product on deals in another currency can't switch to it (409): those deals' lines would no
   * longer be in the deal's currency (CD-77).
   */
  update(ctx: TenantContext, id: string, input: UpdateProduct) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        if (input.currency) {
          const clashing = await tx
            .selectDistinct({ title: deals.title, currency: deals.currency })
            .from(dealLines)
            .innerJoin(deals, eq(deals.id, dealLines.dealId))
            .where(and(eq(dealLines.productId, id), ne(deals.currency, input.currency)));
          if (clashing.length) {
            const what = clashing.length === 1 ? `the deal "${clashing[0]!.title}" (${clashing[0]!.currency})` : `${clashing.length} deals in other currencies`;
            throw new ConflictException(`This product is on ${what}. Its currency can only change to ${input.currency} once it is used only on deals in ${input.currency}.`);
          }
        }
        const [row] = await tx.update(products).set(input).where(eq(products.id, id)).returning();
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
