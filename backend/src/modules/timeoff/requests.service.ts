import { type DecisionView, DecisionsService } from './decisions.service';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employees, type TimeoffRequestRow, type TimeoffRequestStatus, type TimeoffType, timeoffReasons, timeoffRequestDays, timeoffRequests, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { type ApproverResult, type CallerAccess, PeopleAccess } from '../people';
import { holidaysBetween, timesheetSettings } from '../timesheet';
import { assignPools, type Balance, type PoolAssignment } from './balance';
import { BalancesService } from './balances.service';
import { EntitlementsService } from './entitlements.service';
import { ReasonsService } from './reasons.service';
import { checkRequest, paidLeaveWarnings, type RequestRefusal, workingDaysBetween } from './request-rules';
import { readHistory, type TimeoffHistoryEntry } from './timeoff-history';
import { workspaceToday } from './today';
import type { CreateRequest, PreviewRequest, RequestsQuery } from './timeoff.schemas';

/** A request as the API answers it (spec 8.2, 8.5). */
export interface RequestView {
  id: string;
  employee: { id: string; fullName: string };
  type: TimeoffType;
  reason: { id: string; name: string } | null;
  startDate: string;
  endDate: string;
  workingDays: number;
  note: string | null;
  status: TimeoffRequestStatus;
  submittedBy: { userId: string; name: string } | null;
  submittedAt: Date;
  /** Recorded as approved by an Admin (spec 8.7). */
  recorded: boolean;
  recordReason: string | null;
  decidedBy: { userId: string; name: string } | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  /** Who decides (spec 9.1), while Pending. */
  approver: ApproverView | null;
  /** The request's days with their pool (vacation) and state. */
  days: { date: string; poolYear: number | null; state: string }[];
  /** Paid leave limits (spec 7.2): warnings, never blocks. */
  warnings: string[];
  canWithdraw: boolean;
  /** Approved and not started: the employee, the managers above and Admins (the API checks the approver rule). */
  canCancel: boolean;
  /** Approved, started and not over: the managers above and Admins. */
  canShorten: boolean;
  /** The vacation decision document (CD-167): the employee's own and Admins only (spec 15.1). */
  decision: DecisionView | null;
}

export interface ApproverView {
  kind: ApproverResult['kind'];
  reason: ApproverResult['reason'];
  approvers: { userId: string; employeeId: string | null; fullName: string }[];
  selfApproved: boolean;
}

/** What the form shows while picking dates (spec 8.4). */
export interface RequestPreview {
  workingDays: number;
  dates: string[];
  /** Holidays on weekdays inside the period. */
  excluded: { date: string; name: string }[];
  /** Why it can't be submitted, if so. */
  refusal: RequestRefusal | null;
  /** Vacation: the balance of the first day's year before and after, and the pools the days use. */
  balance: { before: Balance; after: Balance; pools: { poolYear: number; days: number }[] } | null;
  /** Vacation: more days than available (spec 8.3); the request can't be submitted. */
  shortfall: { needed: number; available: number } | null;
  warnings: string[];
  approver: ApproverView | null;
}

const OPEN: TimeoffRequestStatus[] = ['pending', 'approved'];

/** "vacation", "paid leave (Marriage)", "unpaid leave", "an absence (Maternity leave)". */
export const describeType = (type: TimeoffType, reason: string | null) => (type === 'vacation' ? 'vacation' : type === 'paid_leave' ? `paid leave (${reason ?? 'reason'})` : type === 'unpaid_leave' ? 'unpaid leave' : `an absence (${reason ?? 'reason'})`);

/**
 * Time off requests (CD-165, spec 8): submit (the employee, or an Admin for anyone, who may also
 * record leave as approved at once), preview, list, detail with history, withdraw. The checks of
 * 8.3 run in one transaction that locks the employee's requests, so two requests can't both use
 * the last days; the days are written to `timeoff_request_days` (the balance reads them) and
 * vacation days get their pool (`assignPools`). Approve, reject and cancel are CD-166.
 */
@Injectable()
export class RequestsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly access: PeopleAccess,
    private readonly balances: BalancesService,
    private readonly entitlements: EntitlementsService,
    private readonly reasons: ReasonsService,
    private readonly decisions: DecisionsService,
  ) {}

  // ------------------------------------------------------------------ reads

  /** Own requests by default; a report's for their managers; anyone's for Admins; `all` lists everyone the caller may see. */
  list(ctx: TenantContext, query: RequestsQuery): Promise<RequestView[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      let scope: string[] | null;
      if (query.all) {
        if (access.isAdmin) scope = null;
        else if (access.isManager) scope = [...access.reportIds, ...(access.employeeId ? [access.employeeId] : [])];
        else throw new ForbiddenException('Only managers and Admins see the requests of others');
      } else {
        const id = query.employeeId ?? access.employeeId;
        if (!id) return [];
        if (!access.canSeeEmployment(id)) throw new ForbiddenException('Only the employee, their managers and Admins see their requests');
        scope = [id];
      }
      const rows = await tx
        .select()
        .from(timeoffRequests)
        .where(
          and(
            scope ? inArray(timeoffRequests.employeeId, scope) : undefined,
            query.year ? and(lte(timeoffRequests.startDate, `${query.year}-12-31`), gte(timeoffRequests.endDate, `${query.year}-01-01`)) : undefined,
            query.status ? eq(timeoffRequests.status, query.status) : undefined,
            query.type ? eq(timeoffRequests.type, query.type) : undefined,
          ),
        )
        .orderBy(desc(timeoffRequests.startDate), desc(timeoffRequests.submittedAt));
      return this.views(tx, ctx, access, rows);
    });
  }

  get(ctx: TenantContext, id: string): Promise<RequestView & { history: TimeoffHistoryEntry[] }> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const [row] = await tx.select().from(timeoffRequests).where(eq(timeoffRequests.id, id));
      if (!row || !access.canSeeEmployment(row.employeeId)) throw new NotFoundException('Request not found');
      const [view] = await this.views(tx, ctx, access, [row]);
      const history = await readHistory(tx, [{ entityType: 'timeoff_request', ids: [id] }], { limit: 100, offset: 0 });
      return { ...view!, history: history.entries };
    });
  }

  // ------------------------------------------------------------------ preview and submit

  preview(ctx: TenantContext, input: PreviewRequest): Promise<RequestPreview> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const employeeId = await this.target(access, input.employeeId);
      const facts = await this.facts(tx, ctx, employeeId, input, access.isAdmin);
      return facts.preview;
    });
  }

  /** Submit (spec 8.3, 8.7). Answers the request. */
  create(ctx: TenantContext, input: CreateRequest): Promise<RequestView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        const employeeId = await this.target(access, input.employeeId);
        if (input.type === 'other_absence' && !access.isAdmin) throw new ForbiddenException('Only Admins record an other absence');
        if (input.record && !access.isAdmin) throw new ForbiddenException('Only Admins record time off as approved');
        // One writer per employee: the balance check and the insert can't interleave (spec 8.3).
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employeeId}))`);
        const facts = await this.facts(tx, ctx, employeeId, input, access.isAdmin);
        const p = facts.preview;
        if (facts.overlap) throw new ConflictException(`These dates overlap ${facts.overlap.status === 'pending' ? 'a pending' : 'an approved'} ${facts.overlap.type.replace('_', ' ')} request from ${facts.overlap.startDate} to ${facts.overlap.endDate}`);
        if (p.refusal) throw new BadRequestException(p.refusal.message);
        if (facts.shortfall) throw new ConflictException(`You have ${facts.shortfall.available} ${facts.shortfall.available === 1 ? 'day' : 'days'} available; this request needs ${facts.shortfall.needed}.`);
        const recorded = !!input.record;
        const [row] = await tx
          .insert(timeoffRequests)
          .values({
            tenantId: ctx.tenantId,
            employeeId,
            type: input.type,
            reasonId: facts.reason?.id ?? null,
            startDate: input.startDate,
            endDate: input.endDate,
            workingDays: p.workingDays,
            note: input.note ?? null,
            status: recorded ? 'approved' : 'pending',
            submittedByUserId: ctx.userId,
            recorded,
            recordReason: input.record?.reason ?? null,
            ...(recorded ? { decidedByUserId: ctx.userId, decidedAt: new Date() } : {}),
          })
          .returning();
        const poolOf = new Map((facts.assignment ?? []).map((a) => [a.date, a.poolYear]));
        if (p.dates.length) await tx.insert(timeoffRequestDays).values(p.dates.map((date) => ({ tenantId: ctx.tenantId, requestId: row!.id, employeeId, date, poolYear: poolOf.get(date) ?? null, state: 'counted' as const })));
        await this.audit.record(tx, ctx, { action: recorded ? 'timeoff.request_recorded' : 'timeoff.request_submitted', entityType: 'timeoff_request', entityId: row!.id, data: { employeeId, type: input.type, startDate: input.startDate, endDate: input.endDate, workingDays: p.workingDays, recordReason: input.record?.reason } });
        // Recorded vacation gets its decision like an approved one (spec 11.1, "Generate decision").
        if (recorded && input.type === 'vacation' && input.record?.decision !== false) await this.decisions.queueFor(tx, ctx, row!);
        if (!recorded && p.approver) {
          for (const a of p.approver.approvers) {
            if (a.userId === ctx.userId) continue;
            await this.jobs.send('timeoff.notice-email', { tenantId: ctx.tenantId, kind: 'requested', requestId: row!.id, recipientUserId: a.userId }, tx);
          }
        }
        const [view] = await this.views(tx, ctx, access, [row!]);
        return view!;
      })
      .catch(mapDbError);
  }

  /** A pending request is withdrawn by the employee or an Admin (spec 9.4); its days stop counting. */
  withdraw(ctx: TenantContext, id: string): Promise<RequestView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const [row] = await tx.select().from(timeoffRequests).where(eq(timeoffRequests.id, id));
      if (!row || !access.canSeeEmployment(row.employeeId)) throw new NotFoundException('Request not found');
      if (!access.isAdmin && !access.isSelf(row.employeeId)) throw new ForbiddenException('Only the employee and Admins withdraw a request');
      if (row.status !== 'pending') throw new ConflictException(`A ${row.status} request can't be withdrawn`);
      const [updated] = await tx.update(timeoffRequests).set({ status: 'withdrawn' }).where(eq(timeoffRequests.id, id)).returning();
      await tx.update(timeoffRequestDays).set({ state: 'cancelled' }).where(and(eq(timeoffRequestDays.requestId, id), eq(timeoffRequestDays.state, 'counted')));
      await this.audit.record(tx, ctx, { action: 'timeoff.request_withdrawn', entityType: 'timeoff_request', entityId: id, data: { employeeId: row.employeeId } });
      // The approvers hear about it only if they were told over an hour ago (spec 9.4).
      if (Date.now() - row.submittedAt.getTime() > 3_600_000) {
        const approver = await this.approver(tx, ctx.tenantId, row.employeeId, row.startDate);
        const [employee] = await tx.select({ fullName: employees.fullName }).from(employees).where(eq(employees.id, row.employeeId));
        const reason = row.reasonId ? (await tx.select({ name: timeoffReasons.name }).from(timeoffReasons).where(eq(timeoffReasons.id, row.reasonId)))[0]?.name : null;
        for (const a of approver?.approvers ?? []) {
          if (a.userId === ctx.userId) continue;
          await this.jobs.send('timeoff.notice-email', { tenantId: ctx.tenantId, kind: 'withdrawn', requestId: id, recipientUserId: a.userId, employeeName: employee?.fullName ?? 'An employee', what: describeType(row.type, reason ?? null), startDate: row.startDate, endDate: row.endDate }, tx);
        }
      }
      const [view] = await this.views(tx, ctx, access, [updated!]);
      return view!;
    });
  }

  // ------------------------------------------------------------------ building blocks

  /** Whose request: the caller's own, or anyone's for an Admin. */
  private async target(access: CallerAccess, employeeId: string | undefined): Promise<string> {
    if (employeeId && employeeId !== access.employeeId) {
      if (!access.isAdmin) throw new ForbiddenException('Only Admins request time off for someone else');
      return employeeId;
    }
    if (!access.employeeId) throw new ForbiddenException('You have no employee record in this workspace');
    return access.employeeId;
  }

  /** Everything the preview and the submit need: the working days, the checks, the overlap, the pools, the warnings and the approver. */
  private async facts(tx: Tx, ctx: TenantContext, employeeId: string, input: PreviewRequest, byAdmin: boolean) {
    const [e] = await tx.select({ id: employees.id, startDate: employees.employmentStartDate, deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, employeeId));
    if (!e) throw new NotFoundException('Employee not found');
    if (e.deactivatedAt) throw new ConflictException('This employee is inactive');
    const reason = input.type === 'paid_leave' || input.type === 'other_absence' ? await this.reason(tx, input) : null;
    const today = await workspaceToday(tx, ctx.tenantId);
    const settings = await timesheetSettings(tx, ctx.tenantId);
    const holidays = await holidaysBetween(tx, input.startDate, input.endDate);
    const wd = workingDaysBetween(input.startDate, input.endDate, { workingWeekdays: settings.workingDays, holidays });
    const refusal = checkRequest({ type: input.type, startDate: input.startDate, endDate: input.endDate, today, byAdmin, employmentStart: e.startDate, workingDays: wd.dates.length });
    const [overlap] = await tx
      .select({ id: timeoffRequests.id, type: timeoffRequests.type, status: timeoffRequests.status, startDate: timeoffRequests.startDate, endDate: timeoffRequests.endDate })
      .from(timeoffRequests)
      .where(and(eq(timeoffRequests.employeeId, employeeId), inArray(timeoffRequests.status, OPEN), lte(timeoffRequests.startDate, input.endDate), gte(timeoffRequests.endDate, input.startDate)))
      .limit(1);
    let balance: RequestPreview['balance'] = null;
    let assignment: PoolAssignment[] | null = null;
    let shortfall: { needed: number; available: number } | null = null;
    if (input.type === 'vacation' && wd.dates.length) {
      const years = [...new Set(wd.dates.map((d) => Number(d.slice(0, 4))))];
      const ctxYears = [...new Set(years.flatMap((y) => [y - 1, y]))];
      // The pools need their entitlement rows (made on reads and by the daily job; a first request
      // for next year may come before either). Made as the system's, not the requester's.
      await tx.execute(sql`select set_config('app.user_id', '', true)`);
      await this.entitlements.ensureEmployees(tx, ctx.tenantId, [employeeId], ctxYears.filter((y) => y >= Number(today.slice(0, 4)) - 1 && y <= Number(today.slice(0, 4)) + 1));
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      const pc = await this.balances.poolContext(tx, ctx.tenantId, employeeId, ctxYears);
      if (pc) {
        const first = years[0]!;
        const before = pc.balance(first);
        const result = assignPools(wd.dates, { today: pc.today, policy: pc.policy, pools: pc.pools, days: pc.days });
        if (result.ok) {
          assignment = result.days;
          const pools = new Map<number, number>();
          for (const a of result.days) pools.set(a.poolYear, (pools.get(a.poolYear) ?? 0) + 1);
          const after = { ...before, pending: before.pending + result.days.filter((d) => Number(d.date.slice(0, 4)) === first).length };
          after.available = after.remaining - after.pending;
          balance = { before, after, pools: [...pools].map(([poolYear, days]) => ({ poolYear, days })).sort((a, b) => a.poolYear - b.poolYear) };
        } else {
          shortfall = { needed: result.needed, available: result.available };
          balance = { before, after: before, pools: [] };
        }
      }
    }
    const warnings: string[] = [];
    if (input.type === 'paid_leave' && reason) {
      const year = Number(input.startDate.slice(0, 4));
      const limit = await this.reasons.settingsIn(tx, ctx.tenantId);
      const used = reason.countsTowardLimit ? await this.paidLeaveUsed(tx, employeeId, year) : 0;
      warnings.push(...paidLeaveWarnings({ maxDays: reason.maxDays, countsTowardLimit: reason.countsTowardLimit, yearlyLimit: limit.paidLeaveYearlyLimit, days: wd.dates.length, usedTowardLimit: used }));
    }
    const approver = await this.approver(tx, ctx.tenantId, employeeId, input.startDate);
    const preview: RequestPreview = {
      workingDays: wd.dates.length,
      dates: wd.dates,
      excluded: wd.excluded,
      refusal: refusal ?? (overlap ? { code: 'no_working_days', message: `These dates overlap a ${overlap.status} request (${overlap.startDate} to ${overlap.endDate})` } : null),
      balance,
      shortfall,
      warnings,
      approver,
    };
    return { preview, reason, overlap: overlap ?? null, assignment, shortfall };
  }

  private async reason(tx: Tx, input: PreviewRequest) {
    if (!input.reasonId) throw new BadRequestException('Pick a reason');
    const [r] = await tx.select().from(timeoffReasons).where(and(eq(timeoffReasons.id, input.reasonId), eq(timeoffReasons.kind, input.type === 'paid_leave' ? 'paid_leave' : 'other_absence')));
    if (!r) throw new BadRequestException('The reason was not found for this type');
    if (!r.active) throw new BadRequestException('This reason is no longer in use');
    return r;
  }

  /** Counted paid leave days of the year for reasons that count toward the group limit (pending and approved). */
  private async paidLeaveUsed(tx: Tx, employeeId: string, year: number): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(timeoffRequestDays)
      .innerJoin(timeoffRequests, eq(timeoffRequests.id, timeoffRequestDays.requestId))
      .innerJoin(timeoffReasons, eq(timeoffReasons.id, timeoffRequests.reasonId))
      .where(and(eq(timeoffRequestDays.employeeId, employeeId), eq(timeoffRequestDays.state, 'counted'), eq(timeoffRequests.type, 'paid_leave'), inArray(timeoffRequests.status, OPEN), eq(timeoffReasons.countsTowardLimit, true), gte(timeoffRequestDays.date, `${year}-01-01`), lte(timeoffRequestDays.date, `${year}-12-31`)));
    return row?.n ?? 0;
  }

  async approver(tx: Tx, tenantId: string, employeeId: string, date: string): Promise<ApproverView | null> {
    const result = await this.access.approversFor(tenantId, employeeId, date, tx);
    if (!result) return null;
    const ids = result.approvers.map((a) => a.userId);
    const names = new Map<string, string>();
    if (ids.length) for (const u of await tx.select({ id: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')` }).from(users).where(inArray(users.id, ids))) names.set(u.id, u.name);
    return { kind: result.kind, reason: result.reason, approvers: result.approvers.map((a) => ({ ...a, fullName: names.get(a.userId) ?? 'Member' })), selfApproved: result.selfApproved };
  }

  async views(tx: Tx, ctx: TenantContext, access: CallerAccess, rows: TimeoffRequestRow[]): Promise<RequestView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const days = await tx.select().from(timeoffRequestDays).where(inArray(timeoffRequestDays.requestId, ids)).orderBy(asc(timeoffRequestDays.date));
    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const people = new Map((await tx.select({ id: employees.id, fullName: employees.fullName }).from(employees).where(inArray(employees.id, employeeIds))).map((e) => [e.id, e.fullName]));
    const reasonIds = [...new Set(rows.map((r) => r.reasonId).filter((x): x is string => !!x))];
    const reasons = new Map(reasonIds.length ? (await tx.select({ id: timeoffReasons.id, name: timeoffReasons.name, maxDays: timeoffReasons.maxDays, countsTowardLimit: timeoffReasons.countsTowardLimit }).from(timeoffReasons).where(inArray(timeoffReasons.id, reasonIds))).map((r) => [r.id, r]) : []);
    const userIds = [...new Set(rows.flatMap((r) => [r.submittedByUserId, r.decidedByUserId]).filter((x): x is string => !!x))];
    const names = new Map(userIds.length ? (await tx.select({ id: users.id, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'Member')` }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.name]) : []);
    const limit = rows.some((r) => r.type === 'paid_leave') ? await this.reasons.settingsIn(tx, ctx.tenantId) : null;
    const today = await workspaceToday(tx, ctx.tenantId);
    const decisions = await this.decisions.viewsFor(tx, rows.filter((r) => access.isAdmin || access.isSelf(r.employeeId)).map((r) => r.id));
    const out: RequestView[] = [];
    for (const r of rows) {
      const reason = r.reasonId ? reasons.get(r.reasonId) : undefined;
      const warnings: string[] = [];
      if (r.type === 'paid_leave' && reason && limit && OPEN.includes(r.status)) {
        const year = Number(r.startDate.slice(0, 4));
        const mine = days.filter((d) => d.requestId === r.id && d.state === 'counted').length;
        const used = reason.countsTowardLimit ? (await this.paidLeaveUsed(tx, r.employeeId, year)) - mine : 0;
        warnings.push(...paidLeaveWarnings({ maxDays: reason.maxDays, countsTowardLimit: reason.countsTowardLimit, yearlyLimit: limit.paidLeaveYearlyLimit, days: mine, usedTowardLimit: Math.max(0, used) }));
      }
      // The same rule as the decisions (ApprovalsService): the resolved approver, or an Admin.
      const approver = r.status === 'pending' || r.status === 'approved' ? await this.approver(tx, ctx.tenantId, r.employeeId, today) : null;
      const decides = access.isAdmin || !!approver?.approvers.some((a) => a.userId === ctx.userId);
      out.push({
        id: r.id,
        employee: { id: r.employeeId, fullName: people.get(r.employeeId) ?? 'Employee' },
        type: r.type,
        reason: reason ? { id: reason.id, name: reason.name } : null,
        startDate: r.startDate,
        endDate: r.endDate,
        workingDays: r.workingDays,
        note: r.note,
        status: r.status,
        submittedBy: r.submittedByUserId ? { userId: r.submittedByUserId, name: names.get(r.submittedByUserId) ?? 'Former member' } : null,
        submittedAt: r.submittedAt,
        recorded: r.recorded,
        recordReason: r.recordReason,
        decidedBy: r.decidedByUserId ? { userId: r.decidedByUserId, name: names.get(r.decidedByUserId) ?? 'Former member' } : null,
        decidedAt: r.decidedAt,
        decisionComment: r.decisionComment,
        // Resolved now (spec 9.1): an absent manager hands over while away.
        approver: r.status === 'pending' ? approver : null,
        days: days.filter((d) => d.requestId === r.id).map((d) => ({ date: d.date, poolYear: d.poolYear, state: d.state })),
        warnings,
        canWithdraw: r.status === 'pending' && (access.isAdmin || access.isSelf(r.employeeId)),
        canCancel: r.status === 'approved' && r.startDate > today && (access.isSelf(r.employeeId) || decides),
        canShorten: r.status === 'approved' && r.startDate <= today && r.endDate >= today && decides,
        decision: decisions.get(r.id) ?? null,
      });
    }
    return out;
  }
}

