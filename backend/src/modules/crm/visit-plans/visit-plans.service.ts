import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { AuditService } from '../../../shared/audit/audit.service';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { mapDbError } from '../../../shared/database/errors';
import { companies, memberships, tenants, VISIT_PLAN_PERIOD_TYPES, visitPlanLines, visitPlans } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';
import { IdList, nonEmptyPatch, optionalText } from '../../../shared/validation/common';
import { PeopleAccess } from '../../people';
import { RecordHistoryService } from '../history/record-history.service';
import { userNameOf } from '../owner';
import { periodLabel, periodOf } from './periods';
import { VisitScope } from './visit-scope';

const PlanLine = z.object({
  companyId: z.uuid(),
  plannedVisits: z.number().int('Planned visits must be a whole number').min(1, 'Planned visits must be between 1 and 99').max(99, 'Planned visits must be between 1 and 99'),
});
const PlanLines = z
  .array(PlanLine)
  .min(1, 'A plan needs at least one customer')
  .max(500)
  .refine((lines) => new Set(lines.map((l) => l.companyId)).size === lines.length, { message: 'A company can be in a plan only once' });

export const CreateVisitPlan = z.object({
  salespersonUserId: z.uuid(),
  /** Plans are monthly (CD-212); 'month' when left out. 'quarter' is refused (400), see QUARTERLY_REFUSED. */
  periodType: z.enum(VISIT_PLAN_PERIOD_TYPES).optional(),
  /** The first day of the month. */
  periodStart: z.iso.date(),
  note: optionalText(2000),
  lines: PlanLines,
});
/** Every field optional; `lines` replaces the plan's lines (matched by company). */
export const UpdateVisitPlan = nonEmptyPatch(CreateVisitPlan.partial());
export const VisitPlansQuery = z.object({
  periodType: z.enum(VISIT_PLAN_PERIOD_TYPES).optional(),
  periodStart: z.iso.date().optional(),
  salespersonUserId: z.uuid().optional(),
  ids: IdList.optional(),
});
export type CreateVisitPlan = z.infer<typeof CreateVisitPlan>;
export type UpdateVisitPlan = z.infer<typeof UpdateVisitPlan>;
export type VisitPlansQuery = z.infer<typeof VisitPlansQuery>;

type PlanRow = typeof visitPlans.$inferSelect;

export interface VisitPlanView {
  id: string;
  salespersonUserId: string;
  salespersonName: string;
  periodType: PlanRow['periodType'];
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  note: string | null;
  lines: { id: string; companyId: string; companyName: string; plannedVisits: number }[];
  totalPlanned: number;
  /** The caller may change and delete it (Admins: all; managers: their direct reports'). */
  canEdit: boolean;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Visit plans are monthly only (CD-212): a quarter's progress is the sum of its three monthly
 * plans (VisitProgressService). Quarterly plans saved before that stay readable, and can be
 * deleted, but no new ones are made and the old ones aren't changed.
 */
export const QUARTERLY_REFUSED = "Visit plans are monthly. A quarter's progress is the sum of its three monthly plans.";
export const MANAGE_REFUSED = "Only Admins and the salesperson's manager can create, change or delete their visit plans";
export const QUARTERLY_READ_ONLY = 'Quarterly plans can no longer be changed. Make monthly plans instead: a quarter adds up its three months.';

/**
 * Customer visit plans (CD-134): per salesperson and month, which companies to visit how often
 * (monthly only since CD-212; old quarterly plans are read-only). Who sees and manages which plans
 * follows the permission matrix (VisitScope, CD-142): owners and admins all; managers see their
 * reports' plans at any depth and manage their direct reports'; everyone sees their own. Plans the
 * caller may not see don't exist for them (404); seen but not theirs to change is 403.
 * The salesperson gets an email (job "crm.visit-plan-email", same transaction) when someone else
 * creates or changes their plan. Counting the visits held is CD-135.
 */
@Injectable()
export class VisitPlansService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly changes: RecordHistoryService,
    private readonly access: PeopleAccess,
  ) {}

  /** Whose plans the caller sees and manages (permission matrix + org scope), for this request. */
  async scope(ctx: TenantContext, tx?: Tx): Promise<VisitScope> {
    return new VisitScope(await this.access.of(ctx, tx));
  }

  /** For the store: `{ all, manageAll, seesTeam, visibleUserIds, manageableUserIds }` (null = everyone). */
  async scopeView(ctx: TenantContext) {
    return (await this.scope(ctx)).toJSON();
  }

  /** Newest period first, then by salesperson. Only the plans the caller sees, whatever they ask for. */
  list(ctx: TenantContext, query: VisitPlansQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const scope = await this.scope(ctx, tx);
      const filters: (SQL | undefined)[] = [
        query.periodType ? eq(visitPlans.periodType, query.periodType) : undefined,
        query.periodStart ? eq(visitPlans.periodStart, query.periodStart) : undefined,
        query.salespersonUserId ? eq(visitPlans.salespersonUserId, query.salespersonUserId) : undefined,
        query.ids ? inArray(visitPlans.id, query.ids) : undefined,
        scope.filter ? inArray(visitPlans.salespersonUserId, scope.filter) : undefined,
      ];
      const rows = await tx
        .select()
        .from(visitPlans)
        .where(and(...filters))
        .orderBy(desc(visitPlans.periodStart), asc(visitPlans.periodType), asc(userNameOf(visitPlans.salespersonUserId)));
      return { plans: await this.present(tx, ctx, rows, scope) };
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const plan = await this.visible(tx, ctx, id);
      return (await this.present(tx, ctx, [plan], await this.scope(ctx, tx)))[0]!;
    });
  }

  create(ctx: TenantContext, input: CreateVisitPlan) {
    if (input.periodType === 'quarter') throw new BadRequestException(QUARTERLY_REFUSED);
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const scope = await this.scope(ctx, tx);
        if (!scope.canManage(input.salespersonUserId)) throw new ForbiddenException(MANAGE_REFUSED);
        await this.assertSalesperson(tx, ctx, input.salespersonUserId);
        const period = await this.period(tx, ctx, 'month', input.periodStart);
        await this.assertNoDuplicate(tx, input.salespersonUserId, 'month', period.start, period.label);
        await this.assertCompanies(tx, input.lines);
        const [plan] = await tx
          .insert(visitPlans)
          .values({
            tenantId: ctx.tenantId,
            salespersonUserId: input.salespersonUserId,
            periodType: 'month',
            periodStart: period.start,
            periodEnd: period.end,
            note: input.note ?? null,
            createdByUserId: ctx.userId,
          })
          .returning();
        await tx.insert(visitPlanLines).values(input.lines.map((l) => ({ tenantId: ctx.tenantId, planId: plan!.id, companyId: l.companyId, plannedVisits: l.plannedVisits })));
        await this.audit.record(tx, ctx, { action: 'visit_plan.created', entityType: 'visit_plan', entityId: plan!.id, data: input });
        await this.notify(tx, ctx, plan!, 'created');
        return (await this.present(tx, ctx, [plan!], scope))[0]!;
      })
      .catch(mapDbError);
  }

  /** With a `version` (If-Match), a field someone else changed since then is a 409 conflict (CD-20). */
  update(ctx: TenantContext, id: string, input: UpdateVisitPlan, version?: Date) {
    if (input.periodType === 'quarter') throw new BadRequestException(QUARTERLY_REFUSED);
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const scope = await this.scope(ctx, tx);
        const [current] = await tx.select().from(visitPlans).where(eq(visitPlans.id, id)).for('update');
        if (!current || !scope.canSee(current.salespersonUserId)) throw new NotFoundException('Visit plan not found');
        if (!scope.canManage(current.salespersonUserId)) throw new ForbiddenException(MANAGE_REFUSED);
        if (current.periodType === 'quarter') throw new BadRequestException(QUARTERLY_READ_ONLY);
        const { lines, ...fields } = input;
        await this.changes.assertNoConflict(tx, ctx, 'visit_plan', current, fields, version);

        const salespersonUserId = input.salespersonUserId ?? current.salespersonUserId;
        const periodType = input.periodType ?? current.periodType;
        const periodStart = input.periodStart ?? current.periodStart;
        const patch: PgUpdateSetSource<typeof visitPlans> = {};
        if (salespersonUserId !== current.salespersonUserId) {
          if (!scope.canManage(salespersonUserId)) throw new ForbiddenException(MANAGE_REFUSED);
          await this.assertSalesperson(tx, ctx, salespersonUserId);
          patch.salespersonUserId = salespersonUserId;
        }
        const periodChanged = periodType !== current.periodType || periodStart !== current.periodStart;
        if (periodChanged || patch.salespersonUserId) {
          const period = periodChanged ? await this.period(tx, ctx, periodType, periodStart) : null;
          if (period) Object.assign(patch, { periodType, periodStart: period.start, periodEnd: period.end });
          const label = period?.label ?? periodLabel(current.periodType, current.periodStart, current.periodEnd, await this.fiscalStartMonth(tx, ctx));
          await this.assertNoDuplicate(tx, salespersonUserId, periodType, periodStart, label, id);
        }
        if (input.note !== undefined && (input.note ?? null) !== current.note) patch.note = input.note ?? null;

        let linesChanged = false;
        if (lines) {
          await this.assertCompanies(tx, lines);
          linesChanged = await this.replaceLines(tx, ctx, id, lines);
        }
        const changed = linesChanged || Object.keys(patch).length > 0;
        // Line changes move the plan's version too (crm_touch_version), so If-Match sees them.
        const [row] = changed ? await tx.update(visitPlans).set({ ...patch, updatedAt: new Date() }).where(eq(visitPlans.id, id)).returning() : [current];
        if (changed) {
          await this.audit.record(tx, ctx, { action: 'visit_plan.updated', entityType: 'visit_plan', entityId: id, data: input });
          // A plan handed to another salesperson is new to them.
          await this.notify(tx, ctx, row!, patch.salespersonUserId ? 'created' : 'changed');
        }
        return (await this.present(tx, ctx, [row!], scope))[0]!;
      })
      .catch(mapDbError);
  }

  /** Deleting a plan keeps every meeting; only the targets go. */
  remove(ctx: TenantContext, id: string) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const plan = await this.visible(tx, ctx, id);
        if (!(await this.scope(ctx, tx)).canManage(plan.salespersonUserId)) throw new ForbiddenException(MANAGE_REFUSED);
        const deleted = await tx.delete(visitPlans).where(eq(visitPlans.id, id)).returning({ id: visitPlans.id });
        if (!deleted.length) throw new NotFoundException('Visit plan not found');
        await this.audit.record(tx, ctx, { action: 'visit_plan.deleted', entityType: 'visit_plan', entityId: id });
      })
      .catch(mapDbError);
  }

  /** The plan, if the caller may see it (VisitScope); others are "not found". */
  async visible(tx: Tx, ctx: TenantContext, id: string): Promise<PlanRow> {
    const [plan] = await tx.select().from(visitPlans).where(eq(visitPlans.id, id));
    if (!plan || !(await this.scope(ctx, tx)).canSee(plan.salespersonUserId)) throw new NotFoundException('Visit plan not found');
    return plan;
  }

  /**
   * Lines are matched by company: a company that stays keeps its line (and only a changed number
   * is a change in the history), new companies are added, missing ones removed. True if anything changed.
   */
  private async replaceLines(tx: Tx, ctx: TenantContext, planId: string, lines: CreateVisitPlan['lines']): Promise<boolean> {
    const existing = await tx.select().from(visitPlanLines).where(eq(visitPlanLines.planId, planId));
    const byCompany = new Map(existing.map((l) => [l.companyId, l]));
    let changed = false;
    const gone = existing.filter((l) => !lines.some((n) => n.companyId === l.companyId)).map((l) => l.id);
    if (gone.length) {
      await tx.delete(visitPlanLines).where(inArray(visitPlanLines.id, gone));
      changed = true;
    }
    for (const line of lines) {
      const old = byCompany.get(line.companyId);
      if (!old) {
        await tx.insert(visitPlanLines).values({ tenantId: ctx.tenantId, planId, companyId: line.companyId, plannedVisits: line.plannedVisits });
        changed = true;
      } else if (old.plannedVisits !== line.plannedVisits) {
        await tx.update(visitPlanLines).set({ plannedVisits: line.plannedVisits }).where(eq(visitPlanLines.id, old.id));
        changed = true;
      }
    }
    return changed;
  }

  /** The salesperson must be a member of this workspace (users is global). */
  private async assertSalesperson(tx: Tx, ctx: TenantContext, userId: string) {
    const [row] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)));
    if (!row) throw new BadRequestException('The salesperson must be a member of this workspace');
  }

  /** The period starting on `start`, by the workspace's fiscal year; 400 if `start` doesn't begin one. */
  private async period(tx: Tx, ctx: TenantContext, type: PlanRow['periodType'], start: string) {
    const fiscal = await this.fiscalStartMonth(tx, ctx);
    const period = periodOf(type, start, fiscal);
    if (!period) {
      throw new BadRequestException(
        type === 'month' ? 'A monthly plan starts on the first day of a month' : "A quarterly plan starts on the first day of a quarter of the workspace's fiscal year",
      );
    }
    return period;
  }

  private async fiscalStartMonth(tx: Tx, ctx: TenantContext): Promise<number> {
    // tenants is a platform table without RLS, so filter by the caller's tenant explicitly.
    const [workspace] = await tx.select({ fiscal: tenants.fiscalYearStartMonth }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    return workspace?.fiscal ?? 1;
  }

  private async assertNoDuplicate(tx: Tx, salespersonUserId: string, periodType: PlanRow['periodType'], periodStart: string, label: string, exceptId?: string) {
    const [dup] = await tx
      .select({ id: visitPlans.id, name: userNameOf(visitPlans.salespersonUserId) })
      .from(visitPlans)
      .where(
        and(
          eq(visitPlans.salespersonUserId, salespersonUserId),
          eq(visitPlans.periodType, periodType),
          eq(visitPlans.periodStart, periodStart),
          exceptId ? ne(visitPlans.id, exceptId) : undefined,
        ),
      );
    if (dup) throw new ConflictException(`${dup.name ?? 'This salesperson'} already has a plan for ${label}. Open that plan and change it instead.`);
  }

  private async assertCompanies(tx: Tx, lines: CreateVisitPlan['lines']) {
    const ids = lines.map((l) => l.companyId);
    const found = await tx.select({ id: companies.id }).from(companies).where(inArray(companies.id, ids));
    if (found.length !== new Set(ids).size) throw new BadRequestException('A company in this plan was not found. It may have been deleted.');
  }

  /** Emails the salesperson (worker, if they want it) when someone else created or changed their plan. */
  private async notify(tx: Tx, ctx: TenantContext, plan: PlanRow, kind: 'created' | 'changed') {
    if (plan.salespersonUserId === ctx.userId) return;
    await this.jobs.send('crm.visit-plan-email', { tenantId: ctx.tenantId, planId: plan.id, actorUserId: ctx.userId, kind }, tx);
  }

  /** Plans as the API returns them: with the salesperson's name, the period's label and the lines (by company name). */
  private async present(tx: Tx, ctx: TenantContext, rows: PlanRow[], scope: VisitScope): Promise<VisitPlanView[]> {
    if (rows.length === 0) return [];
    const fiscal = await this.fiscalStartMonth(tx, ctx);
    const names = await tx
      .select({ id: visitPlans.id, name: userNameOf(visitPlans.salespersonUserId) })
      .from(visitPlans)
      .where(inArray(visitPlans.id, rows.map((r) => r.id)));
    const nameOf = new Map(names.map((n) => [n.id, n.name]));
    const lines = await tx
      .select({ id: visitPlanLines.id, planId: visitPlanLines.planId, companyId: visitPlanLines.companyId, companyName: companies.name, plannedVisits: visitPlanLines.plannedVisits })
      .from(visitPlanLines)
      .innerJoin(companies, eq(companies.id, visitPlanLines.companyId))
      .where(inArray(visitPlanLines.planId, rows.map((r) => r.id)))
      .orderBy(asc(companies.name), asc(visitPlanLines.createdAt));
    return rows.map((r) => {
      const own = lines.filter((l) => l.planId === r.id).map(({ planId: _planId, ...l }) => l);
      return {
        id: r.id,
        salespersonUserId: r.salespersonUserId,
        salespersonName: nameOf.get(r.id) ?? 'Former member',
        periodType: r.periodType,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        periodLabel: periodLabel(r.periodType, r.periodStart, r.periodEnd, fiscal),
        note: r.note,
        lines: own,
        totalPlanned: own.reduce((sum, l) => sum + l.plannedVisits, 0),
        canEdit: scope.canManage(r.salespersonUserId),
        createdByUserId: r.createdByUserId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }
}
