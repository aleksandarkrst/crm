import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { SecretBox } from '../../infrastructure/crypto/secret-box';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employeePersonal, employees, invitations, memberships, orgUnits, tenants, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { withdrawEmployeeInvitations } from '../identity';
import type { ApproverResult } from './approvers';
import { type BankAccountChange, employeeIbanBox } from './bank-email';
import { type CallerAccess, FUNCTIONAL_ROLES, type FunctionalRole } from './caller-access';
import type { AccountState, CreateEmployee, DataIssue, EmployeeListQuery, EmployeeStatus, UpdateEmployee } from './employees.schemas';
import { BANK_FIELDS, editableFields, type EmployeeField, EMPLOYMENT_FIELDS, listFields, ORG_FIELDS, PERSONAL_FIELDS } from './field-rules';
import { domesticFromIban, formatIban, maskIban, type ParsedAccount, parseBankAccount, shortMaskIban } from './iban';
import { PeopleAccess } from './people-access';
import { PeopleHistoryService } from './people-history.service';
import { changeOrg } from './org-changes';
import { unitAndBelow } from './org-rules';
import { lockReportingLines } from './reporting-lines';
import { searchPattern } from './search';

const managerRow = alias(employees, 'manager');
const pendingInvitation = (employeeId: SQL | typeof employees.id) =>
  sql`exists (select 1 from ${invitations} i where i.employee_id = ${employeeId} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())`;
/**
 * The people the app shows (CD-226): members, people with a pending invitation, and people who left
 * (the Admins' Inactive view). Other records (added or imported before CD-226, members who were
 * removed) stay in the database but aren't listed, and their card is 404.
 */
export const shownEmployee = sql`(${employees.userId} is not null or ${employees.deactivatedAt} is not null or ${pendingInvitation(employees.id)})`;
export const isShown = (r: { userId: string | null; deactivatedAt: Date | null; invited: boolean }) => !!r.userId || !!r.deactivatedAt || r.invited;

/** Directory and employment columns of the list and card (never personal details or bank accounts). */
const rowColumns = {
  id: employees.id,
  userId: employees.userId,
  firstName: employees.firstName,
  lastName: employees.lastName,
  fullName: employees.fullName,
  jobTitle: employees.jobTitle,
  workEmail: employees.workEmail,
  workPhone: employees.workPhone,
  workLocation: employees.workLocation,
  unitId: employees.unitId,
  unitName: orgUnits.name,
  managerId: employees.managerId,
  managerName: managerRow.fullName,
  managerUserId: managerRow.userId,
  employeeNumber: employees.employeeNumber,
  employmentStartDate: employees.employmentStartDate,
  employmentEndDate: employees.employmentEndDate,
  employmentType: employees.employmentType,
  weeklyHours: employees.weeklyHours,
  timesheetRequired: employees.timesheetRequired,
  attendanceTracked: employees.attendanceTracked,
  deactivatedAt: employees.deactivatedAt,
  leavingReason: employees.leavingReason,
  firstLinkedAt: employees.firstLinkedAt,
  updatedAt: employees.updatedAt,
  invited: sql<boolean>`${pendingInvitation(employees.id)}`,
  hasReports: sql<boolean>`exists (select 1 from ${employees} r where r.manager_id = ${employees.id} and r.deactivated_at is null)`,
  workspaceRole: sql<string | null>`(select m.role from ${memberships} m where m.tenant_id = ${employees.tenantId} and m.user_id = ${employees.userId})`,
};
type EmployeeRow = Awaited<ReturnType<EmployeesService['rows']>>[number];

interface PeopleSettings {
  defaultWeeklyHours: number;
  numberRequired: boolean;
  selfEditBank: boolean;
  workspaceName: string;
  ceoEmployeeId: string | null;
  /**
   * The top of the organisation: the workspace's CEO (CD-225, Org structure → company node), else
   * (CD-224, B15) the one active employee without a manager when exactly one has none. They are
   * not a "No manager" data issue; without a CEO and with several, all are.
   */
  topEmployeeId: string | null;
}

export const statusOf = (r: { deactivatedAt: Date | null; employmentEndDate: string | null }): EmployeeStatus =>
  r.deactivatedAt ? 'inactive' : r.employmentEndDate ? 'leaving' : 'active';
const accountOf = (r: { userId: string | null; invited: boolean }): AccountState => (r.userId ? 'linked' : r.invited ? 'invited' : 'none');
function rolesOf(r: EmployeeRow): FunctionalRole[] {
  const roles = new Set<FunctionalRole>(['employee']);
  if (r.hasReports && !r.deactivatedAt) roles.add('manager');
  if (r.workspaceRole === 'owner' || r.workspaceRole === 'admin') roles.add('admin');
  return FUNCTIONAL_ROLES.filter((x) => roles.has(x));
}

/**
 * Employees (spec 4): the directory list, the card, create, update, the IBAN reveal and delete.
 * What each caller sees and may change comes from PeopleAccess (spec 9): directory fields for
 * everyone, employment fields for self, managers above and HR, personal details and the bank
 * account only for self, Admins. Lists never read employee_personal.
 */
@Injectable()
export class EmployeesService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly database: DatabaseService,
    private readonly access: PeopleAccess,
    private readonly history: PeopleHistoryService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    @Inject(ENV) env: Env,
  ) {
    this.box = employeeIbanBox(env);
  }

  // ------------------------------------------------------------------ list

  /**
   * The directory (spec 5.4), sorted by last name, all rows (up to a few thousand) in one response.
   * Each row: directory fields; `employment` only for rows in the caller's scope; `hr` (account
   * state, data issues) for Admins; `roles` for Admin.
   */
  list(ctx: TenantContext, query: EmployeeListQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const statuses = new Set<EmployeeStatus>(query.status ?? ['active', 'leaving']);
      if (statuses.has('inactive') && !access.canSeeInactive) throw new ForbiddenException('Only Admins see employees who left');
      if (query.account && !access.isAdmin) throw new ForbiddenException('Only Admins filter by account');
      if (query.issues && !access.isHr) throw new ForbiddenException('Only Admins filter by data issues');
      const settings = await this.settings(tx, ctx.tenantId);

      // A unit includes the units inside it (CD-226).
      const unitIds = query.unitIds ? await this.unitsBelow(tx, query.unitIds) : undefined;
      let managerScope: string[] | undefined;
      if (query.managerId && query.managerScope === 'indirect') managerScope = await this.access.reportIdsOf(tx, query.managerId);
      const q = query.q;
      const rows = await this.rows(
        tx,
        and(
          shownEmployee,
          statuses.has('inactive') ? undefined : isNull(employees.deactivatedAt),
          unitIds ? (unitIds.length ? inArray(employees.unitId, unitIds) : sql`false`) : undefined,
          query.managerId ? (managerScope ? (managerScope.length ? inArray(employees.id, managerScope) : sql`false`) : eq(employees.managerId, query.managerId)) : undefined,
          query.ids ? inArray(employees.id, query.ids) : undefined,
          q
            ? or(
                sql`${employees.searchText} like '%' || people_fold(${likeBody(q)}) || '%' escape '\\'`,
                access.isHr ? sql`lower(coalesce(${employees.employeeNumber}, '')) like ${searchPattern(q.toLowerCase())} escape '\\'` : undefined,
              )
            : undefined,
        ),
      );
      const out = [];
      for (const r of rows) {
        const status = statusOf(r);
        // Someone leaving looks active to people who may not see employment dates.
        const shown = status === 'leaving' && !access.canSeeEmployment(r.id) ? 'active' : status;
        if (!statuses.has(shown)) continue;
        const account = accountOf(r);
        if (query.account && !query.account.includes(account)) continue;
        const issues = dataIssues(r, settings);
        if (query.issues && !query.issues.some((i) => issues.includes(i))) continue;
        out.push({
          ...directory(r, shown),
          ...(access.canSeeEmployment(r.id) ? { employment: employment(r, access) } : {}),
          ...(access.isHr ? { hr: { account, dataIssues: issues } } : {}),
          ...(access.isAdmin ? { roles: rolesOf(r) } : {}),
        });
      }
      return { employees: out, total: out.length };
    });
  }

  /** The rows with joins, sorted by last name (no personal data: employee_personal is never joined). */
  private rows(tx: Tx, where: SQL | undefined) {
    return tx
      .select(rowColumns)
      .from(employees)
      .leftJoin(orgUnits, eq(orgUnits.id, employees.unitId))
      .leftJoin(managerRow, eq(managerRow.id, employees.managerId))
      .where(where)
      .orderBy(asc(employees.lastName), asc(employees.firstName), asc(employees.id));
  }

  /** The units and every unit inside them. */
  private async unitsBelow(tx: Tx, ids: string[]): Promise<string[]> {
    const units = await tx.select({ id: orgUnits.id, name: orgUnits.name, parentId: orgUnits.parentId, leadId: orgUnits.leadEmployeeId }).from(orgUnits);
    const snapshot = { people: new Map(), units: new Map(units.map((u) => [u.id, u])), ceoId: null };
    const out = new Set<string>();
    for (const id of ids) if (snapshot.units.has(id)) for (const u of unitAndBelow(snapshot, id)) out.add(u);
    return [...out];
  }

  // ------------------------------------------------------------------ card

  /**
   * The employee card (spec 4.5): sections the caller may not see are left out entirely. A record
   * the app doesn't show (no account, no pending invitation, not deactivated; CD-226) is 404.
   */
  card(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, (tx) => this.cardIn(tx, ctx, id, true));
  }

  /** The card inside an open transaction (the lifecycle actions return it too). */
  async cardIn(tx: Tx, ctx: TenantContext, id: string, onlyShown = false) {
    const access = await this.access.of(ctx, tx);
    const [r] = await this.rows(tx, eq(employees.id, id));
    if (!r || (r.deactivatedAt && !access.canSeeInactive) || (onlyShown && !isShown(r))) throw new NotFoundException('Employee not found');
    const settings = await this.settings(tx, ctx.tenantId);
    const status = statusOf(r);
    const shown = status === 'leaving' && !access.canSeeEmployment(id) ? 'active' : status;

    const managersManager = r.managerId
      ? (
          await tx
            .select({ id: managerRow.id, fullName: managerRow.fullName })
            .from(employees)
            .innerJoin(managerRow, eq(managerRow.id, employees.managerId))
            .where(eq(employees.id, r.managerId))
        )[0]
      : undefined;
    const directReports = await tx
      .select({ id: employees.id, fullName: employees.fullName, jobTitle: employees.jobTitle })
      .from(employees)
      .where(and(eq(employees.managerId, id), isNull(employees.deactivatedAt)))
      .orderBy(asc(employees.lastName), asc(employees.firstName));
    const [leadsUnit] = await tx.select({ id: orgUnits.id, name: orgUnits.name }).from(orgUnits).where(eq(orgUnits.leadEmployeeId, id));
    const approvals = await this.access.approversFor(ctx.tenantId, id, new Date().toISOString().slice(0, 10), tx);

    const card: Record<string, unknown> = {
      ...directory(r, shown),
      /** Send back as If-Match when saving (CD-20 style). */
      version: r.updatedAt,
      account: accountOf(r),
      roles: rolesOf(r),
      manager: r.managerId
        ? { id: r.managerId, fullName: r.managerName, hasAccount: !!r.managerUserId, manager: managersManager ? { id: managersManager.id, fullName: managersManager.fullName } : null }
        : null,
      directReports,
      /** The unit they lead (CD-226: at most one). */
      leadsUnit: leadsUnit ?? null,
      approvals: approvals ? await this.presentApprovers(tx, approvals) : null,
    };
    if (access.canSeeEmployment(id)) card.employment = employment(r, access);
    if (access.isHr) card.hr = { dataIssues: dataIssues(r, settings) };
    if (access.canSeePersonal(id) || access.canSeeBank(id)) {
      const [p] = await tx.select().from(employeePersonal).where(eq(employeePersonal.employeeId, id));
      if (access.canSeePersonal(id)) card.personal = personal(p);
      if (access.canSeeBank(id)) card.bank = this.bank(p);
    }
    if (access.isAdmin) card.appAccess = await this.appAccess(tx, ctx, r);
    card.permissions = {
      editableFields: r.deactivatedAt && !access.isAdmin ? [] : editableFields(access, id, settings.selfEditBank),
      canRevealBank: access.canSeeBank(id),
      canSeeHistory: access.canSeeHistory(id),
      // Delete (CD-225): only once deactivated, then for anyone, former app users included.
      canDelete: access.isAdmin && !!r.deactivatedAt,
      // App access (spec 4.6, 4.7): Admins only.
      canInvite: access.isAdmin && !r.userId && !r.deactivatedAt,
      canLink: access.isAdmin && !r.userId && !r.deactivatedAt,
      canUnlink: access.isAdmin && !!r.userId,
      // Leaving (spec 4.8): Admins; only an Admin on their own card.
      canDeactivate: access.isHr && !r.deactivatedAt && (!access.isSelf(id) || access.isAdmin),
      canReactivate: access.isHr && (!!r.deactivatedAt || !!r.employmentEndDate),
    };
    return card;
  }

  /** Approvers with names, for "Approvals go to: …". */
  private async presentApprovers(tx: Tx, result: ApproverResult) {
    const userIds = result.approvers.map((a) => a.userId);
    const names = new Map<string, string>();
    if (userIds.length) {
      const rows = await tx
        .select({ userId: users.id, employeeName: employees.fullName, userName: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')` })
        .from(users)
        .leftJoin(employees, eq(employees.userId, users.id))
        .where(inArray(users.id, userIds));
      for (const row of rows) names.set(row.userId, row.employeeName ?? row.userName);
    }
    return { ...result, approvers: result.approvers.map((a) => ({ ...a, fullName: names.get(a.userId) ?? 'Member' })) };
  }

  /** App access (Admin only): sign-in email, workspace role, pending invitation. */
  private async appAccess(tx: Tx, ctx: TenantContext, r: EmployeeRow) {
    const [user] = r.userId ? await tx.select({ email: users.email }).from(users).where(eq(users.id, r.userId)) : [];
    const [invitation] = await tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        emailStatus: invitations.emailStatus,
        emailSentAt: invitations.emailSentAt,
        emailError: invitations.emailError,
        hasLink: sql<boolean>`${invitations.tokenSealed} is not null`,
      })
      .from(invitations)
      .where(and(eq(invitations.tenantId, ctx.tenantId), eq(invitations.employeeId, r.id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), sql`${invitations.expiresAt} > now()`))
      .limit(1);
    return { signInEmail: user?.email ?? null, workspaceRole: r.workspaceRole, invitation: invitation ?? null };
  }

  /** The bank section: masks only. The full number comes from `reveal` (audited). */
  private bank(p: typeof employeePersonal.$inferSelect | undefined) {
    const view = (sealed: string | null | undefined, masked: string | null | undefined, last4: string | null | undefined, country: string | null | undefined) => {
      if (!masked) return null;
      const plain = sealed ? this.box?.open(sealed) : null;
      return { masked: plain ? maskIban(plain) : masked, last4: last4 ?? null, country: country ?? null, foreign: country !== 'RS' };
    };
    return {
      iban: view(p?.ibanSealed, p?.ibanMasked, p?.ibanLast4, p?.ibanCountry),
      bankName: p?.bankName ?? null,
      fxSameAsIban: p?.fxSameAsIban ?? true,
      fxIban: view(p?.fxIbanSealed, p?.fxIbanMasked, p?.fxIbanLast4, p?.fxIbanCountry),
      swiftBic: p?.swiftBic ?? null,
      fxBankName: p?.fxBankName ?? null,
      fxBankAddress: p?.fxBankAddress ?? null,
    };
  }

  // ------------------------------------------------------------------ create and update

  /** Admins (spec 9.3). Returns the card. */
  create(ctx: TenantContext, input: CreateEmployee) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isHr) throw new ForbiddenException('Only Admins add employees');
        const settings = await this.settings(tx, ctx.tenantId);
        if (settings.numberRequired && !input.employeeNumber) throw new BadRequestException('The employee number is required in this workspace');
        const id = randomUUID();
        if (input.managerId && input.managerId === access.employeeId && !access.isAdmin) throw new ForbiddenException("Only an Admin can make themselves someone's manager");
        if (input.unitId || input.managerId) await lockReportingLines(tx, ctx.tenantId);
        await tx.insert(employees).values({
            id,
            tenantId: ctx.tenantId,
            firstName: input.firstName,
            lastName: input.lastName,
            workEmail: input.workEmail ?? null,
            employeeNumber: input.employeeNumber ?? null,
            jobTitle: input.jobTitle ?? null,
            workPhone: input.workPhone ?? null,
            workLocation: input.workLocation ?? null,
            employmentStartDate: input.employmentStartDate,
            employmentType: input.employmentType ?? 'permanent',
            weeklyHours: input.weeklyHours ?? settings.defaultWeeklyHours,
            timesheetRequired: input.timesheetRequired ?? true,
            attendanceTracked: input.attendanceTracked ?? false,
            createdByUserId: ctx.userId,
          });
        const changes = await this.savePersonal(tx, ctx, id, input, undefined);
        await this.audit.record(tx, ctx, { action: 'employee.created', entityType: 'employee', entityId: id, data: { fields: sentFields(input) } });
        if (changes.length) await this.jobs.send('people.bank-account-changed-email', { tenantId: ctx.tenantId, employeeId: id, actorUserId: ctx.userId, changes }, tx);
        // The unit and manager by the org rules (CD-226): a unit brings its lead as manager, a manager their unit.
        if (input.unitId || input.managerId) {
          await changeOrg(tx, ctx.tenantId, [{ employeeId: id, ...(input.unitId !== undefined ? { unitId: input.unitId } : {}), ...(input.managerId ? { managerId: input.managerId } : {}) }], {
            jobs: this.jobs,
            actorUserId: ctx.userId,
            clearLeadRoles: false,
          });
        }
        return this.cardIn(tx, ctx, id);
      })
      .catch(mapDbError);
  }

  /**
   * Field by field (spec 4.5, 9.3, field-rules.ts): Admin everything; everyone else only their
   * own work phone, personal details and (when the workspace allows it) bank account. A manager
   * change takes the reporting-line lock and the loop check. With `version` (If-Match), a field
   * someone else changed since is a 409. The unit and manager follow the org rules (org-rules.ts,
   * CD-226: a new unit brings its lead as manager, a new manager their unit; what the body sets
   * explicitly wins). Moving a unit's lead out of their unit is a 409 `heads_unit` unless
   * `clearLeadRoles` (heads.ts). Returns the card.
   */
  update(ctx: TenantContext, id: string, input: UpdateEmployee, version?: Date, clearLeadRoles = false) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        // A manager change takes the workspace's reporting-line lock before any row lock, so two
        // crossing changes (A → B, B → A) queue instead of deadlocking on each other's rows.
        const changesOrg = input.managerId !== undefined || input.unitId !== undefined;
        if (changesOrg) await lockReportingLines(tx, ctx.tenantId);
        const [current] = await tx.select().from(employees).where(eq(employees.id, id)).for('no key update');
        if (!current || (current.deactivatedAt && !access.canSeeInactive)) throw new NotFoundException('Employee not found');
        const settings = await this.settings(tx, ctx.tenantId);

        const sent = sentFields(input);
        const allowed = new Set<string>(editableFields(access, id, settings.selfEditBank));
        const refused = sent.filter((f) => !allowed.has(f));
        if (refused.length) throw new ForbiddenException(refusal(access, id, refused, settings.selfEditBank));
        if (input.managerId && input.managerId !== current.managerId && input.managerId === access.employeeId && !access.isAdmin) throw new ForbiddenException("Only an Admin can make themselves someone's manager");
        if (settings.numberRequired && input.employeeNumber === null) throw new BadRequestException('The employee number is required in this workspace');

        const [currentPersonal] = await tx.select().from(employeePersonal).where(eq(employeePersonal.employeeId, id));
        if (version) {
          await this.history.assertNoConflict(tx, ctx, id, current.updatedAt, comparable(input), this.comparableCurrent(current, currentPersonal), version);
        }

        const work: Partial<typeof employees.$inferInsert> = {};
        for (const f of ['firstName', 'lastName', 'workEmail', 'jobTitle', 'workPhone', 'workLocation', ...EMPLOYMENT_FIELDS] as const) {
          if (input[f] !== undefined) (work as Record<string, unknown>)[f] = input[f];
        }
        if (changesOrg) {
          const unit = input.unitId !== undefined && input.unitId !== current.unitId ? { unitId: input.unitId } : {};
          const manager = input.managerId !== undefined && input.managerId !== current.managerId ? { managerId: input.managerId } : {};
          await changeOrg(tx, ctx.tenantId, [{ employeeId: id, ...unit, ...manager }], { jobs: this.jobs, actorUserId: ctx.userId, clearLeadRoles });
        }

        const changes = await this.savePersonal(tx, ctx, id, input, currentPersonal);
        // A pending invitation went to the old work email: withdrawn, the card asks to invite again (spec 4.7).
        if (input.workEmail !== undefined && (input.workEmail ?? null) !== (current.workEmail ?? null)) await withdrawEmployeeInvitations(tx, ctx.tenantId, id);
        if (Object.keys(work).length) {
          await tx.update(employees).set(work).where(eq(employees.id, id));
        } else if (!changesOrg) {
          // Personal details only: move the card's version (one version per card).
          await tx.execute(sql`update employees set updated_at = updated_at where id = ${id}`);
        }
        await this.audit.record(tx, ctx, { action: 'employee.updated', entityType: 'employee', entityId: id, data: { fields: sent } });
        if (changes.length) await this.jobs.send('people.bank-account-changed-email', { tenantId: ctx.tenantId, employeeId: id, actorUserId: ctx.userId, changes }, tx);
        return this.cardIn(tx, ctx, id);
      })
      .catch(mapDbError);
  }

  /**
   * Writes personal details and the bank account (insert or update of employee_personal). IBANs are
   * sealed; only their last four, country and short mask are stored in the clear. Returns the bank
   * account changes for the "Bank account changed" email.
   */
  private async savePersonal(tx: Tx, ctx: TenantContext, employeeId: string, input: UpdateEmployee, current: typeof employeePersonal.$inferSelect | undefined): Promise<BankAccountChange[]> {
    const set: Partial<typeof employeePersonal.$inferInsert> = {};
    for (const f of [...PERSONAL_FIELDS, 'bankName', 'swiftBic', 'fxBankName', 'fxBankAddress', 'fxSameAsIban'] as const) {
      if (input[f] !== undefined) (set as Record<string, unknown>)[f] = input[f];
    }
    const changes: BankAccountChange[] = [];
    const account = (key: 'iban' | 'fxIban', value: ParsedAccount | null | undefined) => {
      if (value === undefined) return;
      const prefix = key === 'iban' ? 'iban' : 'fxIban';
      const oldMasked = key === 'iban' ? current?.ibanMasked : current?.fxIbanMasked;
      const oldSealed = key === 'iban' ? current?.ibanSealed : current?.fxIbanSealed;
      if (value === null) {
        Object.assign(set, { [`${prefix}Sealed`]: null, [`${prefix}Last4`]: null, [`${prefix}Country`]: null, [`${prefix}Masked`]: null });
        if (oldMasked) changes.push({ account: key, kind: 'removed', masked: oldMasked });
        return;
      }
      if (!this.box) throw new ConflictException("Bank accounts can't be stored: the server has no APP_SECRET");
      const oldPlain = oldSealed ? this.box.open(oldSealed) : null;
      if (oldPlain === value.iban) return;
      const masked = shortMaskIban(value.iban);
      Object.assign(set, {
        [`${prefix}Sealed`]: this.box.seal(value.iban),
        [`${prefix}Last4`]: value.iban.slice(-4),
        [`${prefix}Country`]: value.country,
        [`${prefix}Masked`]: masked,
      });
      changes.push({ account: key, kind: oldMasked ? 'changed' : 'added', masked });
    };
    account('iban', input.iban);
    if (input.fxSameAsIban === true) account('fxIban', current?.fxIbanMasked ? null : undefined);
    else account('fxIban', input.fxIban);
    if (input.fxIban && input.fxSameAsIban === undefined) set.fxSameAsIban = false;
    if (Object.keys(set).length === 0) return changes;
    await tx
      .insert(employeePersonal)
      .values({ tenantId: ctx.tenantId, employeeId, ...set })
      .onConflictDoUpdate({ target: [employeePersonal.tenantId, employeePersonal.employeeId], set });
    return changes;
  }

  /** Current values under the API's field names, for the conflict check (IBANs as plain numbers). */
  private comparableCurrent(e: typeof employees.$inferSelect, p: typeof employeePersonal.$inferSelect | undefined): Record<string, unknown> {
    return {
      ...e,
      ...(p ?? {}),
      iban: p?.ibanSealed ? this.box?.open(p.ibanSealed) : null,
      fxIban: p?.fxIbanSealed ? this.box?.open(p.fxIbanSealed) : null,
    };
  }

  // ------------------------------------------------------------------ reveal, delete, approvers

  /**
   * The full IBAN (spec 4.4 "Show" and "Copy"), for the employee themselves and Admins
   * only. Every reveal writes the audit entry "IBAN viewed".
   */
  reveal(ctx: TenantContext, id: string, which: 'iban' | 'fxIban') {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const [e] = await tx.select({ id: employees.id, deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, id));
      if (!e || (e.deactivatedAt && !access.canSeeInactive)) throw new NotFoundException('Employee not found');
      if (!access.canSeeBank(id)) throw new ForbiddenException("Only the employee and Admins see a bank account");
      const [p] = await tx.select().from(employeePersonal).where(eq(employeePersonal.employeeId, id));
      const account = which === 'fxIban' && p?.fxSameAsIban !== false ? 'iban' : which;
      const sealed = account === 'iban' ? p?.ibanSealed : p?.fxIbanSealed;
      if (!sealed) throw new NotFoundException('No bank account stored');
      const iban = this.box?.open(sealed);
      if (!iban) throw new ConflictException("The stored bank account can't be read: the server's APP_SECRET changed. Enter it again.");
      await this.audit.record(tx, ctx, { action: 'employee.iban_viewed', entityType: 'employee', entityId: id, data: { account: which } });
      const parsed = parseBankAccount(iban);
      return { account: which, iban, formatted: formatIban(iban), domestic: domesticFromIban(iban), foreign: parsed?.foreign ?? iban.slice(0, 2) !== 'RS' };
    });
  }

  /**
   * Admin only (spec 4.8 as changed by CD-225): an employee who was deactivated first (status
   * Inactive), former app users included (their membership went at deactivation). Active and
   * leaving employees get 409 "Deactivate first". Heads, leads, reports and the CEO setting
   * lose the reference (ON DELETE SET NULL); history keeps a "deleted" row and the audit log the
   * name, so CRM history shows "Deleted employee".
   */
  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isAdmin) throw new ForbiddenException('Only Admins delete employees');
        const [e] = await tx.select({ fullName: employees.fullName, deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, id)).for('update');
        if (!e) throw new NotFoundException('Employee not found');
        if (!e.deactivatedAt) throw new ConflictException(`${e.fullName} is still active. Deactivate first, then delete.`);
        // Workforce modules (14–21) add their checks here as they ship ("has 3 timesheets").
        await tx.delete(employees).where(eq(employees.id, id));
        await this.audit.record(tx, ctx, { action: 'employee.deleted', entityType: 'employee', entityId: id, data: { name: e.fullName } });
      })
      .catch(mapDbError);
  }

  /** "Approvals go to" for `date` (default today): the rule of spec 7.4, with names. Any member. */
  approvers(ctx: TenantContext, id: string, date: string | undefined) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const [e] = await tx.select({ deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, id));
      if (!e || (e.deactivatedAt && !access.canSeeInactive)) throw new NotFoundException('Employee not found');
      const result = await this.access.approversFor(ctx.tenantId, id, date ?? new Date().toISOString().slice(0, 10), tx);
      return this.presentApprovers(tx, result!);
    });
  }

  private async settings(tx: Tx, tenantId: string): Promise<PeopleSettings> {
    const [t] = await tx
      .select({
        defaultWeeklyHours: tenants.employeeDefaultWeeklyHours,
        numberRequired: tenants.employeeNumberRequired,
        selfEditBank: tenants.employeeSelfEditBank,
        workspaceName: tenants.name,
        ceoEmployeeId: tenants.ceoEmployeeId,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    let topEmployeeId = t?.ceoEmployeeId ?? null;
    if (!topEmployeeId) {
      const tops = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(isNull(employees.managerId), isNull(employees.deactivatedAt), shownEmployee))
        .limit(2);
      topEmployeeId = tops.length === 1 ? tops[0]!.id : null;
    }
    return { ...(t ?? { defaultWeeklyHours: 40, numberRequired: false, selfEditBank: true, workspaceName: '', ceoEmployeeId: null }), topEmployeeId };
  }
}

/** The fields a create or update sends. */
function sentFields(input: Record<string, unknown>): EmployeeField[] {
  return Object.keys(input).filter((k) => input[k] !== undefined) as EmployeeField[];
}

/** Patch values in the form the conflict check compares (IBANs as plain numbers). */
function comparable(input: UpdateEmployee): Record<string, unknown> {
  return { ...input, iban: input.iban === undefined ? undefined : (input.iban?.iban ?? null), fxIban: input.fxIban === undefined ? undefined : (input.fxIban?.iban ?? null) };
}

/** The query's text folded in SQL (people_fold) and escaped for LIKE. */
function likeBody(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Why a patch was refused, for the 403 message. */
function refusal(access: CallerAccess, id: string, refused: string[], selfEditBank: boolean): string {
  if (!access.isHr && !access.isSelf(id)) return 'Only Admins edit other employees';
  if (access.isSelf(id)) {
    const bank = refused.filter((f) => (BANK_FIELDS as readonly string[]).includes(f));
    if (bank.length === refused.length && !selfEditBank) return 'In this workspace, only Admins change bank accounts';
    const org = refused.filter((f) => (ORG_FIELDS as readonly string[]).includes(f) || (EMPLOYMENT_FIELDS as readonly string[]).includes(f));
    if (org.length) return `Only an Admin can change ${listFields(org)} on their own card`;
    return `On your own card you can change your work phone, personal details and bank account, not ${listFields(refused)}`;
  }
  return `You can't change ${listFields(refused)}`;
}

/** Directory fields (spec 5.4): what every member sees about every active employee. */
function directory(r: EmployeeRow, status: EmployeeStatus) {
  return {
    id: r.id,
    userId: r.userId,
    firstName: r.firstName,
    lastName: r.lastName,
    fullName: r.fullName,
    jobTitle: r.jobTitle,
    unitId: r.unitId,
    unitName: r.unitName,
    managerId: r.managerId,
    managerName: r.managerName,
    workEmail: r.workEmail,
    workPhone: r.workPhone,
    workLocation: r.workLocation,
    status,
  };
}

/** Employment fields (spec 4.2): self, managers above, Admins. The reason for leaving only for Admins. */
function employment(r: EmployeeRow, access: CallerAccess) {
  return {
    employeeNumber: r.employeeNumber,
    startDate: r.employmentStartDate,
    endDate: r.employmentEndDate,
    type: r.employmentType,
    weeklyHours: Number(r.weeklyHours),
    timesheetRequired: r.timesheetRequired,
    attendanceTracked: r.attendanceTracked,
    deactivatedAt: r.deactivatedAt,
    ...(access.canSeeLeavingReason ? { leavingReason: r.leavingReason } : {}),
  };
}

function personal(p: typeof employeePersonal.$inferSelect | undefined) {
  return {
    dateOfBirth: p?.dateOfBirth ?? null,
    privateEmail: p?.privateEmail ?? null,
    privatePhone: p?.privatePhone ?? null,
    addressStreet: p?.addressStreet ?? null,
    addressPostalCode: p?.addressPostalCode ?? null,
    addressCity: p?.addressCity ?? null,
    addressCountry: p?.addressCountry ?? 'Serbia',
    emergencyContactName: p?.emergencyContactName ?? null,
    emergencyContactPhone: p?.emergencyContactPhone ?? null,
  };
}

/**
 * Data issues (spec 5.2, 7.5, 10.3), for the Admins filter and warnings. "No
 * manager" leaves out the top of the organisation: the CEO, else the only active employee without
 * a manager.
 */
function dataIssues(r: EmployeeRow, settings: PeopleSettings): DataIssue[] {
  if (r.deactivatedAt) return [];
  const issues: DataIssue[] = [];
  if (!r.managerId && r.id !== settings.topEmployeeId) issues.push('no_manager');
  if (!r.employmentStartDate) issues.push('no_start_date');
  if (!r.unitId) issues.push('no_unit');
  if (r.managerId && !r.managerUserId) issues.push('manager_no_account');
  if (settings.numberRequired && !r.employeeNumber) issues.push('no_employee_number');
  return issues;
}
