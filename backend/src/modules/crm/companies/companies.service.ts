import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { asc, count, eq, getTableColumns, ilike, or } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { companies, contacts, deals } from '../../../shared/database/schema';
import { nonEmptyPatch, optionalText, type PaginationQuery } from '../../../shared/validation/common';
import { CustomFieldsService, CustomFieldValuesInput } from '../custom-fields/custom-fields.service';
import { assertOwnerIsMember, userNameOf } from '../owner';

export const CreateCompany = z.object({
  name: z.string().trim().min(1).max(200),
  industry: optionalText(100),
  hq: optionalText(120),
  teamSize: optionalText(40),
  source: optionalText(80),
  domain: optionalText(253),
  ownerUserId: z.uuid().nullish(),
  /** Custom field values by field id (CD-15); null or '' clears one. */
  customFields: CustomFieldValuesInput,
  notes: optionalText(5000),
});
export const UpdateCompany = nonEmptyPatch(CreateCompany.partial());
export type CreateCompany = z.infer<typeof CreateCompany>;
export type UpdateCompany = z.infer<typeof UpdateCompany>;

/**
 * Reference pattern for a tenant-scoped CRUD service:
 * - every query runs inside database.withTenant(), so RLS filters by tenant automatically;
 * - inserts set tenantId explicitly (RLS WITH CHECK rejects a mismatch);
 * - mutations write an audit entry in the same transaction.
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly customFields: CustomFieldsService,
  ) {}

  list(ctx: TenantContext, page: PaginationQuery) {
    const like = page.q ? `%${page.q}%` : undefined;
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select({ ...getTableColumns(companies), ownerName: userNameOf(companies.ownerUserId) })
        .from(companies)
        .where(like ? or(ilike(companies.name, like), ilike(companies.industry, like), ilike(companies.hq, like)) : undefined)
        .orderBy(asc(companies.name))
        .limit(page.limit)
        .offset(page.offset),
    );
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.select().from(companies).where(eq(companies.id, id));
      if (!row) throw new NotFoundException('Company not found');
      return row;
    });
  }

  create(ctx: TenantContext, input: CreateCompany) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        // A create that sends custom field values (a create form) must fill the required ones.
        const { customFields: cfInput, ...fields } = input;
        const cf = await this.customFields.validate(tx, 'company', cfInput, { requireAll: cfInput !== undefined });
        const [row] = await tx
          .insert(companies)
          .values({ ownerUserId: ctx.userId, ...fields, customFields: cf.set, tenantId: ctx.tenantId })
          .returning();
        await this.audit.record(tx, ctx, { action: 'company.created', entityType: 'company', entityId: row!.id });
        return row!;
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateCompany) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        const { customFields: cfInput, ...fields } = input;
        const patch: PgUpdateSetSource<typeof companies> = { ...fields };
        if (cfInput !== undefined) patch.customFields = this.customFields.merged(companies.customFields, await this.customFields.validate(tx, 'company', cfInput));
        const [row] = await tx.update(companies).set(patch).where(eq(companies.id, id)).returning();
        if (!row) throw new NotFoundException('Company not found');
        await this.audit.record(tx, ctx, { action: 'company.updated', entityType: 'company', entityId: id, data: input });
        return row;
      })
      .catch(mapDbError);
  }

  /**
   * A company with deals can't be deleted (409): the deals would lose their customer, so they
   * have to be deleted or moved first. Its contacts are kept and no longer belong to a company.
   */
  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [company] = await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, id));
        if (!company) throw new NotFoundException('Company not found');
        const [open] = await tx.select({ n: count() }).from(deals).where(eq(deals.companyId, id));
        if (open && open.n > 0) {
          const what = open.n === 1 ? '1 deal' : `${open.n} deals`;
          throw new ConflictException(`${company.name} has ${what}. Delete them or move them to another company first.`);
        }
        const detached = await tx.update(contacts).set({ companyId: null }).where(eq(contacts.companyId, id)).returning({ id: contacts.id });
        await tx.delete(companies).where(eq(companies.id, id));
        await this.audit.record(tx, ctx, { action: 'company.deleted', entityType: 'company', entityId: id, data: { detachedContacts: detached.length } });
      })
      .catch(mapDbError);
  }
}
