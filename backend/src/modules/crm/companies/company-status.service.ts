import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, type Column, desc, eq, inArray } from 'drizzle-orm';
import { hasRole, type TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { auditLogs, companies, contacts, deals, funnelStages, projects } from '../../../shared/database/schema';
import { userNameOf } from '../owner';
import { type CompanyStatus, computeStatus, effectiveStatus, type OpportunityState, opportunityReadiness, type ProjectState, STATUS_LABELS, STATUS_RANK } from './company-status';

/** Who caused a recompute: the person whose change it follows (a job passes the original actor). */
export type StatusActor = Pick<TenantContext, 'tenantId' | 'userId'>;

/**
 * Keeps companies.status in step with the rules in company-status.ts (CD-358). The CRM services call
 * `recompute` in the same transaction as every change that can move it (the company's identity, its
 * contacts, its opportunities); projects tell the CRM worker through `projects.company-projects-changed`.
 * Every change writes an audit row `company.status_changed` with the reason (automatic or manual),
 * which is also the company's status history.
 */
@Injectable()
export class CompanyStatusService {
  constructor(private readonly database: DatabaseService) {}

  /** Recomputes these companies (or every company of the workspace) and stores what changed. */
  async recompute(tx: Tx, actor: StatusActor, companyIds: readonly (string | null | undefined)[] | 'all'): Promise<void> {
    const ids = companyIds === 'all' ? null : [...new Set(companyIds.filter((id): id is string => !!id))];
    if (ids && ids.length === 0) return;
    const of = (col: Column) => (ids ? inArray(col, ids) : undefined);
    // Locked first (in id order, so two recomputes never deadlock): the facts below are then read
    // after any other change to these companies has committed, and a stale status can't win.
    const rows = await tx.select().from(companies).where(of(companies.id)).orderBy(companies.id).for('update');
    const [people, opps, projs] = await Promise.all([      tx.select({ companyId: contacts.companyId, fullName: contacts.fullName, jobTitle: contacts.jobTitle, buyerRole: contacts.buyerRole, ownerUserId: contacts.ownerUserId }).from(contacts).where(of(contacts.companyId)),
      tx.select({ companyId: deals.companyId, lostAt: deals.lostAt, isWon: funnelStages.isWon }).from(deals).innerJoin(funnelStages, eq(funnelStages.id, deals.stageId)).where(of(deals.companyId)),
      tx.select({ companyId: projects.companyId, status: projects.status }).from(projects).where(of(projects.companyId)),
    ]);
    const group = <T extends { companyId: string | null }>(list: T[]) => {
      const by = new Map<string, T[]>();
      for (const r of list) if (r.companyId) by.set(r.companyId, [...(by.get(r.companyId) ?? []), r]);
      return by;
    };
    const peopleBy = group(people);
    const oppsBy = group(opps);
    const projsBy = group(projs);
    for (const company of rows) {
      const computed = computeStatus({
        company,
        contacts: peopleBy.get(company.id) ?? [],
        opportunities: (oppsBy.get(company.id) ?? []).map((d): OpportunityState => (d.lostAt ? 'lost' : d.isWon ? 'won' : 'open')),
        projects: (projsBy.get(company.id) ?? []).map((p) => p.status as ProjectState),
      });
      const next = effectiveStatus(computed, company.statusSetManually ? company.status : null);
      if (next !== company.status) await this.store(tx, actor, company.id, company.status, next, 'automatic');
    }
  }

  /**
   * "Set status back…" and "Back to automatic" (CD-358). Owners, admins and the company's owner only.
   * A status can only be set back (a lower rank than now); forward is the automation's job (409 with
   * what is missing). `null` hands the status back to the automation, which recomputes it at once.
   */
  setStatus(ctx: TenantContext, id: string, status: CompanyStatus | null) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [company] = await tx.select().from(companies).where(eq(companies.id, id)).for('update');
        if (!company) throw new NotFoundException('Company not found');
        if (!hasRole(ctx.role, 'admin') && company.ownerUserId !== ctx.userId) throw new ForbiddenException("Only the company's owner, owners and admins can change its status");
        if (status === null) {
          await tx.update(companies).set({ statusSetManually: false }).where(eq(companies.id, id));
          await this.recompute(tx, ctx, [id]);
        } else {
          if (STATUS_RANK[status] > STATUS_RANK[company.status]) {
            const people = await tx.select().from(contacts).where(eq(contacts.companyId, id));
            const { blockers } = opportunityReadiness(company, people);
            throw new ConflictException({
              message: `The status moves forward by itself: ${STATUS_LABELS[status]} follows the company's data, opportunities and projects. You can only set it back.`,
              blockers: status === 'opportunity' ? blockers : [],
            });
          }
          await tx.update(companies).set({ statusSetManually: true }).where(eq(companies.id, id));
          if (status !== company.status) await this.store(tx, ctx, id, company.status, status, 'manual');
        }
        const [row] = await tx.select().from(companies).where(eq(companies.id, id));
        return row!;
      })
      .catch(mapDbError);
  }

  /** The company's status changes, newest first: the audit rows `company.status_changed`. */
  history(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select({ at: auditLogs.createdAt, data: auditLogs.data, actorUserId: auditLogs.actorUserId, actorName: userNameOf(auditLogs.actorUserId) })
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, 'company'), eq(auditLogs.entityId, id), eq(auditLogs.action, 'company.status_changed')))
        .orderBy(desc(auditLogs.createdAt))
        .limit(50);
      return rows.map(({ data, ...r }) => ({ ...r, ...(data as { from: CompanyStatus; to: CompanyStatus; reason: 'automatic' | 'manual' }) }));
    });
  }

  private async store(tx: Tx, actor: StatusActor, id: string, from: CompanyStatus, to: CompanyStatus, reason: 'automatic' | 'manual') {
    await tx.update(companies).set({ status: to, statusChangedAt: new Date() }).where(eq(companies.id, id));
    // Written here rather than through AuditService.record, which wants a TenantContext with a role:
    // the projects job recomputes as the person behind the change, with no role to hand. Same row shape.
    await tx.insert(auditLogs).values({ tenantId: actor.tenantId, actorUserId: actor.userId, action: 'company.status_changed', entityType: 'company', entityId: id, data: { from, to, reason } });
  }
}
