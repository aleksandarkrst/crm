import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, getTableColumns, ilike, or, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { BUYER_ROLES, contacts, deals } from '../../../shared/database/schema';
import { nonEmptyPatch, optionalText, PaginationQuery } from '../../../shared/validation/common';
import { CustomFieldsService, CustomFieldValuesInput } from '../custom-fields/custom-fields.service';
import { assertOwnerIsMember, userNameOf } from '../owner';

export const CreateContact = z.object({
  companyId: z.uuid().nullish(),
  fullName: z.string().trim().min(1).max(200),
  jobTitle: optionalText(120),
  email: z.email().nullish().or(z.literal('').transform(() => null)),
  phone: optionalText(50),
  linkedin: optionalText(300),
  buyerRole: z.enum(BUYER_ROLES).optional(),
  ownerUserId: z.uuid().nullish(),
  /** Custom field values by field id (CD-15); null or '' clears one. */
  customFields: CustomFieldValuesInput,
});
export const UpdateContact = nonEmptyPatch(CreateContact.partial());
export const ContactsQuery = PaginationQuery.extend({
  companyId: z.uuid().optional(),
  buyerRole: z.enum(BUYER_ROLES).optional(),
});
export type CreateContact = z.infer<typeof CreateContact>;
export type UpdateContact = z.infer<typeof UpdateContact>;
export type ContactsQuery = z.infer<typeof ContactsQuery>;

@Injectable()
export class ContactsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly customFields: CustomFieldsService,
  ) {}

  list(ctx: TenantContext, query: ContactsQuery) {
    const filters: (SQL | undefined)[] = [];
    if (query.companyId) filters.push(eq(contacts.companyId, query.companyId));
    if (query.buyerRole) filters.push(eq(contacts.buyerRole, query.buyerRole));
    if (query.q) {
      const like = `%${query.q}%`;
      filters.push(or(ilike(contacts.fullName, like), ilike(contacts.email, like), ilike(contacts.jobTitle, like)));
    }
    // Like deals and companies, the list names the owner (also after they left the workspace).
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select({ ...getTableColumns(contacts), ownerName: userNameOf(contacts.ownerUserId) })
        .from(contacts)
        .where(and(...filters))
        .orderBy(asc(contacts.fullName))
        .limit(query.limit)
        .offset(query.offset),
    );
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx.select().from(contacts).where(eq(contacts.id, id));
      if (!row) throw new NotFoundException('Contact not found');
      return row;
    });
  }

  create(ctx: TenantContext, input: CreateContact) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        // A create that sends custom field values (a create form) must fill the required ones.
        const { customFields: cfInput, ...fields } = input;
        const cf = await this.customFields.validate(tx, 'contact', cfInput, { requireAll: cfInput !== undefined });
        const [row] = await tx
          .insert(contacts)
          .values({ ownerUserId: ctx.userId, ...fields, customFields: cf.set, tenantId: ctx.tenantId })
          .returning();
        await this.audit.record(tx, ctx, { action: 'contact.created', entityType: 'contact', entityId: row!.id });
        return row!;
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateContact) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        const { customFields: cfInput, ...fields } = input;
        const patch: PgUpdateSetSource<typeof contacts> = { ...fields };
        if (cfInput !== undefined) patch.customFields = this.customFields.merged(contacts.customFields, await this.customFields.validate(tx, 'contact', cfInput));
        const [row] = await tx.update(contacts).set(patch).where(eq(contacts.id, id)).returning();
        if (!row) throw new NotFoundException('Contact not found');
        await this.audit.record(tx, ctx, { action: 'contact.updated', entityType: 'contact', entityId: id, data: input });
        return row;
      })
      .catch(mapDbError);
  }

  /**
   * Deals where this contact is the primary contact are kept and lose their primary contact;
   * links to other deals are removed (FK cascade).
   */
  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const cleared = await tx.update(deals).set({ primaryContactId: null }).where(eq(deals.primaryContactId, id)).returning({ id: deals.id });
        const [row] = await tx.delete(contacts).where(eq(contacts.id, id)).returning({ id: contacts.id });
        if (!row) throw new NotFoundException('Contact not found');
        await this.audit.record(tx, ctx, { action: 'contact.deleted', entityType: 'contact', entityId: id, data: { clearedPrimaryOnDeals: cleared.map((d) => d.id) } });
      })
      .catch(mapDbError);
  }
}
