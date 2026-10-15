import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employeeTimeoffProfiles, employees, invitations, tenants, timeoffPolicies, timeoffPolicyExperienceRules, type VacationEntitlementRow, vacationEntitlements } from '../../shared/database/schema';
import { zonedParts } from '../../shared/time/zoned-time';
import { PeopleAccess } from '../people';
import { computeEntitlement, type Entitlement, experienceLabel, type PolicyRules } from './entitlement';
import { readHistory } from './timeoff-history';
import type { HistoryQuery, UpdateEntitlement, UpdateProfile } from './timeoff.schemas';

/** From this day on (workspace time) next year's entitlements exist, so people can plan ahead (spec 5.4). */
export const NEXT_YEAR_FROM = '10-01';

export interface EntitlementView {
  id: string;
  year: number;
  policy: { id: string; name: string };
  baseDays: number;
  experienceYears: number;
  experienceDays: number;
  individualDays: number;
  individualReason: string | null;
  monthsWorked: number | null;
  annualDays: number;
  totalDays: number;
  frozen: boolean;
  /** The employee's policy changed since: Recalculate applies it to this year (spec 5.4). */
  policyOutdated: boolean;
  updatedAt: Date;
}

/** The employee card's Time off section (spec 5.3, 5.4). */
export interface ProfileView {
  employeeId: string;
  fullName: string;
  policy: { id: string; name: string };
  /** False while the employee is on the default policy without a row of their own. */
  hasProfile: boolean;
  priorExperienceMonths: number;
  priorExperienceLabel: string;
  startDate: string | null;
  endDate: string | null;
  /** This year, next year once it exists, and last year while it has a row; by year. */
  entitlements: EntitlementView[];
  /** The year the workspace is in. */
  currentYear: number;
  canEdit: boolean;
}

interface PolicyWithRules extends PolicyRules {
  id: string;
  name: string;
}

interface EmployeeFacts {
  id: string;
  fullName: string;
  startDate: string | null;
  endDate: string | null;
  deactivatedAt: Date | null;
  policy: PolicyWithRules;
  hasProfile: boolean;
  priorExperienceMonths: number;
}

/**
 * The employee's time off profile and yearly entitlements (CD-163, spec 5.3, 5.4). Entitlement rows
 * are made and kept up to date when someone looks (`profile`) and by the daily job
 * (`ensureWorkspace`): this year always, next year from 1 October. A row is recomputed while it
 * isn't frozen; the policy it was computed with stays until an Admin presses Recalculate or the
 * year is a later one than the current (a policy change takes effect from next year). Only the
 * rows whose values differ are written, so looking at a card changes nothing in the history.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: PeopleAccess,
  ) {}

  // ------------------------------------------------------------------ reads

  /** The card's Time off section: self, the managers above and Admins (spec 15.1). */
  profile(ctx: TenantContext, employeeId: string): Promise<ProfileView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const facts = await this.facts(tx, employeeId);
      if (!facts || (facts.deactivatedAt && !access.canSeeInactive)) throw new NotFoundException('Employee not found');
      if (!access.canSeeEmployment(employeeId)) throw new ForbiddenException('Only the employee, their managers and Admins see their time off');
      const today = await this.today(tx, ctx.tenantId);
      await this.ensureYears(tx, ctx.tenantId, facts, this.dueYears(today), {});
      return this.present(tx, facts, today, access.isAdmin);
    });
  }

  private async present(tx: Tx, facts: EmployeeFacts, today: string, canEdit: boolean): Promise<ProfileView> {
    const currentYear = Number(today.slice(0, 4));
    const rows = await tx
      .select()
      .from(vacationEntitlements)
      .where(and(eq(vacationEntitlements.employeeId, facts.id), gte(vacationEntitlements.year, currentYear - 1)))
      .orderBy(asc(vacationEntitlements.year));
    const policyIds = [...new Set(rows.map((r) => r.policyId))];
    const names = new Map<string, string>();
    if (policyIds.length) for (const p of await tx.select({ id: timeoffPolicies.id, name: timeoffPolicies.name }).from(timeoffPolicies).where(inArray(timeoffPolicies.id, policyIds))) names.set(p.id, p.name);
    return {
      employeeId: facts.id,
      fullName: facts.fullName,
      policy: { id: facts.policy.id, name: facts.policy.name },
      hasProfile: facts.hasProfile,
      priorExperienceMonths: facts.priorExperienceMonths,
      priorExperienceLabel: experienceLabel(facts.priorExperienceMonths),
      startDate: facts.startDate,
      endDate: facts.endDate,
      entitlements: rows.map((r) => this.view(r, names.get(r.policyId) ?? 'Deleted policy', facts.policy.id)),
      currentYear,
      canEdit,
    };
  }

  private view(r: VacationEntitlementRow, policyName: string, profilePolicyId: string): EntitlementView {
    return {
      id: r.id,
      year: r.year,
      policy: { id: r.policyId, name: policyName },
      baseDays: r.baseDays,
      experienceYears: r.experienceYears,
      experienceDays: r.experienceDays,
      individualDays: r.individualDays,
      individualReason: r.individualReason,
      monthsWorked: r.monthsWorked,
      annualDays: r.annualDays,
      totalDays: r.totalDays,
      frozen: r.frozen,
      policyOutdated: r.policyId !== profilePolicyId,
      updatedAt: r.updatedAt,
    };
  }

  // ------------------------------------------------------------------ changes (Admins)

  /** The policy (from next year; Recalculate applies it to this year) and the prior work experience. */
  updateProfile(ctx: TenantContext, employeeId: string, input: UpdateProfile): Promise<ProfileView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.requireAdmin(ctx, tx);
        const before = await this.facts(tx, employeeId);
        if (!before) throw new NotFoundException('Employee not found');
        if (input.policyId) {
          const [policy] = await tx.select({ id: timeoffPolicies.id }).from(timeoffPolicies).where(eq(timeoffPolicies.id, input.policyId));
          if (!policy) throw new NotFoundException('Policy not found');
        }
        const values = {
          policyId: input.policyId ?? before.policy.id,
          priorExperienceMonths: input.priorExperienceMonths ?? before.priorExperienceMonths,
        };
        await tx
          .insert(employeeTimeoffProfiles)
          .values({ tenantId: ctx.tenantId, employeeId, ...values })
          .onConflictDoUpdate({ target: [employeeTimeoffProfiles.tenantId, employeeTimeoffProfiles.employeeId], set: values });
        const facts = (await this.facts(tx, employeeId))!;
        const today = await this.today(tx, ctx.tenantId);
        // Prior experience changes this year's days at once (where not frozen); a new policy only later years'.
        await this.ensureYears(tx, ctx.tenantId, facts, this.dueYears(today), {});
        await this.audit.record(tx, ctx, { action: 'timeoff.profile_updated', entityType: 'employee', entityId: employeeId, data: { ...input } });
        return this.present(tx, facts, today, access.isAdmin);
      })
      .catch(mapDbError);
  }

  /** Individual extra days for one year, with their reason (spec 5.4); the year is recomputed with them. */
  updateEntitlement(ctx: TenantContext, employeeId: string, year: number, input: UpdateEntitlement): Promise<ProfileView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.requireAdmin(ctx, tx);
        const facts = await this.facts(tx, employeeId);
        if (!facts) throw new NotFoundException('Employee not found');
        if (!facts.startDate) throw new NotFoundException('The employee has no employment start date, so no entitlement');
        const today = await this.today(tx, ctx.tenantId);
        const row = await this.ensureYear(tx, ctx.tenantId, facts, year, { individual: { days: input.individualDays, reason: input.individualDays ? (input.individualReason ?? null) : null }, force: true });
        await this.audit.record(tx, ctx, { action: 'timeoff.entitlement_updated', entityType: 'vacation_entitlement', entityId: row!.id, data: { employeeId, year, ...input } });
        return this.present(tx, facts, today, access.isAdmin);
      })
      .catch(mapDbError);
  }

  /**
   * Recalculate (spec 5.4): with `preview`, the current row and what it would become (the
   * employee's current policy, the current start date and prior experience); without, saves it.
   */
  recalculate(ctx: TenantContext, employeeId: string, year: number, preview: boolean): Promise<{ before: EntitlementView | null; after: Entitlement | null; profile: ProfileView | null }> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.requireAdmin(ctx, tx);
        const facts = await this.facts(tx, employeeId);
        if (!facts) throw new NotFoundException('Employee not found');
        const today = await this.today(tx, ctx.tenantId);
        const [row] = await tx.select().from(vacationEntitlements).where(and(eq(vacationEntitlements.employeeId, employeeId), eq(vacationEntitlements.year, year)));
        const before = row ? this.view(row, (await this.policyName(tx, row.policyId)) ?? 'Deleted policy', facts.policy.id) : null;
        const after = computeEntitlement({ year, policy: facts.policy, startDate: facts.startDate, endDate: facts.endDate, priorExperienceMonths: facts.priorExperienceMonths, individualDays: row?.individualDays ?? 0 });
        if (preview) return { before, after, profile: null };
        await this.ensureYear(tx, ctx.tenantId, facts, year, { force: true, switchPolicy: true });
        await this.audit.record(tx, ctx, { action: 'timeoff.entitlement_recalculated', entityType: 'employee', entityId: employeeId, data: { year, before: before?.totalDays ?? null, after: after?.totalDays ?? null } });
        return { before, after, profile: await this.present(tx, facts, today, access.isAdmin) };
      })
      .catch(mapDbError);
  }

  /** The profile's and the entitlements' history (triggers of drizzle/0096): self and Admins. */
  history(ctx: TenantContext, employeeId: string, query: HistoryQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const [employee] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId));
      if (!employee) throw new NotFoundException('Employee not found');
      if (!access.canSeeHistory(employeeId)) throw new ForbiddenException("Only the employee and Admins see an employee's time off history");
      const [profile] = await tx.select({ id: employeeTimeoffProfiles.id }).from(employeeTimeoffProfiles).where(eq(employeeTimeoffProfiles.employeeId, employeeId));
      const rows = await tx.select({ id: vacationEntitlements.id }).from(vacationEntitlements).where(eq(vacationEntitlements.employeeId, employeeId));
      return readHistory(
        tx,
        [
          { entityType: 'timeoff_profile', ids: profile ? [profile.id] : [] },
          { entityType: 'vacation_entitlement', ids: rows.map((r) => r.id) },
        ],
        query,
      );
    });
  }

  // ------------------------------------------------------------------ for the policies service and the job

  /** After a policy's days changed: its rows of this year (not frozen) and later years. How many employees' days changed. */
  async recomputePolicy(tx: Tx, tenantId: string, policyId: string): Promise<number> {
    const today = await this.today(tx, tenantId);
    const currentYear = Number(today.slice(0, 4));
    const rows = await tx
      .select({ employeeId: vacationEntitlements.employeeId, year: vacationEntitlements.year })
      .from(vacationEntitlements)
      .where(and(eq(vacationEntitlements.policyId, policyId), gte(vacationEntitlements.year, currentYear)));
    const changed = new Set<string>();
    for (const r of rows) {
      const facts = await this.facts(tx, r.employeeId);
      if (!facts) continue;
      if (await this.ensureYear(tx, tenantId, facts, r.year, { force: r.year > currentYear })) changed.add(r.employeeId);
    }
    return changed.size;
  }

  /** The default changed: employees without a profile row follow it (later years now, this year unless frozen). */
  async recomputeWithoutProfile(tx: Tx, tenantId: string): Promise<void> {
    const today = await this.today(tx, tenantId);
    const currentYear = Number(today.slice(0, 4));
    const rows = await tx
      .select({ employeeId: vacationEntitlements.employeeId, year: vacationEntitlements.year })
      .from(vacationEntitlements)
      .leftJoin(employeeTimeoffProfiles, eq(employeeTimeoffProfiles.employeeId, vacationEntitlements.employeeId))
      .where(and(isNull(employeeTimeoffProfiles.id), gte(vacationEntitlements.year, currentYear)));
    for (const r of rows) {
      const facts = await this.facts(tx, r.employeeId);
      if (facts) await this.ensureYear(tx, tenantId, facts, r.year, { switchPolicy: true, force: r.year > currentYear });
    }
  }

  /**
   * The daily job (spec 5.4): every active employee the app shows gets this year's row and, from
   * 1 October, next year's; rows not frozen are brought up to date. Answers how many rows changed.
   */
  async ensureWorkspace(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const today = await this.today(tx, tenantId, now);
      const years = this.dueYears(today);
      const people = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            isNull(employees.deactivatedAt),
            sql`(${employees.userId} is not null or exists (select 1 from ${invitations} i where i.employee_id = ${employees.id} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()))`,
          ),
        );
      let changed = 0;
      for (const p of people) {
        const facts = await this.facts(tx, p.id);
        if (facts) changed += await this.ensureYears(tx, tenantId, facts, years, {});
      }
      return changed;
    });
  }

  // ------------------------------------------------------------------ the rows

  /** This year, and next year from 1 October (workspace time). */
  dueYears(today: string): number[] {
    const year = Number(today.slice(0, 4));
    return today.slice(5) >= NEXT_YEAR_FROM ? [year, year + 1] : [year];
  }

  private async ensureYears(tx: Tx, tenantId: string, facts: EmployeeFacts, years: number[], opts: EnsureOptions): Promise<number> {
    let changed = 0;
    for (const year of years) if (await this.ensureYear(tx, tenantId, facts, year, opts)) changed++;
    return changed;
  }

  /**
   * One employee's row for one year: made when missing, recomputed when its values differ and it
   * isn't frozen (`force` recomputes a frozen one too). The policy: the row's own, unless it is a
   * later year than the current one, `switchPolicy` or the row is new (then the profile's).
   * Answers the row when it was written, else null.
   */
  private async ensureYear(tx: Tx, tenantId: string, facts: EmployeeFacts, year: number, opts: EnsureOptions): Promise<VacationEntitlementRow | null> {
    if (!facts.startDate) return null;
    const [row] = await tx.select().from(vacationEntitlements).where(and(eq(vacationEntitlements.employeeId, facts.id), eq(vacationEntitlements.year, year)));
    if (row?.frozen && !opts.force) return null;
    const today = await this.today(tx, tenantId);
    const currentYear = Number(today.slice(0, 4));
    const usesProfilePolicy = !row || opts.switchPolicy || year > currentYear;
    const policy = usesProfilePolicy ? facts.policy : ((await this.policyRules(tx, row.policyId)) ?? facts.policy);
    const individual = opts.individual ?? { days: row?.individualDays ?? 0, reason: row?.individualReason ?? null };
    const e = computeEntitlement({ year, policy, startDate: facts.startDate, endDate: facts.endDate, priorExperienceMonths: facts.priorExperienceMonths, individualDays: individual.days });
    if (!e) return null;
    const values = {
      policyId: policy.id,
      baseDays: e.baseDays,
      experienceYears: e.experienceYears,
      experienceDays: e.experienceDays,
      individualDays: e.individualDays,
      individualReason: e.individualDays ? individual.reason : null,
      monthsWorked: e.monthsWorked,
      annualDays: e.annualDays,
      totalDays: e.totalDays,
    };
    if (row && (Object.keys(values) as (keyof typeof values)[]).every((k) => row[k] === values[k])) return null;
    const [written] = row
      ? await tx.update(vacationEntitlements).set(values).where(eq(vacationEntitlements.id, row.id)).returning()
      : await tx
          .insert(vacationEntitlements)
          .values({ tenantId, employeeId: facts.id, year, ...values })
          .returning();
    return written ?? null;
  }

  // ------------------------------------------------------------------ inputs

  /** The employee's dates, profile (or the default policy) and that policy's rules. */
  private async facts(tx: Tx, employeeId: string): Promise<EmployeeFacts | null> {
    const [e] = await tx
      .select({
        id: employees.id,
        fullName: employees.fullName,
        startDate: employees.employmentStartDate,
        endDate: employees.employmentEndDate,
        deactivatedAt: employees.deactivatedAt,
        policyId: employeeTimeoffProfiles.policyId,
        priorExperienceMonths: employeeTimeoffProfiles.priorExperienceMonths,
      })
      .from(employees)
      .leftJoin(employeeTimeoffProfiles, eq(employeeTimeoffProfiles.employeeId, employees.id))
      .where(eq(employees.id, employeeId));
    if (!e) return null;
    const policy = e.policyId ? await this.policyRules(tx, e.policyId) : await this.defaultPolicy(tx);
    if (!policy) throw new NotFoundException('The workspace has no default vacation policy');
    return { id: e.id, fullName: e.fullName, startDate: e.startDate, endDate: e.endDate, deactivatedAt: e.deactivatedAt, policy, hasProfile: !!e.policyId, priorExperienceMonths: e.priorExperienceMonths ?? 0 };
  }

  private async policyRules(tx: Tx, id: string): Promise<PolicyWithRules | null> {
    const [p] = await tx.select().from(timeoffPolicies).where(eq(timeoffPolicies.id, id));
    if (!p) return null;
    const rules = await tx
      .select({ fromYears: timeoffPolicyExperienceRules.fromYears, extraDays: timeoffPolicyExperienceRules.extraDays })
      .from(timeoffPolicyExperienceRules)
      .where(eq(timeoffPolicyExperienceRules.policyId, id))
      .orderBy(asc(timeoffPolicyExperienceRules.fromYears));
    return { id: p.id, name: p.name, baseDays: p.baseDays, maxDays: p.maxDays, carryOver: p.carryOver, carryOverCap: p.carryOverCap, experienceRules: rules };
  }

  private async defaultPolicy(tx: Tx): Promise<PolicyWithRules | null> {
    const [p] = await tx.select({ id: timeoffPolicies.id }).from(timeoffPolicies).where(eq(timeoffPolicies.isDefault, true));
    return p ? this.policyRules(tx, p.id) : null;
  }

  private async policyName(tx: Tx, id: string): Promise<string | null> {
    const [p] = await tx.select({ name: timeoffPolicies.name }).from(timeoffPolicies).where(eq(timeoffPolicies.id, id));
    return p?.name ?? null;
  }

  /** Today's date on the workspace's clock. */
  private async today(tx: Tx, tenantId: string, now = new Date()): Promise<string> {
    const [t] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    return zonedParts(now, t?.timezone ?? 'UTC').date;
  }

  private async requireAdmin(ctx: TenantContext, tx: Tx) {
    const access = await this.access.of(ctx, tx);
    if (!access.isAdmin) throw new ForbiddenException('Only Admins change time off profiles and entitlements');
    return access;
  }
}

interface EnsureOptions {
  /** Recompute a frozen row too (an Admin's Recalculate or individual days). */
  force?: boolean;
  /** Compute with the profile's policy instead of the row's (Recalculate, a new default). */
  switchPolicy?: boolean;
  /** Individual extra days to store with the row. */
  individual?: { days: number; reason: string | null };
}
