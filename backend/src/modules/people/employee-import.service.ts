import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { SecretBox } from '../../infrastructure/crypto/secret-box';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { departments, employeePersonal, employees, teams, tenants } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { ColumnMappingSchema, failureReason, IMPORT_BATCH_SIZE, prepareImport, PREVIEW_PROBLEMS, PREVIEW_ROWS, templateCsvOf } from '../../shared/import/import-file';
import type { BankAccountChange } from './bank-email';
import { employeeIbanBox } from './bank-email';
import { EMPLOYEE_IMPORT_FIELDS } from './employee-import-fields';
import { type ImportLookups, type ImportPlan, orgKey, planImport, type RowPlan } from './employee-import-plan';
import { shortMaskIban } from './iban';
import { PeopleAccess } from './people-access';
import { lockReportingLines } from './reporting-lines';

export const EmployeeImportRequest = z.object({
  csv: z.string().min(1, 'The file is empty'),
  /** Field key → column index; omitted on the first preview, which guesses it from the headers. */
  mapping: ColumnMappingSchema.optional(),
  /** A row whose work email matches an existing employee: skip it (default) or update that employee. */
  duplicates: z.enum(['skip', 'update']).default('skip'),
  /** Admins only (spec 8.6): invite every new employee with a work email to Pultly as a Member. */
  invite: z.boolean().default(false),
});
export type EmployeeImportRequest = z.infer<typeof EmployeeImportRequest>;

const TYPE = 'employees';

/**
 * Employee import (CD-141, spec 8): the CSV import's pipeline (shared/import) with the type
 * "employees". An .xlsx is read in the browser and arrives here as CSV text, so there is one server
 * path with one set of limits. Administration and Admins only.
 *
 * `preview` plans the whole file (employee-import-plan.ts) and writes nothing. `commit` plans it
 * again (the server never trusts the preview) and saves it:
 *   phase 1: new departments and teams, then employees in batches of 200 without managers, each
 *            batch one transaction with multi-row inserts; a refused batch is redone row by row in
 *            savepoints, so only bad rows fail. One audit entry per batch. History says "imported".
 *   phase 2: the managers of every saved row in one transaction, under the reporting-line lock,
 *            with the loop check over the final tree. A row whose manager's row failed is saved
 *            without a manager and listed. No "New manager" emails (spec 10.2).
 * Live updates are quiet during the import; the last transaction sends one "re-read the list" hint
 * per type. Invitations (Admins, optional) are queued as one `people.bulk-invite` job (as Members).
 */
@Injectable()
export class EmployeeImportService {
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

  /** The CSV template: field labels and one example row. */
  template(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.assertAllowed(tx, ctx, false);
      return templateCsv();
    });
  }

  async preview(ctx: TenantContext, req: EmployeeImportRequest) {
    const { lookups, canInvite } = await this.database.withTenant(ctx.tenantId, async (tx) => ({ ...(await this.assertAllowed(tx, ctx, req.invite)), lookups: await this.lookups(tx, ctx.tenantId) }));
    const prep = prepareImport(EMPLOYEE_IMPORT_FIELDS, TYPE, req.csv, req.mapping);
    const plan = planImport(prep.rows, prep.mapping, req.duplicates, lookups);
    const counts = { rows: plan.rows.length, create: 0, update: 0, skip: 0, invalid: 0, warnings: 0, newDepartments: plan.newDepartments.length, newTeams: plan.newTeams.length, invitations: 0 };
    for (const p of plan.rows) {
      counts[p.status]++;
      if (p.warnings.length && (p.status === 'create' || p.status === 'update')) counts.warnings++;
      if (p.status === 'create' && p.email) counts.invitations++;
    }
    return {
      type: TYPE,
      delimiter: prep.delimiter,
      headers: prep.headers,
      mapping: prep.mapping,
      fields: EMPLOYEE_IMPORT_FIELDS,
      missingRequired: prep.missingRequired,
      warnings: prep.warnings,
      counts,
      newDepartments: plan.newDepartments,
      newTeams: plan.newTeams.map((t) => `${t.department} / ${t.name}`),
      canInvite,
      rows: plan.rows.slice(0, PREVIEW_ROWS).map((p) => ({ line: p.line, values: p.values, status: p.status, messages: p.messages, warnings: p.warnings, notes: p.notes })),
      problems: plan.rows
        .filter((p) => p.status === 'invalid')
        .slice(0, PREVIEW_PROBLEMS)
        .map((p) => ({ line: p.line, messages: p.messages })),
    };
  }

  async commit(ctx: TenantContext, req: EmployeeImportRequest) {
    const prep = prepareImport(EMPLOYEE_IMPORT_FIELDS, TYPE, req.csv, req.mapping);
    if (prep.missingRequired.length) throw new BadRequestException(`Choose a column for ${prep.missingRequired.join(', ')}`);
    const lookups = await this.database.withTenant(ctx.tenantId, async (tx) => {
      await this.assertAllowed(tx, ctx, req.invite);
      return this.lookups(tx, ctx.tenantId);
    });
    const plan = planImport(prep.rows, prep.mapping, req.duplicates, lookups);
    if (plan.rows.some((p) => p.iban) && !this.box) throw new ConflictException("Bank accounts can't be stored: the server has no APP_SECRET");

    // ------------------------------------------------------------ phase 1a: departments and teams
    const org = await this.database.withTenant(ctx.tenantId, async (tx) => {
      await quiet(tx);
      const created = await this.createOrg(tx, ctx.tenantId, plan);
      if (created.departments.length || created.teams.length) {
        await this.audit.record(tx, ctx, { action: 'employee.import_org_created', entityType: 'employee', data: { departments: created.departments.length, teams: created.teams.length } });
      }
      return { ...created, ids: await this.orgIds(tx) };
    });

    // ------------------------------------------------------------ phase 1b: employees, without managers
    const summary = { created: 0, updated: 0, skipped: 0, failed: 0 };
    const failures: { line: number; reason: string; cells: string[] }[] = [];
    const skippedRows: { line: number; reason: string }[] = [];
    const saved = new Set<RowPlan>();
    const failed = new Map<RowPlan, string>();
    for (const p of plan.rows) {
      if (p.status === 'invalid') failed.set(p, p.messages.join('; '));
      if (p.status === 'skip') skippedRows.push({ line: p.line, reason: p.messages.join('; ') });
    }
    const writable = plan.rows.filter((p) => p.status === 'create' || p.status === 'update');
    for (let start = 0; start < plan.rows.length; start += IMPORT_BATCH_SIZE) {
      const batch = plan.rows.slice(start, start + IMPORT_BATCH_SIZE);
      const rows = batch.filter((p) => p.status === 'create' || p.status === 'update');
      const audit = (tx: Tx, ok: RowPlan[]) =>
        this.audit.record(tx, ctx, {
          action: 'employee.imported',
          entityType: 'employee',
          data: {
            firstLine: batch[0]!.line,
            lastLine: batch[batch.length - 1]!.line,
            created: ok.filter((p) => p.status === 'create').length,
            updated: ok.filter((p) => p.status === 'update').length,
            skipped: batch.filter((p) => p.status === 'skip').length,
            failed: batch.length - ok.length - batch.filter((p) => p.status === 'skip').length,
          },
        });
      let done = false;
      try {
        // Fast path: the whole batch with a few multi-row statements.
        await this.database.withTenant(ctx.tenantId, async (tx) => {
          await quiet(tx);
          await this.saveRows(tx, ctx, rows, org.ids);
          await audit(tx, rows);
        });
        rows.forEach((p) => saved.add(p));
        done = true;
      } catch {
        // The database refused something in the batch (e.g. an email taken meanwhile): redo it row
        // by row, each in a savepoint, so only the bad rows fail.
      }
      if (done) continue;
      try {
        await this.database.withTenant(ctx.tenantId, async (tx) => {
          await quiet(tx);
          const ok: RowPlan[] = [];
          for (const p of rows) {
            try {
              await tx.transaction((sp) => this.saveRows(sp, ctx, [p], org.ids));
              ok.push(p);
            } catch (err) {
              failed.set(p, failureReason(err));
            }
          }
          await audit(tx, ok);
          ok.forEach((p) => saved.add(p));
        });
      } catch (err) {
        // The batch transaction itself failed: stop, and report the rest as not imported.
        const reason = `Not imported: ${failureReason(err)}`;
        for (const p of plan.rows.slice(start)) if (p.status === 'create' || p.status === 'update') failed.set(p, reason);
        for (const p of rows) saved.delete(p);
        break;
      }
    }

    // ------------------------------------------------------------ phase 2: managers, invitations, one hint
    const managers = await this.database.withTenant(ctx.tenantId, async (tx) => {
      await quiet(tx);
      const result = await this.setManagers(tx, ctx, writable, saved);
      const invitees = req.invite ? writable.filter((p) => p.status === 'create' && saved.has(p) && p.email).map((p) => p.id) : [];
      if (invitees.length) await this.jobs.send('people.bulk-invite', { tenantId: ctx.tenantId, actorUserId: ctx.userId, employeeIds: invitees, role: 'member' }, tx);
      // One "re-read the list" hint per type for everyone else (ids null), now that it's all saved.
      for (const type of ['employee', ...(org.departments.length ? ['department'] : []), ...(org.teams.length ? ['team'] : [])]) {
        await tx.execute(
          sql`select pg_notify('crm_changes', json_build_object('t', ${ctx.tenantId}::text, 'type', ${type}::text, 'op', 'update', 'ids', null, 'dealIds', null, 'client', app_current_client())::text)`,
        );
      }
      return { ...result, invitationsQueued: invitees.length };
    });

    for (const p of plan.rows) {
      const reason = failed.get(p);
      if (reason !== undefined) {
        summary.failed++;
        failures.push({ line: p.line, reason, cells: p.cells });
      } else if (p.status === 'skip') summary.skipped++;
      else if (saved.has(p)) summary[p.status === 'create' ? 'created' : 'updated']++;
    }
    failures.sort((a, b) => a.line - b.line);
    return {
      type: TYPE,
      ...summary,
      newDepartments: org.departments,
      newTeams: org.teams,
      invitationsQueued: managers.invitationsQueued,
      withoutManager: managers.withoutManager,
      headers: prep.headers,
      failures,
      skippedRows,
    };
  }

  // ------------------------------------------------------------------ access and lookups

  /** Administration and Admin import (spec 9.3); only Admins invite (Q1). */
  private async assertAllowed(tx: Tx, ctx: TenantContext, invite: boolean) {
    const access = await this.access.of(ctx, tx);
    if (!access.isHr) throw new ForbiddenException('Only Administration and Admins import employees');
    if (invite && !access.isAdmin) throw new ForbiddenException('Only Admins invite employees to Pultly');
    return { canInvite: access.isAdmin };
  }

  private async lookups(tx: Tx, tenantId: string): Promise<ImportLookups> {
    const [settings] = await tx
      .select({ defaultWeeklyHours: tenants.employeeDefaultWeeklyHours, numberRequired: tenants.employeeNumberRequired })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const list = await tx
      .select({
        id: employees.id,
        fullName: employees.fullName,
        workEmail: employees.workEmail,
        employeeNumber: employees.employeeNumber,
        managerId: employees.managerId,
        departmentId: employees.departmentId,
        teamId: employees.teamId,
        employmentStartDate: employees.employmentStartDate,
        deactivatedAt: employees.deactivatedAt,
      })
      .from(employees);
    return {
      employees: list,
      departments: await tx.select({ id: departments.id, name: departments.name }).from(departments),
      teams: await tx.select({ id: teams.id, departmentId: teams.departmentId, name: teams.name }).from(teams),
      defaultWeeklyHours: settings?.defaultWeeklyHours ?? 40,
      numberRequired: settings?.numberRequired ?? false,
    };
  }

  /** Department ids by name key, team ids by department id and name key. */
  private async orgIds(tx: Tx) {
    const depts = await tx.select({ id: departments.id, name: departments.name }).from(departments);
    const list = await tx.select({ id: teams.id, departmentId: teams.departmentId, name: teams.name }).from(teams);
    return {
      departments: new Map(depts.map((d) => [orgKey(d.name), d.id])),
      teams: new Map(list.map((t) => [`${t.departmentId}\u0000${orgKey(t.name)}`, { id: t.id, departmentId: t.departmentId }])),
    };
  }

  /** Creates the plan's new departments and teams; one made meanwhile by someone else is used as is. */
  private async createOrg(tx: Tx, tenantId: string, plan: ImportPlan) {
    const createdDepartments = plan.newDepartments.length
      ? await tx
          .insert(departments)
          .values(plan.newDepartments.map((name) => ({ tenantId, name })))
          .onConflictDoNothing()
          .returning({ name: departments.name })
      : [];
    const ids = await this.orgIds(tx);
    const teamRows = plan.newTeams
      .map((t) => ({ tenantId, departmentId: ids.departments.get(orgKey(t.department))!, name: t.name }))
      .filter((t) => t.departmentId && !ids.teams.has(`${t.departmentId}\u0000${orgKey(t.name)}`));
    const createdTeams = teamRows.length ? await tx.insert(teams).values(teamRows).onConflictDoNothing().returning({ name: teams.name, departmentId: teams.departmentId }) : [];
    const names = new Map((await tx.select({ id: departments.id, name: departments.name }).from(departments)).map((d) => [d.id, d.name]));
    return {
      departments: createdDepartments.map((d) => d.name),
      teams: createdTeams.map((t) => `${names.get(t.departmentId) ?? ''} / ${t.name}`),
    };
  }

  // ------------------------------------------------------------------ writes

  /**
   * Saves rows (phase 1): inserts the new employees and their personal details with multi-row
   * statements, updates the matched ones with only the fields their row has (never the work email,
   * never the status). IBANs are sealed; a changed IBAN of an updated employee queues the "Bank
   * account changed" email (spec 10.2).
   */
  private async saveRows(tx: Tx, ctx: TenantContext, rows: RowPlan[], org: Awaited<ReturnType<EmployeeImportService['orgIds']>>) {
    const tenantId = ctx.tenantId;
    const creates = rows.filter((p) => p.status === 'create');
    const updates = rows.filter((p) => p.status === 'update');
    const orgOf = (p: RowPlan) => {
      if (!p.department) return null;
      const departmentId = org.departments.get(orgKey(p.department))!;
      const teamId = p.team ? (org.teams.get(`${departmentId}\u0000${orgKey(p.team)}`)?.id ?? null) : null;
      return { departmentId, teamId };
    };

    if (creates.length) {
      await tx.insert(employees).values(
        creates.map((p) => {
          const o = orgOf(p);
          return {
            id: p.id,
            tenantId,
            firstName: p.work.firstName!,
            lastName: p.work.lastName!,
            workEmail: p.work.workEmail ?? null,
            employeeNumber: p.work.employeeNumber ?? null,
            jobTitle: p.work.jobTitle ?? null,
            workPhone: p.work.workPhone ?? null,
            workLocation: p.work.workLocation ?? null,
            employmentStartDate: p.work.employmentStartDate ?? null,
            employmentType: p.work.employmentType ?? 'permanent',
            weeklyHours: p.work.weeklyHours,
            departmentId: o?.departmentId ?? null,
            teamId: o?.teamId ?? null,
            createdByUserId: ctx.userId,
          };
        }),
      );
      const personal = creates.filter((p) => Object.keys(p.personal).length || p.iban).map((p) => ({ tenantId, employeeId: p.id, ...p.personal, ...this.sealed(p) }));
      if (personal.length) await tx.insert(employeePersonal).values(personal);
    }

    if (updates.length) {
      const current = await tx
        .select({ employeeId: employeePersonal.employeeId, ibanSealed: employeePersonal.ibanSealed, ibanMasked: employeePersonal.ibanMasked })
        .from(employeePersonal)
        .where(inArray(employeePersonal.employeeId, updates.map((p) => p.id)));
      const currentOf = new Map(current.map((c) => [c.employeeId, c]));
      const teamDepartment = new Map([...org.teams.values()].map((t) => [t.id, t.departmentId]));
      for (const p of updates) {
        const set: Partial<typeof employees.$inferInsert> = { ...p.work };
        const o = orgOf(p);
        if (o) {
          set.departmentId = o.departmentId;
          // A team must be in the employee's department: keep the current one only if it is.
          if (p.team) set.teamId = o.teamId;
          else if (p.existing?.teamId && teamDepartment.get(p.existing.teamId) !== o.departmentId) set.teamId = null;
        }
        if (Object.keys(set).length) await tx.update(employees).set(set).where(eq(employees.id, p.id));
        else await tx.execute(sql`update employees set updated_at = updated_at where id = ${p.id}`);

        const before = currentOf.get(p.id);
        const iban = p.iban && (before?.ibanSealed ? this.box!.open(before.ibanSealed) : null) !== p.iban.iban ? this.sealed(p) : {};
        const personal = { ...p.personal, ...iban };
        if (Object.keys(personal).length) {
          await tx
            .insert(employeePersonal)
            .values({ tenantId, employeeId: p.id, ...personal })
            .onConflictDoUpdate({ target: [employeePersonal.tenantId, employeePersonal.employeeId], set: personal });
        }
        if ('ibanMasked' in iban && iban.ibanMasked) {
          const change: BankAccountChange = { account: 'iban', kind: before?.ibanMasked ? 'changed' : 'added', masked: iban.ibanMasked };
          await this.jobs.send('people.bank-account-changed-email', { tenantId, employeeId: p.id, actorUserId: ctx.userId, changes: [change] }, tx);
        }
      }
    }
  }

  /** The sealed IBAN columns of a row (empty when it has none). */
  private sealed(p: RowPlan) {
    if (!p.iban) return {};
    return { ibanSealed: this.box!.seal(p.iban.iban), ibanLast4: p.iban.iban.slice(-4), ibanCountry: p.iban.country, ibanMasked: shortMaskIban(p.iban.iban) };
  }

  /**
   * Phase 2 (spec 8.7): the managers of the saved rows, in one transaction under the reporting-line
   * lock. The tree is read again under the lock and checked for loops with every change applied; a
   * change whose manager's row failed, whose manager has left meanwhile, or that would close a loop
   * is left out and listed ("Imported without manager: …").
   */
  private async setManagers(tx: Tx, ctx: TenantContext, rows: RowPlan[], saved: Set<RowPlan>) {
    await lockReportingLines(tx, ctx.tenantId);
    const tree = await tx.select({ id: employees.id, managerId: employees.managerId, deactivatedAt: employees.deactivatedAt, fullName: employees.fullName }).from(employees);
    const byId = new Map(tree.map((e) => [e.id, e]));
    const withoutManager: { line: number; reason: string }[] = [];
    const changes = new Map<string, { row: RowPlan; managerId: string | null }>();
    for (const p of rows) {
      if (!saved.has(p) || !p.manager) continue;
      let managerId: string;
      if (p.manager.kind === 'row') {
        const target = p.manager.row;
        if (!saved.has(target)) {
          withoutManager.push({ line: p.line, reason: `${p.status === 'create' ? 'Imported without manager' : 'Manager not changed'}: the manager's row (line ${target.line}) failed` });
          continue;
        }
        managerId = target.id;
      } else managerId = p.manager.id;
      const manager = byId.get(managerId);
      if (!manager || manager.deactivatedAt) {
        withoutManager.push({ line: p.line, reason: `${p.status === 'create' ? 'Imported without manager' : 'Manager not changed'}: the manager has left the company` });
        continue;
      }
      if (byId.get(p.id)?.managerId !== managerId) changes.set(p.id, { row: p, managerId });
    }

    // The loop check over the final tree; a change that closes a loop is dropped, then check again.
    for (;;) {
      const managerOf = (id: string) => (changes.has(id) ? changes.get(id)!.managerId : (byId.get(id)?.managerId ?? null));
      let dropped = false;
      for (const [id, change] of changes) {
        const seen = new Set<string>([id]);
        const chain = [byId.get(id)?.fullName ?? ''];
        for (let at = change.managerId; at; at = managerOf(at)) {
          chain.push(byId.get(at)?.fullName ?? '');
          if (at === id) {
            withoutManager.push({ line: change.row.line, reason: `Imported without manager: reporting loop ${chain.join(' → ')}` });
            changes.delete(id);
            dropped = true;
            break;
          }
          if (seen.has(at)) break;
          seen.add(at);
        }
        if (dropped) break;
      }
      if (!dropped) break;
    }

    const list = [...changes.entries()];
    for (let i = 0; i < list.length; i += 1000) {
      const chunk = list.slice(i, i + 1000);
      const values = sql.join(
        chunk.map(([id, c]) => sql`(${id}::uuid, ${c.managerId}::uuid)`),
        sql`, `,
      );
      await tx.execute(sql`update employees as e set manager_id = v.manager_id from (values ${values}) as v(id, manager_id) where e.id = v.id`);
    }
    if (list.length) await this.audit.record(tx, ctx, { action: 'employee.import_managers_set', entityType: 'employee', data: { managers: list.length, withoutManager: withoutManager.length } });
    withoutManager.sort((a, b) => a.line - b.line);
    return { withoutManager };
  }
}

/** Transaction-local switches (drizzle/0040): history says "imported", live-update hints wait for the end. */
async function quiet(tx: Tx) {
  await tx.execute(sql`select set_config('app.change_action', 'imported', true), set_config('app.quiet_notify', 'on', true)`);
}

/** The CSV template (labels and an example row, UTF-8 with a BOM). */
export const templateCsv = (): string => templateCsvOf(EMPLOYEE_IMPORT_FIELDS);
