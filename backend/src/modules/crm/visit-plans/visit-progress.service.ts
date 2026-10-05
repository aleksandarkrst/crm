import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { companies, deals, type MeetingStatus, meetingParticipants, meetings, tenants, users, VISIT_PLAN_PERIOD_TYPES, visitPlanLines, visitPlans } from '../../../shared/database/schema';
import { zonedDayStart, zonedParts } from '../../../shared/time/zoned-time';
import { IdList } from '../../../shared/validation/common';
import { periodLabel, periodOf, periodStartOf } from './periods';
import {
  type CountedMeeting,
  countVisits,
  creditedSalesperson,
  paceOf,
  periodShare,
  type UnplannedVisits,
  type VisitLineProgress,
  type VisitPace,
  type VisitProgress,
  type VisitTotals,
} from './visit-counting';
import { VisitPlansService } from './visit-plans.service';

const flag = z.enum(['1', 'true', '0', 'false']).transform((v) => v === '1' || v === 'true');
const PeriodQuery = {
  periodType: z.enum(VISIT_PLAN_PERIOD_TYPES).default('month'),
  /** The first day of the period; default: the current one (workspace date). */
  periodStart: z.iso.date().optional(),
};
export const ProgressBatchQuery = z.object({ ids: IdList });
export const VisitReportQuery = z.object({ ...PeriodQuery, salespersonUserId: z.uuid().optional(), companyId: z.uuid().optional() });
export const ProgressSummaryQuery = z.object({ ...PeriodQuery, salespersonUserId: z.uuid().optional(), all: flag.optional(), companyId: z.uuid().optional() });
export type ProgressBatchQuery = z.infer<typeof ProgressBatchQuery>;
export type VisitReportQuery = z.infer<typeof VisitReportQuery>;
export type ProgressSummaryQuery = z.infer<typeof ProgressSummaryQuery>;

type PlanRow = typeof visitPlans.$inferSelect;
type PlanLine = { planId: string; companyId: string; companyName: string; plannedVisits: number };

/** A counted meeting with what the plan page lists of it. */
export interface VisitMeeting extends CountedMeeting {
  title: string;
}

export interface VisitPlanProgressView {
  planId: string;
  salespersonUserId: string;
  periodType: PlanRow['periodType'];
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  lines: (VisitLineProgress & { companyName: string })[];
  unplanned: UnplannedVisits[];
  totals: VisitTotals;
  /** The meetings the numbers are made of, by id (the plan page lists them). */
  meetings: Record<string, { id: string; title: string; startsAt: Date; endsAt: Date; status: MeetingStatus; companyName: string }>;
}

/** One salesperson's numbers for a period: a report row, or the Overview card's sum. */
export interface VisitRow {
  planned: number;
  heldCapped: number;
  held: number;
  upcoming: number;
  notClosed: number;
  unplanned: number;
  overPlan: number;
  completion: number;
  expectedPace: number;
  pace: VisitPace;
}

export interface VisitReportRow extends VisitRow {
  salespersonUserId: string;
  salespersonName: string;
  /** null: no plan for this period, only unplanned visits. */
  planId: string | null;
}

const isManager = (ctx: TenantContext) => ctx.role !== 'member';

/** The workspace's time zone and fiscal-year start (tenants has no RLS: filter by tenant). */
async function workspaceOf(tx: Tx, tenantId: string): Promise<{ timeZone: string; fiscal: number }> {
  const [w] = await tx.select({ timeZone: tenants.timezone, fiscal: tenants.fiscalYearStartMonth }).from(tenants).where(eq(tenants.id, tenantId));
  return { timeZone: w?.timeZone ?? 'UTC', fiscal: w?.fiscal ?? 1 };
}

/**
 * The Customer visits (planned or held; cancelled never count) starting in any of these periods,
 * on the zone's clock, with their deal's owner and the members at them: one query, whoever they
 * count for. Uses meetings_tenant_starts_idx.
 */
export async function loadVisits(tx: Tx, periods: readonly { start: string; end: string }[], timeZone: string): Promise<VisitMeeting[]> {
  const ranges = [...new Map(periods.map((p) => [`${p.start}/${p.end}`, p])).values()];
  if (!ranges.length) return [];
  const rows = await tx
    .select({
      id: meetings.id,
      title: meetings.title,
      type: meetings.type,
      status: meetings.status,
      startsAt: meetings.startsAt,
      endsAt: meetings.endsAt,
      companyId: meetings.companyId,
      companyName: companies.name,
      organizerUserId: meetings.organizerUserId,
      dealOwnerUserId: deals.ownerUserId,
      internalUserIds: sql<string[]>`array(select p.user_id::text from ${meetingParticipants} p where p.meeting_id = ${meetings.id} and p.user_id is not null)`,
    })
    .from(meetings)
    .innerJoin(companies, eq(companies.id, meetings.companyId))
    .leftJoin(deals, eq(deals.id, meetings.dealId))
    .where(
      and(
        eq(meetings.type, 'visit'),
        inArray(meetings.status, ['planned', 'held']),
        or(...ranges.map((r) => and(gte(meetings.startsAt, zonedDayStart(r.start, timeZone)), lt(meetings.startsAt, zonedDayStart(r.end, timeZone))))),
      ),
    )
    .orderBy(asc(meetings.startsAt));
  return rows.map((r) => ({ ...r, internalUserIds: r.internalUserIds ?? [] }));
}

async function linesOf(tx: Tx, planIds: string[]): Promise<PlanLine[]> {
  if (!planIds.length) return [];
  return tx
    .select({ planId: visitPlanLines.planId, companyId: visitPlanLines.companyId, companyName: companies.name, plannedVisits: visitPlanLines.plannedVisits })
    .from(visitPlanLines)
    .innerJoin(companies, eq(companies.id, visitPlanLines.companyId))
    .where(inArray(visitPlanLines.planId, planIds))
    .orderBy(asc(companies.name));
}

/**
 * The progress of each plan (by plan id), counted with countVisits from one query for the lines
 * and one for the meetings of all their periods. The daily digest uses it too.
 */
export async function progressOfPlans(
  tx: Tx,
  plans: readonly Pick<PlanRow, 'id' | 'salespersonUserId' | 'periodStart' | 'periodEnd'>[],
  timeZone: string,
  now: Date,
): Promise<Map<string, { lines: PlanLine[]; progress: VisitProgress; meetings: VisitMeeting[] }>> {
  const lines = await linesOf(
    tx,
    plans.map((p) => p.id),
  );
  const visits = await loadVisits(
    tx,
    plans.map((p) => ({ start: p.periodStart, end: p.periodEnd })),
    timeZone,
  );
  const out = new Map<string, { lines: PlanLine[]; progress: VisitProgress; meetings: VisitMeeting[] }>();
  for (const p of plans) {
    const own = lines.filter((l) => l.planId === p.id);
    const progress = countVisits({ salespersonUserId: p.salespersonUserId, periodStart: p.periodStart, periodEnd: p.periodEnd, lines: own }, visits, now, timeZone);
    out.set(p.id, { lines: own, progress, meetings: visits });
  }
  return out;
}

/** A row's numbers from a plan's progress; with `companyId`, only that customer's. */
function rowOf(progress: VisitProgress, companyId: string | undefined, start: string, now: Date, timeZone: string): VisitRow {
  if (!companyId) {
    const { pace, ...t } = progress.totals;
    return { ...t, pace };
  }
  const line = progress.lines.find((l) => l.companyId === companyId);
  const unplanned = progress.unplanned.find((u) => u.companyId === companyId)?.held ?? 0;
  const completion = line ? line.completion : 0;
  const expectedPace = progress.totals.expectedPace;
  return {
    planned: line?.planned ?? 0,
    heldCapped: line?.heldCapped ?? 0,
    held: line?.held ?? 0,
    upcoming: line?.upcoming ?? 0,
    notClosed: line?.notClosed ?? 0,
    unplanned,
    overPlan: line?.overPlan ?? 0,
    completion,
    expectedPace,
    pace: paceOf(completion, expectedPace, now, start, timeZone),
  };
}

/** The sum of rows: completion is Σ capped / Σ planned again, never an average of percentages. */
function sumRows(rows: readonly VisitRow[], expectedPace: number, start: string, now: Date, timeZone: string): VisitRow {
  const sum = (f: (r: VisitRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const planned = sum((r) => r.planned);
  const heldCapped = sum((r) => r.heldCapped);
  const completion = planned > 0 ? heldCapped / planned : 0;
  return {
    planned,
    heldCapped,
    held: sum((r) => r.held),
    upcoming: sum((r) => r.upcoming),
    notClosed: sum((r) => r.notClosed),
    unplanned: sum((r) => r.unplanned),
    overPlan: sum((r) => r.overPlan),
    completion,
    expectedPace,
    pace: paceOf(completion, expectedPace, now, start, timeZone),
  };
}

/**
 * Visit plan tracking (CD-135): planned vs. held Customer visits, for a plan page, the list,
 * Reports → Visit-plan completion, the Overview card and the company card. Every number comes from
 * countVisits (visit-counting.ts). Plans are visible as in VisitPlansService: members only their
 * own; the report is for owners and admins (the controller checks the role).
 */
@Injectable()
export class VisitProgressService {
  constructor(
    private readonly database: DatabaseService,
    private readonly plans: VisitPlansService,
  ) {}

  /** One plan's progress per customer, with the meetings behind each number. */
  progress(ctx: TenantContext, id: string, now = new Date()): Promise<VisitPlanProgressView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const plan = await this.plans.visible(tx, ctx, id);
      const { timeZone, fiscal } = await workspaceOf(tx, ctx.tenantId);
      const counted = (await progressOfPlans(tx, [plan], timeZone, now)).get(plan.id)!;
      const names = new Map(counted.lines.map((l) => [l.companyId, l.companyName]));
      const used = new Set([
        ...counted.progress.lines.flatMap((l) => [...l.heldMeetingIds, ...l.upcomingMeetingIds, ...l.notClosedMeetingIds]),
        ...counted.progress.unplanned.flatMap((u) => u.meetingIds),
      ]);
      const listed: VisitPlanProgressView['meetings'] = {};
      for (const m of counted.meetings) {
        if (used.has(m.id)) listed[m.id] = { id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, status: m.status, companyName: m.companyName };
      }
      return {
        planId: plan.id,
        salespersonUserId: plan.salespersonUserId,
        periodType: plan.periodType,
        periodStart: plan.periodStart,
        periodEnd: plan.periodEnd,
        periodLabel: periodLabel(plan.periodType, plan.periodStart, plan.periodEnd, fiscal),
        lines: counted.progress.lines.map((l) => ({ ...l, companyName: names.get(l.companyId) ?? '' })),
        unplanned: counted.progress.unplanned,
        totals: counted.progress.totals,
        meetings: listed,
      };
    });
  }

  /** The totals of several plans (the list's completion column); plans the caller can't see are left out. */
  batch(ctx: TenantContext, ids: string[], now = new Date()) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(visitPlans)
        .where(and(inArray(visitPlans.id, ids), isManager(ctx) ? undefined : eq(visitPlans.salespersonUserId, ctx.userId)));
      const { timeZone } = await workspaceOf(tx, ctx.tenantId);
      const counted = await progressOfPlans(tx, rows, timeZone, now);
      return { progress: rows.map((p) => ({ planId: p.id, totals: counted.get(p.id)!.progress.totals })) };
    });
  }

  /**
   * Reports → Visit-plan completion (owners and admins): one row per salesperson with a plan for
   * the period, plus anyone credited with held visits there without a plan (all unplanned). With
   * `companyId`, each row is that customer only: how often it was visited, across salespeople.
   */
  report(ctx: TenantContext, query: VisitReportQuery, now = new Date()) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const { timeZone, fiscal } = await workspaceOf(tx, ctx.tenantId);
      const period = this.period(query.periodType, query.periodStart, fiscal, timeZone, now);
      const plans = await this.plansOf(tx, query.periodType, period.start, query.salespersonUserId);
      const counted = await progressOfPlans(tx, plans, timeZone, now);
      const expectedPace = periodShare(period.start, period.end, now, timeZone);

      const rows: Omit<VisitReportRow, 'salespersonName'>[] = [];
      for (const p of plans) {
        const c = counted.get(p.id)!;
        if (query.companyId && !c.lines.some((l) => l.companyId === query.companyId) && !c.progress.unplanned.some((u) => u.companyId === query.companyId)) continue;
        rows.push({ salespersonUserId: p.salespersonUserId, planId: p.id, ...rowOf(c.progress, query.companyId, period.start, now, timeZone) });
      }
      // Held visits credited to someone without a plan for this period still show (all unplanned).
      const visits = plans.length ? [...counted.values()][0]!.meetings : await loadVisits(tx, [period], timeZone);
      const withPlan = new Set(plans.map((p) => p.salespersonUserId));
      const others = new Set<string>();
      for (const m of visits) {
        const who = creditedSalesperson(m);
        if (m.status !== 'held' || !who || withPlan.has(who)) continue;
        if (query.salespersonUserId && who !== query.salespersonUserId) continue;
        if (query.companyId && m.companyId !== query.companyId) continue;
        others.add(who);
      }
      for (const who of others) {
        const progress = countVisits({ salespersonUserId: who, periodStart: period.start, periodEnd: period.end, lines: [] }, visits, now, timeZone);
        if (progress.totals.unplanned) rows.push({ salespersonUserId: who, planId: null, ...rowOf(progress, query.companyId, period.start, now, timeZone) });
      }

      const names = await this.namesOf(
        tx,
        rows.map((r) => r.salespersonUserId),
      );
      const named: VisitReportRow[] = rows.map((r) => ({ ...r, salespersonName: names.get(r.salespersonUserId) ?? 'Former member' })).sort((a, b) => a.salespersonName.localeCompare(b.salespersonName));
      return {
        periodType: query.periodType,
        periodStart: period.start,
        periodEnd: period.end,
        periodLabel: period.label,
        companyId: query.companyId ?? null,
        rows: named,
        totals: sumRows(named, expectedPace, period.start, now, timeZone),
      };
    });
  }

  /**
   * The Overview card (and the company card, with `companyId`): the period's totals over the
   * plans of one salesperson, or of everyone (`all=1`, the default for owners and admins).
   * Members always get their own.
   */
  summary(ctx: TenantContext, query: ProgressSummaryQuery, now = new Date()) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const { timeZone, fiscal } = await workspaceOf(tx, ctx.tenantId);
      const period = this.period(query.periodType, query.periodStart, fiscal, timeZone, now);
      const salesperson = !isManager(ctx) ? ctx.userId : query.all ? undefined : query.salespersonUserId;
      let plans = await this.plansOf(tx, query.periodType, period.start, salesperson);
      const counted = await progressOfPlans(tx, plans, timeZone, now);
      if (query.companyId) plans = plans.filter((p) => counted.get(p.id)!.lines.some((l) => l.companyId === query.companyId));
      const rows = plans.map((p) => rowOf(counted.get(p.id)!.progress, query.companyId, period.start, now, timeZone));
      const names = await this.namesOf(
        tx,
        plans.map((p) => p.salespersonUserId),
      );
      return {
        periodType: query.periodType,
        periodStart: period.start,
        periodEnd: period.end,
        periodLabel: period.label,
        salespersonUserId: salesperson ?? null,
        ...sumRows(rows, periodShare(period.start, period.end, now, timeZone), period.start, now, timeZone),
        plans: plans.map((p) => ({ id: p.id, salespersonUserId: p.salespersonUserId, salespersonName: names.get(p.salespersonUserId) ?? 'Former member' })),
      };
    });
  }

  /** The period of this type starting on `start`, or the current one; 400 when `start` doesn't begin one. */
  private period(type: PlanRow['periodType'], start: string | undefined, fiscal: number, timeZone: string, now: Date) {
    const first = start ?? periodStartOf(type, zonedParts(now, timeZone).date, fiscal);
    const period = periodOf(type, first, fiscal);
    if (!period) throw new BadRequestException(type === 'month' ? 'A month starts on its first day' : "A quarter starts on the first day of a quarter of the workspace's fiscal year");
    return period;
  }

  private plansOf(tx: Tx, type: PlanRow['periodType'], start: string, salespersonUserId?: string) {
    return tx
      .select()
      .from(visitPlans)
      .where(and(eq(visitPlans.periodType, type), eq(visitPlans.periodStart, start), salespersonUserId ? eq(visitPlans.salespersonUserId, salespersonUserId) : undefined));
  }

  private async namesOf(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await tx
      .select({ id: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email})` })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
