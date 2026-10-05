import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantContext } from '../../../shared/authorization';
import { DatabaseService, type Tx } from '../../../shared/database/database.service';
import { companies, deals, type MeetingStatus, meetingParticipants, meetings, tenants, users, VISIT_PLAN_PERIOD_TYPES, visitPlanLines, visitPlans } from '../../../shared/database/schema';
import { zonedDayStart, zonedParts } from '../../../shared/time/zoned-time';
import { IdList } from '../../../shared/validation/common';
import { periodLabel, periodOf, periodStartOf, shiftPeriod } from './periods';
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
  /** The meetings behind each number, so a link opens exactly them (the Calendar's `ids=`). */
  meetingIds: VisitRowMeetings;
}

export interface VisitRowMeetings {
  held: string[];
  upcoming: string[];
  notClosed: string[];
  unplanned: string[];
}

export interface VisitReportRow extends VisitRow {
  salespersonUserId: string;
  salespersonName: string;
  /** null: no plan for this period, only unplanned visits. For a quarter: its first monthly plan. */
  planId: string | null;
  /** The monthly plans counted (a quarter has up to three), with their month. */
  plans: { id: string; periodStart: string; periodLabel: string }[];
}

/** A group's monthly plans with their month's label ("October 2026"). */
const monthsOf = (g: PlanGroup, fiscal: number) => g.plans.map((p) => ({ id: p.id, periodStart: p.periodStart, periodLabel: periodLabel('month', p.periodStart, shiftPeriod('month', p.periodStart, 1), fiscal) }));

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
    // A left join still: meetings saved without a deal before CD-213 count too (for their organizer).
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
 * What one salesperson is counted against for a period: one monthly plan, or for a quarter
 * (CD-212) the monthly plans of its three months, their lines summed per customer.
 */
export interface PlanGroup {
  salespersonUserId: string;
  periodStart: string;
  periodEnd: string;
  plans: Pick<PlanRow, 'id' | 'periodStart'>[];
}

/** Lines of the group's plans, one per customer: the planned visits added up. */
function mergeLines(lines: readonly PlanLine[], planIds: readonly string[], key: string): PlanLine[] {
  const ids = new Set(planIds);
  const byCompany = new Map<string, PlanLine>();
  for (const l of lines) {
    if (!ids.has(l.planId)) continue;
    const had = byCompany.get(l.companyId);
    byCompany.set(l.companyId, had ? { ...had, plannedVisits: had.plannedVisits + l.plannedVisits } : { ...l, planId: key });
  }
  return [...byCompany.values()];
}

/**
 * The progress of each group (same order), counted with countVisits from one query for the lines
 * and one for the meetings of all their periods. A quarter counts like a month: held, upcoming
 * and not closed over the whole quarter, completion capped per customer at the quarter's sum.
 */
export async function progressOfGroups(
  tx: Tx,
  groups: readonly PlanGroup[],
  timeZone: string,
  now: Date,
): Promise<{ lines: PlanLine[]; progress: VisitProgress; meetings: VisitMeeting[] }[]> {
  const lines = await linesOf(
    tx,
    groups.flatMap((g) => g.plans.map((p) => p.id)),
  );
  const visits = await loadVisits(
    tx,
    groups.map((g) => ({ start: g.periodStart, end: g.periodEnd })),
    timeZone,
  );
  return groups.map((g) => {
    const own = mergeLines(
      lines,
      g.plans.map((p) => p.id),
      g.plans[0]?.id ?? '',
    );
    const progress = countVisits({ salespersonUserId: g.salespersonUserId, periodStart: g.periodStart, periodEnd: g.periodEnd, lines: own }, visits, now, timeZone);
    return { lines: own, progress, meetings: visits };
  });
}

/** The progress of each plan (by plan id), on its own period. The daily digest uses it too. */
export async function progressOfPlans(
  tx: Tx,
  plans: readonly Pick<PlanRow, 'id' | 'salespersonUserId' | 'periodStart' | 'periodEnd'>[],
  timeZone: string,
  now: Date,
): Promise<Map<string, { lines: PlanLine[]; progress: VisitProgress; meetings: VisitMeeting[] }>> {
  const counted = await progressOfGroups(
    tx,
    plans.map((p) => ({ salespersonUserId: p.salespersonUserId, periodStart: p.periodStart, periodEnd: p.periodEnd, plans: [p] })),
    timeZone,
    now,
  );
  return new Map(plans.map((p, i) => [p.id, counted[i]!]));
}

/**
 * The plans counted for a period, one group per salesperson: a month's monthly plans, or the
 * monthly plans of a quarter's three months (CD-212). Quarterly plans saved before CD-212 are
 * left out: they only show on their own page.
 */
export async function planGroupsOf(tx: Tx, period: { type: PlanRow['periodType']; start: string; end: string }, salespersonUserId?: string): Promise<PlanGroup[]> {
  const rows = await tx
    .select({ id: visitPlans.id, salespersonUserId: visitPlans.salespersonUserId, periodStart: visitPlans.periodStart })
    .from(visitPlans)
    .where(
      and(
        eq(visitPlans.periodType, 'month'),
        period.type === 'month' ? eq(visitPlans.periodStart, period.start) : and(gte(visitPlans.periodStart, period.start), lt(visitPlans.periodStart, period.end)),
        salespersonUserId ? eq(visitPlans.salespersonUserId, salespersonUserId) : undefined,
      ),
    )
    .orderBy(asc(visitPlans.periodStart));
  const groups = new Map<string, PlanGroup>();
  for (const r of rows) {
    const g = groups.get(r.salespersonUserId) ?? { salespersonUserId: r.salespersonUserId, periodStart: period.start, periodEnd: period.end, plans: [] };
    g.plans.push({ id: r.id, periodStart: r.periodStart });
    groups.set(r.salespersonUserId, g);
  }
  return [...groups.values()];
}

/** A row's numbers from a plan's progress; with `companyId`, only that customer's. */
function rowOf(progress: VisitProgress, companyId: string | undefined, start: string, now: Date, timeZone: string): VisitRow {
  if (!companyId) {
    const { pace, ...t } = progress.totals;
    const meetingIds = {
      held: progress.lines.flatMap((l) => l.heldMeetingIds),
      upcoming: progress.lines.flatMap((l) => l.upcomingMeetingIds),
      notClosed: progress.lines.flatMap((l) => l.notClosedMeetingIds),
      unplanned: progress.unplanned.flatMap((u) => u.meetingIds),
    };
    return { ...t, pace, meetingIds };
  }
  const line = progress.lines.find((l) => l.companyId === companyId);
  const outside = progress.unplanned.find((u) => u.companyId === companyId);
  const unplanned = outside?.held ?? 0;
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
    meetingIds: { held: line?.heldMeetingIds ?? [], upcoming: line?.upcomingMeetingIds ?? [], notClosed: line?.notClosedMeetingIds ?? [], unplanned: outside?.meetingIds ?? [] },
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
    meetingIds: {
      held: rows.flatMap((r) => r.meetingIds.held),
      upcoming: rows.flatMap((r) => r.meetingIds.upcoming),
      notClosed: rows.flatMap((r) => r.meetingIds.notClosed),
      unplanned: rows.flatMap((r) => r.meetingIds.unplanned),
    },
  };
}

/**
 * Visit plan tracking (CD-135): planned vs. held Customer visits, for a plan page, the list,
 * Reports → Visit-plan completion, the Overview card and the company card. Every number comes from
 * countVisits (visit-counting.ts). Plans are visible as in VisitPlansService (VisitScope, CD-142):
 * everyone their own, managers their reports' at any depth, owners and admins all. The report is
 * for those who see others' plans (Admins and managers), each seeing only their rows.
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
      const scope = await this.plans.scope(ctx, tx);
      const rows = await tx
        .select()
        .from(visitPlans)
        .where(and(inArray(visitPlans.id, ids), scope.filter ? inArray(visitPlans.salespersonUserId, scope.filter) : undefined));
      const { timeZone } = await workspaceOf(tx, ctx.tenantId);
      const counted = await progressOfPlans(tx, rows, timeZone, now);
      return { progress: rows.map((p) => ({ planId: p.id, totals: counted.get(p.id)!.progress.totals })) };
    });
  }

  /**
   * Reports → Visit-plan completion (owners, admins and managers): one row per salesperson with a
   * plan for the period, plus anyone credited with held visits there without a plan (all
   * unplanned). Managers get their own row and their reports' (any depth), nobody else's. With
   * `companyId`, each row is that customer only: how often it was visited, across salespeople.
   */
  report(ctx: TenantContext, query: VisitReportQuery, now = new Date()) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const scope = await this.plans.scope(ctx, tx);
      if (!scope.seesTeam) throw new ForbiddenException('Reports are for owners, admins and managers');
      const { timeZone, fiscal } = await workspaceOf(tx, ctx.tenantId);
      const period = this.period(query.periodType, query.periodStart, fiscal, timeZone, now);
      const groups = (await planGroupsOf(tx, period, query.salespersonUserId)).filter((g) => scope.canSee(g.salespersonUserId));
      const counted = await progressOfGroups(tx, groups, timeZone, now);
      const expectedPace = periodShare(period.start, period.end, now, timeZone);

      const rows: Omit<VisitReportRow, 'salespersonName'>[] = [];
      groups.forEach((g, i) => {
        const c = counted[i]!;
        if (query.companyId && !c.lines.some((l) => l.companyId === query.companyId) && !c.progress.unplanned.some((u) => u.companyId === query.companyId)) return;
        rows.push({ salespersonUserId: g.salespersonUserId, planId: g.plans[0]?.id ?? null, plans: monthsOf(g, fiscal), ...rowOf(c.progress, query.companyId, period.start, now, timeZone) });
      });
      // Held visits credited to someone without a plan for this period still show (all unplanned).
      const visits = counted.length ? counted[0]!.meetings : await loadVisits(tx, [period], timeZone);
      const withPlan = new Set(groups.map((g) => g.salespersonUserId));
      const others = new Set<string>();
      for (const m of visits) {
        const who = creditedSalesperson(m);
        if (m.status !== 'held' || !who || withPlan.has(who)) continue;
        if (query.salespersonUserId && who !== query.salespersonUserId) continue;
        if (!scope.canSee(who)) continue;
        if (query.companyId && m.companyId !== query.companyId) continue;
        others.add(who);
      }
      for (const who of others) {
        const progress = countVisits({ salespersonUserId: who, periodStart: period.start, periodEnd: period.end, lines: [] }, visits, now, timeZone);
        if (progress.totals.unplanned) rows.push({ salespersonUserId: who, planId: null, plans: [], ...rowOf(progress, query.companyId, period.start, now, timeZone) });
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
   * plans of one salesperson, or of everyone the caller sees (`all=1`, the default): the whole
   * team for owners and admins, themselves and their reports for managers. A quarter adds up the
   * monthly plans of its three months (CD-212). Members (and a salesperson the caller may not see)
   * get their own.
   */
  summary(ctx: TenantContext, query: ProgressSummaryQuery, now = new Date()) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const scope = await this.plans.scope(ctx, tx);
      const { timeZone, fiscal } = await workspaceOf(tx, ctx.tenantId);
      const period = this.period(query.periodType, query.periodStart, fiscal, timeZone, now);
      const asked = query.all ? undefined : query.salespersonUserId;
      const salesperson = !scope.seesTeam ? ctx.userId : asked && !scope.canSee(asked) ? ctx.userId : asked;
      const all = (await planGroupsOf(tx, period, salesperson)).filter((g) => scope.canSee(g.salespersonUserId));
      const allCounted = await progressOfGroups(tx, all, timeZone, now);
      const keep = allCounted.map((c) => !query.companyId || c.lines.some((l) => l.companyId === query.companyId));
      const groups = all.filter((_, i) => keep[i]);
      const rows = allCounted.filter((_, i) => keep[i]).map((c) => rowOf(c.progress, query.companyId, period.start, now, timeZone));
      const names = await this.namesOf(
        tx,
        groups.map((g) => g.salespersonUserId),
      );
      return {
        periodType: query.periodType,
        periodStart: period.start,
        periodEnd: period.end,
        periodLabel: period.label,
        salespersonUserId: salesperson ?? null,
        ...sumRows(rows, periodShare(period.start, period.end, now, timeZone), period.start, now, timeZone),
        plans: groups.flatMap((g) => monthsOf(g, fiscal).map((p) => ({ ...p, salespersonUserId: g.salespersonUserId, salespersonName: names.get(g.salespersonUserId) ?? 'Former member' }))),
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
