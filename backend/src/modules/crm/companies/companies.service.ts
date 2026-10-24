import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, getTableColumns, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { companies, COMPANY_STATUSES, contacts, deals, funnelStages, meetings, OWNERSHIP_TYPES, projects, visitPlanLines } from '../../../shared/database/schema';
import { ListQuery, nonEmptyPatch, optionalText } from '../../../shared/validation/common';
import { MB_MESSAGE, mbValid, PIB_MESSAGE, pibValid } from '../../../shared/validation/serbian-ids';
import { CustomFieldsService, CustomFieldValuesInput } from '../custom-fields/custom-fields.service';
import { RecordHistoryService } from '../history/record-history.service';
import { assertOwnerIsMember, userNameOf } from '../owner';
import { CompanyStatusService } from './company-status.service';

const noSpaces = (v: unknown) => (typeof v === 'string' ? v.replace(/\s/g, '') : v);

export const CreateCompany = z.object({
  name: z.string().trim().min(1).max(200),
  industry: optionalText(100),
  hq: optionalText(120),
  teamSize: optionalText(40),
  source: optionalText(80),
  domain: optionalText(253),
  // Identity (CD-357). The PIB is required and, once set, can't be cleared (a PATCH may change it, not null it).
  // Spaces are dropped ("104 052 135" is 104052135), as the dialogs do, so a spreadsheet's formatting passes.
  pib: z.preprocess(noSpaces, z.string({ error: 'PIB is required' }).refine(pibValid, PIB_MESSAGE)),
  mb: z.preprocess(noSpaces, optionalText(8).refine((v) => v == null || mbValid(v), MB_MESSAGE)),
  address: optionalText(200),
  city: optionalText(100),
  postalCode: optionalText(12),
  activityCode: optionalText(4).refine((v) => v == null || /^\d{4}$/.test(v), 'The activity code is 4 digits'),
  ownershipType: z.enum(OWNERSHIP_TYPES).nullish(),
  ownerUserId: z.uuid().nullish(),
  /** Custom field values by field id (CD-15); null or '' clears one. */
  customFields: CustomFieldValuesInput,
  notes: optionalText(5000),
});
export const UpdateCompany = nonEmptyPatch(CreateCompany.partial());

/**
 * `GET /crm/companies` filters (CD-358): `status=lead,opportunity` keeps those statuses; `outcome=won`
 * keeps companies with a won opportunity, `outcome=lost` those whose opportunities were all lost.
 */
export const CompaniesQuery = ListQuery.extend({
  status: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(COMPANY_STATUSES)).min(1))
    .optional(),
  outcome: z.enum(['won', 'lost']).optional(),
});
export type CompaniesQuery = z.infer<typeof CompaniesQuery>;

/** "Set status back…" (a status) or "Back to automatic" (null). */
export const SetCompanyStatus = z.object({ status: z.enum(COMPANY_STATUSES).nullable() });
export type SetCompanyStatus = z.infer<typeof SetCompanyStatus>;
export type CreateCompany = z.infer<typeof CreateCompany>;
export type UpdateCompany = z.infer<typeof UpdateCompany>;

/**
 * Two companies in one workspace never share a PIB (CD-357): a 409 that names the existing one, so
 * the New company dialog can offer to open it. The unique index catches a race (a plain 409).
 */
async function assertPibFree(tx: Tx, pib: string, exceptId?: string) {
  const [taken] = await tx
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.pib, pib), exceptId ? ne(companies.id, exceptId) : undefined));
  if (taken) throw new ConflictException({ statusCode: 409, error: 'Conflict', message: `A company with this PIB already exists: ${taken.name}`, existingCompanyId: taken.id });
}

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
    private readonly changes: RecordHistoryService,
    private readonly status: CompanyStatusService,
  ) {}

  list(ctx: TenantContext, page: CompaniesQuery) {
    const like = page.q ? `%${page.q}%` : undefined;
    // won: an opportunity in a won stage that isn't lost; lost: opportunities, all lost.
    const wonDeal = sql`exists (select 1 from ${deals} d join ${funnelStages} s on s.id = d.stage_id where d.company_id = ${companies.id} and d.lost_at is null and s.is_won)`;
    const outcome =
      page.outcome === 'won'
        ? wonDeal
        : page.outcome === 'lost'
          ? sql`exists (select 1 from ${deals} d where d.company_id = ${companies.id}) and not exists (select 1 from ${deals} d where d.company_id = ${companies.id} and d.lost_at is null)`
          : undefined;
    return this.database.withTenant(ctx.tenantId, (tx) =>
      tx
        .select({ ...getTableColumns(companies), ownerName: userNameOf(companies.ownerUserId) })
        .from(companies)
        .where(
          and(
            like ? or(ilike(companies.name, like), ilike(companies.industry, like), ilike(companies.hq, like), ilike(companies.pib, like)) : undefined,
            page.ids ? inArray(companies.id, page.ids) : undefined,
            page.status ? inArray(companies.status, page.status) : undefined,
            outcome,
          ),
        )
        .orderBy(asc(companies.name))
        .limit(page.limit)
        .offset(page.offset),
    );
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.find(tx, id));
  }

  private async find(tx: Tx, id: string) {
    const [row] = await tx.select().from(companies).where(eq(companies.id, id));
    if (!row) throw new NotFoundException('Company not found');
    return row;
  }

  create(ctx: TenantContext, input: CreateCompany) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        await assertPibFree(tx, input.pib);
        // A create that sends custom field values (a create form) must fill the required ones.
        const { customFields: cfInput, ...fields } = input;
        const cf = await this.customFields.validate(tx, 'company', cfInput, { requireAll: cfInput !== undefined });
        const [row] = await tx
          .insert(companies)
          .values({ ownerUserId: ctx.userId, ...fields, customFields: cf.set, tenantId: ctx.tenantId })
          .returning();
        await this.audit.record(tx, ctx, { action: 'company.created', entityType: 'company', entityId: row!.id });
        await this.status.recompute(tx, ctx, [row!.id]);
        return this.find(tx, row!.id);
      })
      .catch(mapDbError);
  }

  /** With a `version` (If-Match), a field someone else changed since then is a 409 conflict (CD-20). */
  update(ctx: TenantContext, id: string, input: UpdateCompany, version?: Date) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        if (version) {
          const [locked] = await tx.select().from(companies).where(eq(companies.id, id)).for('update');
          if (!locked) throw new NotFoundException('Company not found');
          await this.changes.assertNoConflict(tx, ctx, 'company', locked, input, version);
        }
        await assertOwnerIsMember(tx, ctx, input.ownerUserId);
        if (input.pib) await assertPibFree(tx, input.pib, id);
        const { customFields: cfInput, ...fields } = input;
        const patch: PgUpdateSetSource<typeof companies> = { ...fields };
        if (cfInput !== undefined) patch.customFields = this.customFields.merged(companies.customFields, await this.customFields.validate(tx, 'company', cfInput));
        const [row] = await tx.update(companies).set(patch).where(eq(companies.id, id)).returning();
        if (!row) throw new NotFoundException('Company not found');
        await this.audit.record(tx, ctx, { action: 'company.updated', entityType: 'company', entityId: id, data: input });
        // Its identity and address count towards Opportunity (CD-358).
        await this.status.recompute(tx, ctx, [id]);
        return this.find(tx, id);
      })
      .catch(mapDbError);
  }

  /**
   * A company with deals or meetings can't be deleted (409): they would lose their customer, so
   * they have to be deleted or moved first. The same goes for a company in a visit plan (CD-134).
   * Its contacts are kept and no longer belong to a company.
   */
  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [company] = await tx.select({ name: companies.name }).from(companies).where(eq(companies.id, id));
        if (!company) throw new NotFoundException('Company not found');
        const [open] = await tx.select({ n: count() }).from(deals).where(eq(deals.companyId, id));
        if (open && open.n > 0) {
          const what = open.n === 1 ? '1 opportunity' : `${open.n} opportunities`;
          throw new ConflictException(`${company.name} has ${what}. Delete them or move them to another company first.`);
        }
        const [booked] = await tx.select({ n: count() }).from(meetings).where(eq(meetings.companyId, id));
        if (booked && booked.n > 0) {
          const what = booked.n === 1 ? '1 meeting' : `${booked.n} meetings`;
          throw new ConflictException(`${company.name} has ${what}. Delete them or move them to another company first.`);
        }
        // Projects (CD-233) belong to their company; the projects FK refuses it too.
        const [owned] = await tx.select({ n: count() }).from(projects).where(eq(projects.companyId, id));
        if (owned && owned.n > 0) {
          const what = owned.n === 1 ? '1 project' : `${owned.n} projects`;
          throw new ConflictException(`${company.name} has ${what}. Delete them or move them to another company first.`);
        }
        // Visit plans (CD-134) name their customers; a plan would silently lose one.
        const [planned] = await tx.select({ n: count() }).from(visitPlanLines).where(eq(visitPlanLines.companyId, id));
        if (planned && planned.n > 0) {
          const what = planned.n === 1 ? '1 visit plan' : `${planned.n} visit plans`;
          throw new ConflictException(`${company.name} is in ${what}. Remove it from the plans first.`);
        }
        const detached = await tx.update(contacts).set({ companyId: null }).where(eq(contacts.companyId, id)).returning({ id: contacts.id });
        await tx.delete(companies).where(eq(companies.id, id));
        await this.audit.record(tx, ctx, { action: 'company.deleted', entityType: 'company', entityId: id, data: { detachedContacts: detached.length } });
      })
      .catch(mapDbError);
  }
}
