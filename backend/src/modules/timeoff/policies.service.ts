import { ConflictException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employeeTimeoffProfiles, employees, invitations, timeoffPolicies, timeoffPolicyExperienceRules, vacationEntitlements } from '../../shared/database/schema';
import { TenantProvisioning, type TenantProvisioner } from '../../shared/events/tenant-provisioning';
import { EntitlementsService } from './entitlements.service';
import type { ExperienceRule, PolicyRules } from './entitlement';
import { readHistory, recordFieldChange } from './timeoff-history';
import type { CreatePolicy, HistoryQuery, UpdatePolicy } from './timeoff.schemas';

/** A policy as the API answers it (spec 5.5). */
export interface PolicyView {
  id: string;
  name: string;
  baseDays: number;
  maxDays: number | null;
  carryOver: boolean;
  carryOverCap: number | null;
  isDefault: boolean;
  note: string | null;
  /** By threshold, ascending. */
  experienceRules: ExperienceRule[];
  /** Active employees on it (the default policy: those without a profile row too). */
  employees: number;
  updatedAt: Date;
}

/** The policy every new workspace starts with (spec 5.2). */
export const DEFAULT_POLICY = { name: 'Standard', baseDays: 20, maxDays: null, carryOver: true, carryOverCap: null, isDefault: true, note: null } as const;

const byThreshold = (a: ExperienceRule, b: ExperienceRule) => a.fromYears - b.fromYears;

/**
 * Vacation policies (CD-163, spec 5.2, 5.5): any member reads them (the card names the
 * employee's policy); Admins create, change, delete and pick the default (the routes). Editing a
 * policy recomputes the entitlements on it (this year where nothing is frozen yet, later years
 * always) and answers how many employees changed. Each change is in the audit log and, through the
 * triggers of drizzle/0096, in the policy's history.
 */
@Injectable()
export class TimeoffPoliciesService implements TenantProvisioner, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioning,
    private readonly entitlements: EntitlementsService,
  ) {}

  onModuleInit(): void {
    this.provisioning.register(this);
  }

  /** A new workspace gets "Standard" (runs inside tenant creation). */
  async provision(tx: Tx, tenantId: string): Promise<void> {
    await tx.insert(timeoffPolicies).values({ tenantId, ...DEFAULT_POLICY });
  }

  list(ctx: TenantContext): Promise<PolicyView[]> {
    return this.database.withTenant(ctx.tenantId, (tx) => this.listIn(tx));
  }

  /** The policies with their rules and employee counts, default first, then by name. */
  async listIn(tx: Tx, id?: string): Promise<PolicyView[]> {
    const rows = await tx
      .select()
      .from(timeoffPolicies)
      .where(id ? eq(timeoffPolicies.id, id) : undefined)
      .orderBy(sql`${timeoffPolicies.isDefault} desc`, asc(timeoffPolicies.name));
    if (!rows.length) return [];
    const rules = await tx.select().from(timeoffPolicyExperienceRules).orderBy(asc(timeoffPolicyExperienceRules.fromYears));
    const counts = await this.employeeCounts(tx);
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      baseDays: p.baseDays,
      maxDays: p.maxDays,
      carryOver: p.carryOver,
      carryOverCap: p.carryOverCap,
      isDefault: p.isDefault,
      note: p.note,
      experienceRules: rules.filter((r) => r.policyId === p.id).map((r) => ({ fromYears: r.fromYears, extraDays: r.extraDays })),
      employees: counts.get(p.id) ?? 0,
      updatedAt: p.updatedAt,
    }));
  }

  /**
   * Active employees the app shows (members and pending invitations, as the Org structure lists
   * them) per policy: their profile's policy, or the default without a profile row.
   */
  private async employeeCounts(tx: Tx): Promise<Map<string, number>> {
    const { rows } = await tx.execute<{ policy_id: string; n: string }>(sql`
      select coalesce(pr.policy_id, d.id) as policy_id, count(*)::text as n
      from ${employees} e
      left join ${employeeTimeoffProfiles} pr on pr.employee_id = e.id
      left join ${timeoffPolicies} d on d.is_default
      where e.deactivated_at is null
        and (e.user_id is not null or exists (select 1 from ${invitations} i where i.employee_id = e.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()))
      group by 1`);
    return new Map(rows.filter((r) => r.policy_id).map((r) => [r.policy_id, Number(r.n)]));
  }

  async one(tx: Tx, id: string): Promise<PolicyView> {
    const [policy] = await this.listIn(tx, id);
    if (!policy) throw new NotFoundException('Policy not found');
    return policy;
  }

  create(ctx: TenantContext, input: CreatePolicy): Promise<PolicyView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [row] = await tx
          .insert(timeoffPolicies)
          .values({ tenantId: ctx.tenantId, name: input.name, baseDays: input.baseDays, maxDays: input.maxDays, carryOver: input.carryOver, carryOverCap: input.carryOverCap, note: input.note ?? null })
          .returning({ id: timeoffPolicies.id });
        if (input.experienceRules.length) await tx.insert(timeoffPolicyExperienceRules).values(input.experienceRules.map((r) => ({ tenantId: ctx.tenantId, policyId: row!.id, ...r })));
        await this.audit.record(tx, ctx, { action: 'timeoff.policy_created', entityType: 'timeoff_policy', entityId: row!.id, data: { ...input } });
        return this.one(tx, row!.id);
      })
      .catch(mapDbError);
  }

  /** Changes the policy and recomputes the entitlements on it; `recalculated` is how many employees' days changed. */
  update(ctx: TenantContext, id: string, input: UpdatePolicy): Promise<PolicyView & { recalculated: number }> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const before = await this.one(tx, id);
        const { experienceRules, ...fields } = input;
        const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
        if (Object.keys(patch).length) {
          const [row] = await tx
            .update(timeoffPolicies)
            .set(patch)
            .where(eq(timeoffPolicies.id, id))
            .returning({ id: timeoffPolicies.id });
          if (!row) throw new NotFoundException('Policy not found');
        }
        if (experienceRules && !sameRules(before.experienceRules, experienceRules)) {
          await tx.delete(timeoffPolicyExperienceRules).where(eq(timeoffPolicyExperienceRules.policyId, id));
          if (experienceRules.length) await tx.insert(timeoffPolicyExperienceRules).values(experienceRules.map((r) => ({ tenantId: ctx.tenantId, policyId: id, ...r })));
          await recordFieldChange(tx, ctx.tenantId, 'timeoff_policy', id, 'experienceRules', before.experienceRules, [...experienceRules].sort(byThreshold));
          // The policy row's version moves with its rules, so the card's and the list's versions agree.
          await tx.update(timeoffPolicies).set({ note: sql`${timeoffPolicies.note}` }).where(eq(timeoffPolicies.id, id));
        }
        const after = await this.one(tx, id);
        const recalculated = rulesChanged(before, after) ? await this.entitlements.recomputePolicy(tx, ctx.tenantId, id) : 0;
        await this.audit.record(tx, ctx, { action: 'timeoff.policy_updated', entityType: 'timeoff_policy', entityId: id, data: { ...input, recalculated } });
        return { ...after, recalculated };
      })
      .catch(mapDbError);
  }

  /** Only a policy nobody is on, and never the default (make another one the default first). */
  remove(ctx: TenantContext, id: string): Promise<void> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const policy = await this.one(tx, id);
        if (policy.isDefault) throw new ConflictException('This is the default policy. Make another policy the default first.');
        if (policy.employees > 0) throw new ConflictException(`${policy.employees} ${policy.employees === 1 ? 'employee is' : 'employees are'} on this policy. Change their policy first.`);
        const [profile] = await tx.select({ id: employeeTimeoffProfiles.id }).from(employeeTimeoffProfiles).where(eq(employeeTimeoffProfiles.policyId, id)).limit(1);
        if (profile) throw new ConflictException('An employee who left is on this policy. It stays for their history.');
        const [entitlement] = await tx.select({ id: vacationEntitlements.id }).from(vacationEntitlements).where(eq(vacationEntitlements.policyId, id)).limit(1);
        if (entitlement) throw new ConflictException('Vacation days were calculated with this policy. It stays for their history.');
        await tx.delete(timeoffPolicies).where(eq(timeoffPolicies.id, id));
        await this.audit.record(tx, ctx, { action: 'timeoff.policy_deleted', entityType: 'timeoff_policy', entityId: id, data: { name: policy.name } });
      })
      .catch(mapDbError);
  }

  /** The default policy: new employees and employees without a profile row get it. */
  makeDefault(ctx: TenantContext, id: string): Promise<PolicyView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const policy = await this.one(tx, id);
        if (!policy.isDefault) {
          await tx.update(timeoffPolicies).set({ isDefault: false }).where(and(eq(timeoffPolicies.isDefault, true)));
          await tx.update(timeoffPolicies).set({ isDefault: true }).where(eq(timeoffPolicies.id, id));
          // Employees without a profile row follow the default: their entitlements move with it.
          await this.entitlements.recomputeWithoutProfile(tx, ctx.tenantId);
          await this.audit.record(tx, ctx, { action: 'timeoff.policy_default_set', entityType: 'timeoff_policy', entityId: id, data: { name: policy.name } });
        }
        return this.one(tx, id);
      })
      .catch(mapDbError);
  }

  history(ctx: TenantContext, id: string, query: HistoryQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [policy] = await tx.select({ id: timeoffPolicies.id }).from(timeoffPolicies).where(eq(timeoffPolicies.id, id));
      if (!policy) throw new NotFoundException('Policy not found');
      return readHistory(tx, [{ entityType: 'timeoff_policy', ids: [id] }], query);
    });
  }
}

const sameRules = (a: readonly ExperienceRule[], b: readonly ExperienceRule[]) => {
  const sa = [...a].sort(byThreshold);
  const sb = [...b].sort(byThreshold);
  return sa.length === sb.length && sa.every((r, i) => r.fromYears === sb[i]!.fromYears && r.extraDays === sb[i]!.extraDays);
};

/** Whether a change touches what an entitlement is computed from (a renamed policy changes no days). */
const rulesChanged = (a: PolicyRules, b: PolicyRules) => a.baseDays !== b.baseDays || a.maxDays !== b.maxDays || !sameRules(a.experienceRules, b.experienceRules);
