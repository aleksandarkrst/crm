import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { SecretBox } from '../../infrastructure/crypto/secret-box';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { JobsService } from '../../shared/events/jobs.service';
import { departments, employeePersonal, employees, teams } from '../../shared/database/schema';
import { employeeIbanBox } from './bank-email';
import { editableFields, listFields } from './field-rules';
import { checkHeadMoves } from './heads';
import { formatIban } from './iban';
import { PeopleAccess } from './people-access';
import { assertValidManager, lockReportingLines, queueManagerEmails } from './reporting-lines';

/** At most this many rows per bulk action or export (the list shows up to 5,000, spec 5.4). */
export const MAX_BULK = 5000;
const EmployeeIds = z
  .array(z.uuid())
  .min(1, 'Pick at least one employee')
  .max(MAX_BULK, `At most ${MAX_BULK} employees at once`)
  .transform((ids) => [...new Set(ids)]);

/**
 * POST /api/people/employees/bulk (spec 5.4, "Set department and team" and "Set manager"): the
 * same values for every listed employee. Department and team go together: a team sets its
 * department, a department alone clears the team, null for both is "No department".
 */
export const BulkUpdateEmployees = z
  .object({
    employeeIds: EmployeeIds,
    departmentId: z.uuid().nullish(),
    teamId: z.uuid().nullish(),
    managerId: z.uuid().nullish(),
    /** Confirms moving department heads and team leads elsewhere, which ends that role (CD-225). */
    clearHeadRoles: z.boolean().optional(),
  })
  .refine((b) => b.departmentId !== undefined || b.teamId !== undefined || b.managerId !== undefined, 'Nothing to change: send departmentId and teamId, or managerId');
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
        const setsOrg = input.departmentId !== undefined || input.teamId !== undefined;
        const setsManager = input.managerId !== undefined;
        // The reporting-line lock comes before any row lock (reporting-lines.ts).
        if (setsManager) await lockReportingLines(tx, ctx.tenantId);

        const rows = await tx
          .select({ id: employees.id, fullName: employees.fullName, departmentId: employees.departmentId, teamId: employees.teamId, managerId: employees.managerId, deactivatedAt: employees.deactivatedAt })
          .from(employees)
          .where(inArray(employees.id, ids))
          .for('no key update');
        if (rows.length !== ids.length || rows.some((r) => r.deactivatedAt)) throw new BadRequestException('Only active employees of this workspace can be changed');

        // The card's rules, row by row (only Admins change department, team and manager).
        const fields = [...(setsOrg ? (['departmentId', 'teamId'] as const) : []), ...(setsManager ? (['managerId'] as const) : [])];
        for (const r of rows) {
          const allowed = new Set<string>(editableFields(access, r.id, true));
          const refused = fields.filter((f) => !allowed.has(f));
          if (refused.length) throw new ForbiddenException(`Only an Admin can change ${listFields(refused)} on their own card. Untick ${r.fullName}.`);
        }

        const org = setsOrg ? await resolveOrg(tx, input.departmentId ?? null, input.teamId ?? null) : null;
        const managerId = input.managerId ?? null;
        if (setsManager && managerId) {
          if (managerId === access.employeeId && !access.isAdmin) throw new ForbiddenException("Only an Admin can make themselves someone's manager");
          await assertNoLoops(tx, ids, managerId);
        }

        const changed = rows.filter(
          (r) => (org && (r.departmentId !== org.departmentId || r.teamId !== org.teamId)) || (setsManager && r.managerId !== managerId),
        );
        if (org) {
          const moving = changed.filter((r) => r.departmentId !== org.departmentId || r.teamId !== org.teamId);
          await checkHeadMoves(tx, moving.map((r) => ({ employeeId: r.id, fullName: r.fullName, from: r, to: org })), !!input.clearHeadRoles);
        }
        if (changed.length) {
          await tx
            .update(employees)
            .set({ ...(org ?? {}), ...(setsManager ? { managerId } : {}) })
            .where(inArray(employees.id, changed.map((r) => r.id)));
          await this.audit.record(tx, ctx, { action: 'employee.bulk_updated', entityType: 'employee', data: { fields, count: changed.length } });
          // "New manager" / "New direct report" for the rows whose manager changed (CD-139).
          if (setsManager) {
            const moved = changed.filter((r) => r.managerId !== managerId).map((r) => ({ employeeId: r.id, oldManagerId: r.managerId, newManagerId: managerId }));
            await queueManagerEmails(this.jobs, tx, ctx.tenantId, ctx.userId, moved);
          }
        }
        return { updated: changed.length };
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

/** The department and team every selected employee gets (spec 6.2): a team brings its department. */
async function resolveOrg(tx: Tx, departmentId: string | null, teamId: string | null) {
  if (teamId) {
    const [t] = await tx.select({ departmentId: teams.departmentId }).from(teams).where(eq(teams.id, teamId));
    if (!t) throw new BadRequestException('Team not found');
    if (departmentId && departmentId !== t.departmentId) throw new BadRequestException('The team belongs to another department');
    return { departmentId: t.departmentId, teamId };
  }
  if (departmentId) {
    const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId));
    if (!d) throw new BadRequestException('Department not found');
  }
  return { departmentId, teamId: null };
}

/**
 * Everyone in `ids` reporting to `managerId` must not close a loop (spec 7.2). The chain above
 * the manager doesn't change by these writes unless it contains one of them, so one walk up from
 * the manager decides it; the foundation's assertValidManager then refuses with its own message
 * (not yourself 400, an active employee 400, the loop named 409).
 */
async function assertNoLoops(tx: Tx, ids: string[], managerId: string) {
  await assertValidManager(tx, ids[0]!, managerId);
  if (ids.includes(managerId)) await assertValidManager(tx, managerId, managerId);
  const { rows } = await tx.execute<{ id: string }>(sql`
    with recursive up(id, manager_id, depth) as (
      select id, manager_id, 1 from employees where id = ${managerId}
      union all
      select e.id, e.manager_id, up.depth + 1 from employees e join up on e.id = up.manager_id where up.depth < 1000
    )
    select id::text as id from up`);
  const selected = new Set(ids);
  const inChain = rows.find((r) => selected.has(r.id));
  if (inChain) await assertValidManager(tx, inChain.id, managerId);
}
