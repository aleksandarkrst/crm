import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { requestActor } from '../../shared/database/request-context';
import {
  type AdjustmentKind,
  employees,
  employeeTimeoffProfiles,
  invitations,
  orgUnits,
  timeoffNotices,
  timeoffPolicies,
  users,
  vacationBalanceAdjustments,
  vacationBalanceExpiries,
  vacationEntitlements,
} from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { type CallerAccess, PeopleAccess } from '../people';
import { type Balance, carriedOverInto, computeBalance, type PoolFacts, type VacationDay } from './balance';
import { ADJUSTMENT_LABEL } from './balance-emails';
import { csvCell, type CsvValue } from './csv';
import { entitlementParts } from './entitlement';
import { EntitlementsService } from './entitlements.service';
import { workspaceToday } from './today';
import type { BalancesQuery, BulkChangePolicy, BulkRecalculate, CreateAdjustment } from './timeoff.schemas';

/** One line of the balance history (spec 6.5), in date order with a running total. */
export interface BalanceHistoryEntry {
  date: string;
  kind: 'entitlement' | 'carry_over' | 'adjustment' | 'expired';
  label: string;
  days: number;
  runningTotal: number;
  /** Adjustments: who, why and of which kind. */
  actor?: { userId: string | null; name: string } | null;
  reason?: string;
  adjustmentKind?: AdjustmentKind;
}

/** GET /api/timeoff/employees/:id/balance (spec 6.3, 6.5). */
export interface BalanceView {
  employeeId: string;
  fullName: string;
  year: number;
  currentYear: number;
  /** Years with an entitlement row, for the year switcher. */
  years: number[];
  policy: { id: string; name: string; carryOver: boolean; carryOverCap: number | null };
  hasStartDate: boolean;
  figures: Balance;
  history: BalanceHistoryEntry[];
  /** The 1 July record, when the job made one. */
  expiryRecordedAt: Date | null;
  canAdjust: boolean;
}

/** One row of the Balances table (spec 6.5). */
export interface BalanceRow {
  employee: { id: string; fullName: string; jobTitle: string | null; hasStartDate: boolean };
  unit: { id: string; name: string } | null;
  managerId: string | null;
  policy: { id: string; name: string };
  figures: Balance;
}

export interface BalancesTable {
  year: number;
  currentYear: number;
  rows: BalanceRow[];
  /** Admins: Adjust balance, Change policy, Recalculate, CSV. */
  canAdjust: boolean;
}

interface EmployeeRow {
  id: string;
  fullName: string;
  jobTitle: string | null;
  unitId: string | null;
  unitName: string | null;
  managerId: string | null;
  userId: string | null;
  startDate: string | null;
  deactivatedAt: Date | null;
  policyId: string | null;
}

interface PolicyRule {
  id: string;
  name: string;
  carryOver: boolean;
  carryOverCap: number | null;
}

interface EntitlementFacts {
  totalDays: number;
  baseDays: number;
  experienceDays: number;
  experienceYears: number;
  individualDays: number;
  monthsWorked: number | null;
  annualDays: number;
}

/** Everything the balances of a set of employees are computed from, read in a few queries. */
interface Facts {
  today: string;
  currentYear: number;
  policies: Map<string, PolicyRule>;
  defaultPolicy: PolicyRule;
  employees: EmployeeRow[];
  /** `${employeeId}:${year}` → the row. */
  entitlements: Map<string, EntitlementFacts>;
  /** `${employeeId}:${poolYear}` → the sum. */
  adjustments: Map<string, number>;
  /** By employee: their vacation days (empty until CD-165). */
  days: Map<string, VacationDay[]>;
}

/** The first day of the carry-over reminder windows (1 May, 1 June; up to a week late after downtime). */
const REMINDER_WINDOWS: { from: string; to: string; period: string }[] = [
  { from: '05-01', to: '05-07', period: '05' },
  { from: '06-01', to: '06-07', period: '06' },
];

/** The people the app shows (members and pending invitations), as the Org structure lists them. */
const shownAndActive = and(isNull(employees.deactivatedAt), sql`(${employees.userId} is not null or exists (select 1 from ${invitations} i where i.employee_id = ${employees.id} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()))`);

/**
 * The vacation balance (CD-164, spec 6): the figures of one employee for a year with the balance
 * history, the Balances table and its CSV, manual adjustments (append-only, with an email), the
 * bulk policy change and recalculation, and the daily job's July 1 expiry records and May and June
 * reminders. Figures are computed from the entitlement rows, the adjustments and the vacation days
 * (`balance.ts`, pure); the days come with the requests of CD-165, so they are empty for now.
 */
@Injectable()
export class BalancesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly access: PeopleAccess,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ------------------------------------------------------------------ reads

  /** One employee's balance for `year` (this year by default): self, the managers above and Admins. */
  async balance(ctx: TenantContext, employeeId: string, year?: number): Promise<BalanceView> {
    const { access, today } = await this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const [e] = await tx.select({ id: employees.id, deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, employeeId));
      if (!e || (e.deactivatedAt && !access.canSeeInactive)) throw new NotFoundException('Employee not found');
      if (!access.canSeeEmployment(employeeId)) throw new ForbiddenException('Only the employee, their managers and Admins see their balance');
      return { access, today: await workspaceToday(tx, ctx.tenantId) };
    });
    const y = year ?? Number(today.slice(0, 4));
    await this.ensureRows(ctx.tenantId, [employeeId], [y - 1, y]);
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const facts = await this.facts(tx, ctx.tenantId, [employeeId], y);
      const row = facts.employees[0];
      if (!row) throw new NotFoundException('Employee not found');
      return this.view(tx, facts, row, y, access.isAdmin);
    });
  }

  /** The Balances table (spec 6.5): Admins see everyone, managers their reports; others 403. */
  async table(ctx: TenantContext, query: BalancesQuery): Promise<BalancesTable> {
    const { access, ids, today } = await this.scope(ctx);
    const year = query.year ?? Number(today.slice(0, 4));
    await this.ensureRows(ctx.tenantId, ids, [year - 1, year]);
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const facts = await this.facts(tx, ctx.tenantId, ids, year);
      const rows = facts.employees
        .filter((e) => (!query.unitId || e.unitId === query.unitId) && (!query.managerId || e.managerId === query.managerId) && (!query.policyId || this.policyOf(facts, e).id === query.policyId))
        .map((e) => this.row(facts, e, year))
        .filter((r) => !query.expiring || r.figures.carryRemaining > 0);
      return { year, currentYear: facts.currentYear, rows, canAdjust: access.isAdmin };
    });
  }

  /** The table as CSV (UTF-8 with a BOM, CRLF, like the other exports). */
  async csv(ctx: TenantContext, query: BalancesQuery): Promise<string> {
    const t = await this.table(ctx, query);
    const header = ['Employee', 'Job title', 'Unit', 'Policy', 'Entitlement', 'Carried over', 'Adjustments', 'Total', 'Used', 'Scheduled', 'Pending', 'Expired', 'Remaining', 'Available', 'Expiring 30 June', 'Two-week part'];
    const lines: CsvValue[][] = [header];
    for (const r of t.rows) {
      const f = r.figures;
      lines.push([r.employee.fullName, r.employee.jobTitle, r.unit?.name ?? null, r.policy.name, f.entitlement, f.carriedOver, f.adjustments, f.total, f.used, f.scheduled, f.pending, f.expired, f.remaining, f.available, f.carryRemaining, f.twoWeekPart ? 'taken' : 'not yet']);
    }
    return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------ changes (Admins)

  /** An adjustment (spec 6.4): append-only, a reason always; the employee gets an email unless they made it. */
  adjust(ctx: TenantContext, employeeId: string, input: CreateAdjustment): Promise<BalanceView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isAdmin) throw new ForbiddenException('Only Admins adjust balances');
        const today = await workspaceToday(tx, ctx.tenantId);
        const currentYear = Number(today.slice(0, 4));
        if (input.poolYear < currentYear - 1 || input.poolYear > currentYear + 1) throw new BadRequestException(`The pool year is ${currentYear - 1} to ${currentYear + 1}`);
        const facts = await this.facts(tx, ctx.tenantId, [employeeId], input.poolYear);
        const e = facts.employees[0];
        if (!e) throw new NotFoundException('Employee not found');
        // A pool can't go below zero while approved days depend on it (spec 6.4).
        const pool = this.pool(facts, e.id, input.poolYear);
        const approved = (facts.days.get(e.id) ?? []).filter((d) => d.poolYear === input.poolYear && d.status === 'approved').length;
        const after = pool.entitlement + pool.adjustments + input.days;
        if (after < approved) {
          throw new ConflictException(
            approved ? `This would leave the ${input.poolYear} pool at ${after - approved} ${Math.abs(after - approved) === 1 ? 'day' : 'days'}: ${approved} approved ${approved === 1 ? 'day uses' : 'days use'} it.` : `This would leave the ${input.poolYear} pool at ${after} days.`,
          );
        }
        const [row] = await tx
          .insert(vacationBalanceAdjustments)
          .values({ tenantId: ctx.tenantId, employeeId, poolYear: input.poolYear, days: input.days, kind: input.kind, reason: input.reason, createdByUserId: ctx.userId })
          .returning({ id: vacationBalanceAdjustments.id });
        await this.audit.record(tx, ctx, { action: 'timeoff.balance_adjusted', entityType: 'employee', entityId: employeeId, data: { adjustmentId: row!.id, ...input } });
        const year = Number(today.slice(0, 4));
        const updated = await this.facts(tx, ctx.tenantId, [employeeId], year);
        const figures = this.row(updated, updated.employees[0]!, input.poolYear === year + 1 ? year + 1 : year).figures;
        if (e.userId !== ctx.userId) {
          await this.jobs.send('timeoff.notice-email', { tenantId: ctx.tenantId, kind: 'balance_adjusted', employeeId, actorUserId: ctx.userId, adjustment: { ...input }, remaining: figures.remaining, available: figures.available }, tx);
        }
        return this.view(tx, updated, updated.employees[0]!, figures.year, true);
      })
      .catch(mapDbError);
  }

  /** "Change policy" for several employees at once (spec 5.5): from next year, as on the card. */
  bulkChangePolicy(ctx: TenantContext, input: BulkChangePolicy): Promise<{ changed: number }> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        if (!access.isAdmin) throw new ForbiddenException('Only Admins change policies');
        const [policy] = await tx.select({ id: timeoffPolicies.id, name: timeoffPolicies.name }).from(timeoffPolicies).where(eq(timeoffPolicies.id, input.policyId));
        if (!policy) throw new NotFoundException('Policy not found');
        const rows = await tx.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, input.employeeIds), shownAndActive));
        let changed = 0;
        for (const r of rows) {
          await tx
            .insert(employeeTimeoffProfiles)
            .values({ tenantId: ctx.tenantId, employeeId: r.id, policyId: input.policyId })
            .onConflictDoUpdate({ target: [employeeTimeoffProfiles.tenantId, employeeTimeoffProfiles.employeeId], set: { policyId: input.policyId } });
          changed++;
        }
        const today = await workspaceToday(tx, ctx.tenantId);
        await this.entitlements.ensureEmployees(
          tx,
          ctx.tenantId,
          rows.map((r) => r.id),
          this.entitlements.dueYears(today),
        );
        await this.audit.record(tx, ctx, { action: 'timeoff.policy_assigned', entityType: 'timeoff_policy', entityId: policy.id, data: { employeeIds: rows.map((r) => r.id), name: policy.name } });
        return { changed };
      })
      .catch(mapDbError);
  }

  /** Recalculate the year for several employees (spec 6.5), as the card's Recalculate. */
  bulkRecalculate(ctx: TenantContext, input: BulkRecalculate): Promise<{ changed: number }> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      if (!access.isAdmin) throw new ForbiddenException('Only Admins recalculate');
      const rows = await tx.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, input.employeeIds), shownAndActive));
      let changed = 0;
      for (const r of rows) {
        const res = await this.entitlements.recalculateIn(tx, ctx.tenantId, r.id, input.year);
        if (res) changed++;
      }
      await this.audit.record(tx, ctx, { action: 'timeoff.entitlement_recalculated', entityType: 'employee', data: { employeeIds: rows.map((r) => r.id), year: input.year, changed } });
      return { changed };
    });
  }

  // ------------------------------------------------------------------ the daily job

  /**
   * From 1 July (spec 6.2): records, once per employee and pool, the carry-over not used by 30
   * June (the balance history's "Expired" entry). Answers how many rows it wrote.
   */
  async recordExpiries(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const today = await workspaceToday(tx, tenantId, now);
      const year = Number(today.slice(0, 4));
      if (today <= `${year}-06-30`) return 0;
      const ids = (await tx.select({ id: employees.id }).from(employees).where(shownAndActive)).map((r) => r.id);
      if (!ids.length) return 0;
      const facts = await this.facts(tx, tenantId, ids, year, now);
      const recorded = new Set((await tx.select({ employeeId: vacationBalanceExpiries.employeeId }).from(vacationBalanceExpiries).where(and(inArray(vacationBalanceExpiries.employeeId, ids), eq(vacationBalanceExpiries.poolYear, year - 1)))).map((r) => r.employeeId));
      const rows = facts.employees
        .filter((e) => !recorded.has(e.id))
        .map((e) => ({ e, figures: this.row(facts, e, year).figures }))
        .filter(({ figures }) => figures.carriedOver > 0 && figures.expired > 0)
        .map(({ e, figures }) => ({ tenantId, employeeId: e.id, poolYear: year - 1, days: figures.expired }));
      if (rows.length) await tx.insert(vacationBalanceExpiries).values(rows).onConflictDoNothing();
      return rows.length;
    });
  }

  /** On 1 May and 1 June (spec 15.2): "Carry-over expiring" to everyone with unused carry-over, once per period. */
  async queueExpiringReminders(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const today = await workspaceToday(tx, tenantId, now);
      const year = Number(today.slice(0, 4));
      const window = REMINDER_WINDOWS.find((w) => today.slice(5) >= w.from && today.slice(5) <= w.to);
      if (!window) return 0;
      const period = `${year}-${window.period}`;
      const ids = (await tx.select({ id: employees.id }).from(employees).where(shownAndActive)).map((r) => r.id);
      if (!ids.length) return 0;
      const facts = await this.facts(tx, tenantId, ids, year, now);
      let queued = 0;
      for (const e of facts.employees) {
        const figures = this.row(facts, e, year).figures;
        if (figures.carryRemaining <= 0) continue;
        const claimed = await tx
          .insert(timeoffNotices)
          .values({ tenantId, kind: 'carry_over_expiring', employeeId: e.id, period })
          .onConflictDoNothing()
          .returning({ employeeId: timeoffNotices.employeeId });
        if (!claimed.length) continue;
        await this.jobs.send('timeoff.notice-email', { tenantId, kind: 'carry_over_expiring', employeeId: e.id, year, expiring: figures.carryRemaining }, tx);
        queued++;
      }
      return queued;
    });
  }

  // ------------------------------------------------------------------ building blocks

  /** Who the caller may see in the table: Admins everyone, managers their reports; others 403. */
  private async scope(ctx: TenantContext): Promise<{ access: CallerAccess; ids: string[]; today: string }> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      if (!access.isAdmin && !access.isManager) throw new ForbiddenException('Only managers and Admins see the balances of others');
      const rows = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(access.isAdmin ? shownAndActive : and(shownAndActive, inArray(employees.id, [...access.reportIds])));
      return { access, ids: rows.map((r) => r.id), today: await workspaceToday(tx, ctx.tenantId) };
    });
  }

  /** Entitlement rows the reads need, made under the system actor so a reader never authors them. */
  private ensureRows(tenantId: string, employeeIds: string[], years: number[]): Promise<number> {
    if (!employeeIds.length) return Promise.resolve(0);
    return requestActor.run({}, () => this.database.withTenant(tenantId, (tx) => this.entitlements.ensureEmployees(tx, tenantId, employeeIds, years)));
  }

  /** The facts of `employeeIds` around `year` (pools year-1 and year), in a handful of queries. */
  private async facts(tx: Tx, tenantId: string, employeeIds: string[], year: number, now = new Date()): Promise<Facts> {
    const today = await workspaceToday(tx, tenantId, now);
    const currentYear = Number(today.slice(0, 4));
    const policyRows = await tx.select({ id: timeoffPolicies.id, name: timeoffPolicies.name, carryOver: timeoffPolicies.carryOver, carryOverCap: timeoffPolicies.carryOverCap, isDefault: timeoffPolicies.isDefault }).from(timeoffPolicies);
    const policies = new Map(policyRows.map((p) => [p.id, p]));
    const defaultPolicy = policyRows.find((p) => p.isDefault);
    if (!defaultPolicy) throw new NotFoundException('The workspace has no default vacation policy');
    const rows: EmployeeRow[] = employeeIds.length
      ? await tx
          .select({
            id: employees.id,
            fullName: employees.fullName,
            jobTitle: employees.jobTitle,
            unitId: employees.unitId,
            unitName: orgUnits.name,
            managerId: employees.managerId,
            userId: employees.userId,
            startDate: employees.employmentStartDate,
            deactivatedAt: employees.deactivatedAt,
            policyId: employeeTimeoffProfiles.policyId,
          })
          .from(employees)
          .leftJoin(orgUnits, eq(orgUnits.id, employees.unitId))
          .leftJoin(employeeTimeoffProfiles, eq(employeeTimeoffProfiles.employeeId, employees.id))
          .where(inArray(employees.id, employeeIds))
          .orderBy(asc(employees.lastName), asc(employees.firstName))
      : [];
    const years = [year - 1, year];
    const entitlements = new Map<string, EntitlementFacts>();
    const adjustments = new Map<string, number>();
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      for (const e of await tx.select().from(vacationEntitlements).where(and(inArray(vacationEntitlements.employeeId, ids), inArray(vacationEntitlements.year, years)))) {
        entitlements.set(`${e.employeeId}:${e.year}`, { totalDays: e.totalDays, baseDays: e.baseDays, experienceDays: e.experienceDays, experienceYears: e.experienceYears, individualDays: e.individualDays, monthsWorked: e.monthsWorked, annualDays: e.annualDays });
      }
      const sums = await tx
        .select({ employeeId: vacationBalanceAdjustments.employeeId, poolYear: vacationBalanceAdjustments.poolYear, days: sql<number>`sum(${vacationBalanceAdjustments.days})::int` })
        .from(vacationBalanceAdjustments)
        .where(and(inArray(vacationBalanceAdjustments.employeeId, ids), inArray(vacationBalanceAdjustments.poolYear, years)))
        .groupBy(vacationBalanceAdjustments.employeeId, vacationBalanceAdjustments.poolYear);
      for (const s of sums) adjustments.set(`${s.employeeId}:${s.poolYear}`, s.days);
    }
    return { today, currentYear, policies, defaultPolicy, employees: rows, entitlements, adjustments, days: await this.vacationDays(tx, rows.map((r) => r.id), years) };
  }

  /**
   * The employees' vacation days charged to the pools of `years` (CD-165's `timeoff_request_days`:
   * approved and pending days with their pool). Until requests exist there are none.
   */
  private async vacationDays(_tx: Tx, employeeIds: string[], _years: number[]): Promise<Map<string, VacationDay[]>> {
    return new Map(employeeIds.map((id) => [id, []]));
  }

  private policyOf(facts: Facts, e: EmployeeRow): PolicyRule {
    return (e.policyId && facts.policies.get(e.policyId)) || facts.defaultPolicy;
  }

  private pool(facts: Facts, employeeId: string, year: number): PoolFacts {
    return { entitlement: facts.entitlements.get(`${employeeId}:${year}`)?.totalDays ?? 0, adjustments: facts.adjustments.get(`${employeeId}:${year}`) ?? 0 };
  }

  private row(facts: Facts, e: EmployeeRow, year: number): BalanceRow {
    const policy = this.policyOf(facts, e);
    const figures = computeBalance({ year, today: facts.today, policy, pools: (y) => this.pool(facts, e.id, y), days: facts.days.get(e.id) ?? [] });
    return { employee: { id: e.id, fullName: e.fullName, jobTitle: e.jobTitle, hasStartDate: !!e.startDate }, unit: e.unitId && e.unitName ? { id: e.unitId, name: e.unitName } : null, managerId: e.managerId, policy: { id: policy.id, name: policy.name }, figures };
  }

  private async view(tx: Tx, facts: Facts, e: EmployeeRow, year: number, canAdjust: boolean): Promise<BalanceView> {
    const policy = this.policyOf(facts, e);
    const row = this.row(facts, e, year);
    const years = (await tx.select({ year: vacationEntitlements.year }).from(vacationEntitlements).where(eq(vacationEntitlements.employeeId, e.id)).orderBy(asc(vacationEntitlements.year))).map((r) => r.year);
    const [expiry] = await tx.select({ recordedAt: vacationBalanceExpiries.recordedAt }).from(vacationBalanceExpiries).where(and(eq(vacationBalanceExpiries.employeeId, e.id), eq(vacationBalanceExpiries.poolYear, year - 1)));
    return {
      employeeId: e.id,
      fullName: e.fullName,
      year,
      currentYear: facts.currentYear,
      years,
      policy: { id: policy.id, name: policy.name, carryOver: policy.carryOver, carryOverCap: policy.carryOverCap },
      hasStartDate: !!e.startDate,
      figures: row.figures,
      history: await this.history(tx, facts, e, year, row.figures),
      expiryRecordedAt: expiry?.recordedAt ?? null,
      canAdjust,
    };
  }

  /** The balance history (spec 6.5): entitlement, carry-over, each adjustment and the expiry, with a running total. */
  private async history(tx: Tx, facts: Facts, e: EmployeeRow, year: number, figures: Balance): Promise<BalanceHistoryEntry[]> {
    const entries: Omit<BalanceHistoryEntry, 'runningTotal'>[] = [];
    const ent = facts.entitlements.get(`${e.id}:${year}`);
    if (ent) {
      const from = e.startDate && e.startDate > `${year}-01-01` ? e.startDate : `${year}-01-01`;
      const parts = entitlementParts(ent);
      entries.push({ date: from, kind: 'entitlement', label: `Entitlement ${year}: ${parts}${ent.monthsWorked !== null ? `, ${ent.monthsWorked} of 12 months` : ''}`, days: ent.totalDays });
    }
    if (figures.carriedOver > 0) entries.push({ date: `${year}-01-01`, kind: 'carry_over', label: `Carried over from ${year - 1}, usable until 30 June ${year}`, days: figures.carriedOver });
    const adjustments = await tx
      .select({ id: vacationBalanceAdjustments.id, days: vacationBalanceAdjustments.days, kind: vacationBalanceAdjustments.kind, reason: vacationBalanceAdjustments.reason, createdAt: vacationBalanceAdjustments.createdAt, userId: vacationBalanceAdjustments.createdByUserId, name: sql<string | null>`(select coalesce(u.display_name, u.email) from ${users} u where u.id = ${vacationBalanceAdjustments.createdByUserId})` })
      .from(vacationBalanceAdjustments)
      .where(and(eq(vacationBalanceAdjustments.employeeId, e.id), eq(vacationBalanceAdjustments.poolYear, year)))
      .orderBy(asc(vacationBalanceAdjustments.createdAt));
    for (const a of adjustments) {
      entries.push({ date: a.createdAt.toISOString().slice(0, 10), kind: 'adjustment', label: `${ADJUSTMENT_LABEL[a.kind]}: ${a.reason}`, days: a.days, actor: a.userId ? { userId: a.userId, name: a.name ?? 'Former member' } : null, reason: a.reason, adjustmentKind: a.kind });
    }
    if (figures.expired > 0) entries.push({ date: `${year}-07-01`, kind: 'expired', label: `Expired: carry-over from ${year - 1} not used by 30 June`, days: -figures.expired });
    entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let total = 0;
    return entries.map((x) => ({ ...x, runningTotal: (total += x.days) }));
  }

  /** The carry-over an employee has into `year` (the daily job's reminders look at it). */
  private carriedOver(facts: Facts, e: EmployeeRow, year: number): number {
    return carriedOverInto(year, facts.today, this.policyOf(facts, e), (y) => this.pool(facts, e.id, y), facts.days.get(e.id) ?? []);
  }
}
