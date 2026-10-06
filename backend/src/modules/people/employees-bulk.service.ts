import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { SecretBox } from '../../infrastructure/crypto/secret-box';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { JobsService } from '../../shared/events/jobs.service';
import { employeePersonal, employees } from '../../shared/database/schema';
import { employeeIbanBox } from './bank-email';
import { editableFields, listFields } from './field-rules';
import { formatIban } from './iban';
import { PeopleAccess } from './people-access';
import { changeOrg } from './org-changes';
import { lockReportingLines } from './reporting-lines';

/** At most this many rows per bulk action or export (the list shows up to 5,000, spec 5.4). */
export const MAX_BULK = 5000;
const EmployeeIds = z
  .array(z.uuid())
  .min(1, 'Pick at least one employee')
  .max(MAX_BULK, `At most ${MAX_BULK} employees at once`)
  .transform((ids) => [...new Set(ids)]);

/**
 * POST /api/people/employees/bulk (spec 5.4, "Set unit" and "Set manager"; the chart's drag): the
 * same values for every listed employee. The org rules apply (org-rules.ts, CD-226): a unit brings
 * its lead as manager, a manager their unit, unless the body sets both. `unitId` null is "No unit".
 */
export const BulkUpdateEmployees = z
  .object({
    employeeIds: EmployeeIds,
    unitId: z.uuid().nullish(),
    managerId: z.uuid().nullish(),
    /** Confirms moving unit leads elsewhere, which ends that role (CD-225, CD-226). */
    clearLeadRoles: z.boolean().optional(),
  })
  .refine((b) => b.unitId !== undefined || b.managerId !== undefined, 'Nothing to change: send unitId or managerId');
export type BulkUpdateEmployees = z.infer<typeof BulkUpdateEmployees>;

/** POST /api/people/employees/export: personal details and bank accounts of these employees. */
export const ExportEmployees = z.object({ employeeIds: EmployeeIds });
export type ExportEmployees = z.infer<typeof ExportEmployees>;

/**
 * Bulk actions and the personal-details export of the Org structure list (spec 5.4), for
 * Admins. Bulk changes are one transaction: every row passes the card's field
 * rules (field-rules.ts) and the reporting-line rules (lock, no loops) or nothing is saved.
 */
@Injectable()
export class EmployeesBulkService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly database: DatabaseService,
    private readonly access: PeopleAccess,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    @Inject(ENV) env: Env,
  ) {
    this.box = employeeIbanBox(env);
  }

  /** Returns `{ updated }`: how many employees actually changed (the others had these values already). */
  update(ctx: TenantContext, input: BulkUpdateEmployees) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isHr) throw new ForbiddenException('Only Admins change employees in bulk');
        const ids = input.employeeIds;
        const setsUnit = input.unitId !== undefined;
        const setsManager = input.managerId !== undefined;
        // The reporting-line lock comes before anything else (reporting-lines.ts).
        await lockReportingLines(tx, ctx.tenantId);

        const rows = await tx.select({ id: employees.id, fullName: employees.fullName, deactivatedAt: employees.deactivatedAt }).from(employees).where(inArray(employees.id, ids));
        if (rows.length !== ids.length || rows.some((r) => r.deactivatedAt)) throw new BadRequestException('Only active employees of this workspace can be changed');

        // The card's rules, row by row (only Admins change unit and manager).
        const fields = [...(setsUnit ? (['unitId'] as const) : []), ...(setsManager ? (['managerId'] as const) : [])];
        for (const r of rows) {
          const allowed = new Set<string>(editableFields(access, r.id, true));
          const refused = fields.filter((f) => !allowed.has(f));
          if (refused.length) throw new ForbiddenException(`Only an Admin can change ${listFields(refused)} on their own card. Untick ${r.fullName}.`);
        }
        const managerId = input.managerId ?? null;
        if (setsManager && managerId && managerId === access.employeeId && !access.isAdmin) throw new ForbiddenException("Only an Admin can make themselves someone's manager");

        const written = await changeOrg(
          tx,
          ctx.tenantId,
          ids.map((employeeId) => ({ employeeId, ...(setsUnit ? { unitId: input.unitId ?? null } : {}), ...(setsManager ? { managerId } : {}) })),
          { jobs: this.jobs, actorUserId: ctx.userId, clearLeadRoles: !!input.clearLeadRoles },
        );
        if (written.changed.length) {
          await this.audit.record(tx, ctx, { action: 'employee.bulk_updated', entityType: 'employee', data: { fields, count: written.changed.length } });
        }
        return { updated: written.changed.length };
      })
      .catch(mapDbError);
  }

  /**
   * "Include personal details and bank accounts" (spec 5.4, 9.5): Admins only.
   * Full IBANs, so every export writes the audit entry "employee.personal_exported" with how many
   * rows were exported (the actor is the caller).
   */
  exportPersonal(ctx: TenantContext, input: ExportEmployees) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      if (!access.isHr) throw new ForbiddenException('Only Admins export personal details and bank accounts');
      const rows = await tx
        .select({ id: employees.id, p: employeePersonal })
        .from(employees)
        .leftJoin(employeePersonal, eq(employeePersonal.employeeId, employees.id))
        .where(inArray(employees.id, input.employeeIds));
      const open = (sealed: string | null | undefined) => {
        const plain = sealed ? this.box?.open(sealed) : null;
        return plain ? formatIban(plain) : null;
      };
      const out = rows.map(({ id, p }) => ({
        id,
        personal: {
          dateOfBirth: p?.dateOfBirth ?? null,
          privateEmail: p?.privateEmail ?? null,
          privatePhone: p?.privatePhone ?? null,
          addressStreet: p?.addressStreet ?? null,
          addressPostalCode: p?.addressPostalCode ?? null,
          addressCity: p?.addressCity ?? null,
          addressCountry: p?.addressCountry ?? (p ? 'Serbia' : null),
          emergencyContactName: p?.emergencyContactName ?? null,
          emergencyContactPhone: p?.emergencyContactPhone ?? null,
        },
        bank: {
          iban: open(p?.ibanSealed),
          bankName: p?.bankName ?? null,
          fxIban: p?.fxSameAsIban === false ? open(p?.fxIbanSealed) : null,
          fxSameAsIban: p?.fxSameAsIban ?? true,
          swiftBic: p?.swiftBic ?? null,
          fxBankName: p?.fxBankName ?? null,
          fxBankAddress: p?.fxBankAddress ?? null,
        },
      }));
      await this.audit.record(tx, ctx, { action: 'employee.personal_exported', entityType: 'employee', data: { count: out.length } });
      return { employees: out };
    });
  }
}
