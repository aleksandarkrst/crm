import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employees, invitations, orgUnits, timeoffNotices, timeoffReasons, type TimeoffRequestRow, timeoffRequestDays, timeoffRequests, type TimeoffType, vacationEntitlements } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { type CallerAccess, PeopleAccess } from '../people';
import { holidaysBetween } from '../timesheet';
import { assignPools } from './balance';
import { BalancesService } from './balances.service';
import { DecisionsService } from './decisions.service';
import { SickLeaveService } from './sick-leave.service';
import { addDays } from './request-rules';
import { type ApproverView, describeType, RequestsService, type RequestView } from './requests.service';
import { workspaceToday } from './today';
import type { CalendarQuery } from './timeoff.schemas';

/** One row of the Approvals tab (spec 9.2). */
export interface ApprovalRow extends RequestView {
  /** Vacation: days left after approval. */
  balanceAfter: number | null;
  /** Colleagues away on any of the days: the requester's unit, and the approver's direct reports. */
  alsoAway: { employeeId: string; fullName: string; what: string; startDate: string; endDate: string; status: 'approved' | 'pending' }[];
  startDatePassed: boolean;
  /** A short vacation late in the year while the two-week part was not taken (A5). */
  twoWeekPartMissing: boolean;
}

/** The team calendar (spec 9.5): one month, employees as rows. */
export interface CalendarView {
  month: string;
  from: string;
  to: string;
  employees: { id: string; fullName: string; unitName: string | null }[];
  /** Time off by type; sick leave as `sick_leave` without its type (spec 13.5), `requestId` then the record's id. */
  cells: { employeeId: string; date: string; type: TimeoffType | 'sick_leave'; status: 'approved' | 'pending'; requestId: string }[];
  holidays: { date: string; name: string }[];
}

const shownAndActive = and(isNull(employees.deactivatedAt), sql`(${employees.userId} is not null or exists (select 1 from ${invitations} i where i.employee_id = ${employees.id} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()))`);
const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
/** Weekdays strictly between two dates, for the reminder's "two working days" and "within three". */
function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5) n++;
  return n;
}

/**
 * Decisions on time off requests (CD-166, spec 9): approve (with the balance re-checked and the
 * pools assigned for good, freezing the year's entitlement), reject (a comment), cancel approved
 * leave before it starts (the employee, or the approver and Admins with a comment) and shorten
 * leave that started (approvers and Admins, a comment); the Approvals list with what an approver
 * needs to decide, its count for the badge, the team calendar, and the daily reminders. Who
 * decides is the approver rule (spec 9.1), resolved on every read.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly access: PeopleAccess,
    private readonly requests: RequestsService,
    private readonly balances: BalancesService,
    private readonly decisions: DecisionsService,
    private readonly sick: SickLeaveService,
  ) {}

  // ------------------------------------------------------------------ decisions

  approve(ctx: TenantContext, id: string, comment: string | null): Promise<RequestView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        const row = await this.pending(tx, access, id);
        await this.requireApprover(tx, ctx, row);
        return this.approveIn(tx, ctx, access, row, comment);
      })
      .catch(mapDbError);
  }

  /** "Approve selected" (spec 9.2): each in its own transaction, the ones that fail are named. */
  async approveMany(ctx: TenantContext, ids: string[], comment: string | null): Promise<{ approved: string[]; failed: { id: string; message: string }[] }> {
    const approved: string[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const id of ids) {
      try {
        await this.approve(ctx, id, comment);
        approved.push(id);
      } catch (err) {
        failed.push({ id, message: err instanceof HttpException ? err.message : 'Something went wrong' });
      }
    }
    return { approved, failed };
  }

  private async approveIn(tx: Tx, ctx: TenantContext, access: CallerAccess, row: TimeoffRequestRow, comment: string | null): Promise<RequestView> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${row.employeeId}))`);
    const days = await tx.select().from(timeoffRequestDays).where(and(eq(timeoffRequestDays.requestId, row.id), eq(timeoffRequestDays.state, 'counted'))).orderBy(asc(timeoffRequestDays.date));
    if (row.type === 'vacation' && days.length) {
      // The balance is checked again (spec 9.3): an adjustment meanwhile may have taken the days.
      const years = [...new Set(days.map((d) => Number(d.date.slice(0, 4))))];
      const pc = await this.balances.poolContext(tx, ctx.tenantId, row.employeeId, [...new Set(years.flatMap((y) => [y - 1, y]))]);
      if (!pc) throw new NotFoundException('Employee not found');
      const others = pc.days.filter((d) => d.requestId !== row.id);
      const result = assignPools(
        days.map((d) => d.date),
        { today: pc.today, policy: pc.policy, pools: pc.pools, days: others },
      );
      if (!result.ok) throw new ConflictException(`The days no longer fit the balance: ${result.available} available, ${result.needed} needed. Reject it or adjust the balance first.`);
      for (const a of result.days) await tx.update(timeoffRequestDays).set({ poolYear: a.poolYear }).where(and(eq(timeoffRequestDays.requestId, row.id), eq(timeoffRequestDays.date, a.date)));
      const pools = [...new Set(result.days.map((a) => a.poolYear))];
      // The year's entitlement is frozen from the first approved day (spec 5.4).
      await tx.update(vacationEntitlements).set({ frozen: true }).where(and(eq(vacationEntitlements.employeeId, row.employeeId), inArray(vacationEntitlements.year, pools), eq(vacationEntitlements.frozen, false)));
    }
    const [updated] = await tx.update(timeoffRequests).set({ status: 'approved', decidedByUserId: ctx.userId, decidedAt: new Date(), decisionComment: comment }).where(eq(timeoffRequests.id, row.id)).returning();
    await this.audit.record(tx, ctx, { action: 'timeoff.request_approved', entityType: 'timeoff_request', entityId: row.id, data: { employeeId: row.employeeId, workingDays: days.length, comment } });
    await this.jobs.send('timeoff.notice-email', { tenantId: ctx.tenantId, kind: 'decided', requestId: row.id }, tx);
    // The vacation decision (CD-167, spec 11.1): queued in the same transaction, generated by the worker.
    if (row.type === 'vacation') await this.decisions.queueFor(tx, ctx, updated!);
    const [view] = await this.requests.views(tx, ctx, access, [updated!]);
    return view!;
  }

  reject(ctx: TenantContext, id: string, comment: string): Promise<RequestView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const row = await this.pending(tx, access, id);
      await this.requireApprover(tx, ctx, row);
      const [updated] = await tx.update(timeoffRequests).set({ status: 'rejected', decidedByUserId: ctx.userId, decidedAt: new Date(), decisionComment: comment }).where(eq(timeoffRequests.id, id)).returning();
      await tx.update(timeoffRequestDays).set({ state: 'cancelled' }).where(and(eq(timeoffRequestDays.requestId, id), eq(timeoffRequestDays.state, 'counted')));
      await this.audit.record(tx, ctx, { action: 'timeoff.request_rejected', entityType: 'timeoff_request', entityId: id, data: { employeeId: row.employeeId, comment } });
      await this.jobs.send('timeoff.notice-email', { tenantId: ctx.tenantId, kind: 'decided', requestId: id }, tx);
      const [view] = await this.requests.views(tx, ctx, access, [updated!]);
      return view!;
    });
  }

  /**
   * Cancel approved leave before it starts (spec 9.4): the employee, or the approver and Admins
   * with a comment. Days already taken stay used: leave that started is shortened instead.
   */
  cancel(ctx: TenantContext, id: string, comment: string | null): Promise<RequestView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const row = await this.approved(tx, access, id);
      const today = await workspaceToday(tx, ctx.tenantId);
      if (row.startDate <= today) throw new ConflictException(row.endDate < today ? 'This leave is over; days already taken stay used.' : 'This leave has started. Shorten it instead of cancelling it.');
      const self = access.isSelf(row.employeeId);
      if (!self) {
        if (!access.isAdmin && !(await this.isApprover(tx, ctx, row))) throw new ForbiddenException('Only the employee, their approver and Admins cancel approved leave');
        if (!comment) throw new BadRequestException('A comment is needed when cancelling someone else\'s leave');
      }
      const returned = (await tx.update(timeoffRequestDays).set({ state: 'cancelled' }).where(and(eq(timeoffRequestDays.requestId, id), eq(timeoffRequestDays.state, 'counted'))).returning({ id: timeoffRequestDays.id })).length;
      const [updated] = await tx.update(timeoffRequests).set({ status: 'cancelled', decidedByUserId: ctx.userId, decidedAt: new Date(), decisionComment: comment }).where(eq(timeoffRequests.id, id)).returning();
      await this.audit.record(tx, ctx, { action: 'timeoff.request_cancelled', entityType: 'timeoff_request', entityId: id, data: { employeeId: row.employeeId, returned, comment, self } });
      await this.notifyChanged(tx, ctx, row, 'cancelled');
      await this.decisions.sourceChanged(tx, id, 'cancelled');
      const [view] = await this.requests.views(tx, ctx, access, [updated!]);
      return view!;
    });
  }

  /** Shorten leave that started (spec 9.4): approvers and Admins, a comment; the days after the new end go back. */
  shorten(ctx: TenantContext, id: string, endDate: string, comment: string): Promise<RequestView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const row = await this.approved(tx, access, id);
      if (!access.isAdmin && !(await this.isApprover(tx, ctx, row))) throw new ForbiddenException('Only the approver and Admins shorten approved leave');
      const today = await workspaceToday(tx, ctx.tenantId);
      if (row.endDate < today) throw new ConflictException('This leave is over; days already taken stay used.');
      if (endDate >= row.endDate) throw new BadRequestException('The new last day must be before the current one');
      const floor = row.startDate > today ? row.startDate : today;
      if (endDate < floor) throw new BadRequestException(`The new last day can't be before ${floor === today ? 'today' : 'the first day'}`);
      const returned = (
        await tx
          .update(timeoffRequestDays)
          .set({ state: 'returned' })
          .where(and(eq(timeoffRequestDays.requestId, id), eq(timeoffRequestDays.state, 'counted'), sql`${timeoffRequestDays.date} > ${endDate}`))
          .returning({ id: timeoffRequestDays.id })
      ).length;
      const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(timeoffRequestDays).where(and(eq(timeoffRequestDays.requestId, id), eq(timeoffRequestDays.state, 'counted')));
      const [updated] = await tx.update(timeoffRequests).set({ endDate, workingDays: count?.n ?? 0, decisionComment: comment }).where(eq(timeoffRequests.id, id)).returning();
      await this.audit.record(tx, ctx, { action: 'timeoff.request_shortened', entityType: 'timeoff_request', entityId: id, data: { employeeId: row.employeeId, endDate, returned, comment } });
      await this.notifyChanged(tx, ctx, row, 'shortened');
      await this.decisions.sourceChanged(tx, id, 'outdated');
      const [view] = await this.requests.views(tx, ctx, access, [updated!]);
      return view!;
    });
  }

  // ------------------------------------------------------------------ the Approvals tab and the calendar

  /** The pending requests the caller decides (spec 9.2), first day first. */
  list(ctx: TenantContext): Promise<ApprovalRow[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const mine = await this.pendingFor(tx, ctx, access);
      if (!mine.length) return [];
      const today = await workspaceToday(tx, ctx.tenantId);
      const views = await this.requests.views(tx, ctx, access, mine.map((m) => m.row));
      const out: ApprovalRow[] = [];
      for (const { row } of mine) {
        const view = views.find((v) => v.id === row.id)!;
        let balanceAfter: number | null = null;
        let twoWeekPartMissing = false;
        if (row.type === 'vacation') {
          const year = Number(row.startDate.slice(0, 4));
          const pc = await this.balances.poolContext(tx, ctx.tenantId, row.employeeId, [year - 1, year]);
          if (pc) {
            const b = pc.balance(year);
            balanceAfter = b.remaining - row.workingDays;
            twoWeekPartMissing = row.workingDays < 10 && row.startDate.slice(5, 7) >= '10' && !b.twoWeekPart;
          }
        }
        out.push({ ...view, balanceAfter, alsoAway: await this.alsoAway(tx, access, row), startDatePassed: row.startDate < today, twoWeekPartMissing });
      }
      return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
    });
  }

  /** The badge: how many pending requests wait for the caller. */
  async count(ctx: TenantContext): Promise<{ pending: number }> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      if (!access.isAdmin && !access.isManager) return { pending: 0 };
      return { pending: (await this.pendingFor(tx, ctx, access)).length };
    });
  }

  /** The team calendar (spec 9.5): managers their reports, Admins everyone (with filters), employees themselves. */
  calendar(ctx: TenantContext, query: CalendarQuery): Promise<CalendarView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const from = `${query.month}-01`;
      const to = new Date(Date.UTC(Number(query.month.slice(0, 4)), Number(query.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const scope = access.isAdmin ? null : access.isManager ? [...access.reportIds, ...(access.employeeId ? [access.employeeId] : [])] : access.employeeId ? [access.employeeId] : [];
      if (scope && !scope.length) return { month: query.month, from, to, employees: [], cells: [], holidays: [] };
      const people = await tx
        .select({ id: employees.id, fullName: employees.fullName, unitName: orgUnits.name, unitId: employees.unitId, managerId: employees.managerId })
        .from(employees)
        .leftJoin(orgUnits, eq(orgUnits.id, employees.unitId))
        .where(and(shownAndActive, scope ? inArray(employees.id, scope) : undefined, query.unitId ? eq(employees.unitId, query.unitId) : undefined, query.managerId ? eq(employees.managerId, query.managerId) : undefined))
        .orderBy(asc(employees.lastName), asc(employees.firstName));
      const ids = people.map((p) => p.id);
      const cells = ids.length
        ? await tx
            .select({ employeeId: timeoffRequestDays.employeeId, date: timeoffRequestDays.date, type: timeoffRequests.type, status: timeoffRequests.status, requestId: timeoffRequestDays.requestId })
            .from(timeoffRequestDays)
            .innerJoin(timeoffRequests, eq(timeoffRequests.id, timeoffRequestDays.requestId))
            .where(and(inArray(timeoffRequestDays.employeeId, ids), eq(timeoffRequestDays.state, 'counted'), inArray(timeoffRequests.status, ['pending', 'approved']), gte(timeoffRequestDays.date, from), lte(timeoffRequestDays.date, to)))
        : [];
      const holidays = [...(await holidaysBetween(tx, from, to)).values()].map((h) => ({ date: h.date, name: h.name }));
      const sick = await this.sick.daysIn(tx, ctx.tenantId, ids, from, to);
      return {
        month: query.month,
        from,
        to,
        employees: people.map((p) => ({ id: p.id, fullName: p.fullName, unitName: p.unitName })),
        cells: [
          ...cells.map((c) => ({ employeeId: c.employeeId, date: c.date, type: c.type, status: c.status === 'approved' ? ('approved' as const) : ('pending' as const), requestId: c.requestId })),
          ...sick.map((s) => ({ employeeId: s.employeeId, date: s.date, type: 'sick_leave' as const, status: s.status === 'confirmed' ? ('approved' as const) : ('pending' as const), requestId: s.sickLeaveId })),
        ],
        holidays,
      };
    });
  }

  // ------------------------------------------------------------------ the daily job (spec 15.2)

  /** "Request waiting": pending for two working days or starting within three; one summary per approver per day. */
  queueApprovalReminders(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const today = await workspaceToday(tx, tenantId, now);
      const rows = await tx.select().from(timeoffRequests).where(eq(timeoffRequests.status, 'pending'));
      const byApprover = new Map<string, { employeeId: string; requestIds: string[] }>();
      for (const row of rows) {
        const waiting = weekdaysBetween(row.submittedAt.toISOString().slice(0, 10), today) >= 2 || (row.startDate >= today && weekdaysBetween(today, row.startDate) <= 3);
        if (!waiting) continue;
        const approver = await this.requests.approver(tx, tenantId, row.employeeId, today);
        for (const a of approver?.approvers ?? []) {
          if (!a.employeeId) continue;
          const entry = byApprover.get(a.userId) ?? { employeeId: a.employeeId, requestIds: [] };
          entry.requestIds.push(row.id);
          byApprover.set(a.userId, entry);
        }
      }
      let queued = 0;
      for (const [userId, entry] of byApprover) {
        const claimed = await tx.insert(timeoffNotices).values({ tenantId, kind: 'approval_reminder', employeeId: entry.employeeId, period: today }).onConflictDoNothing().returning({ employeeId: timeoffNotices.employeeId });
        if (!claimed.length) continue;
        await this.jobs.send('timeoff.notice-email', { tenantId, kind: 'approval_reminder', recipientUserId: userId, requestIds: entry.requestIds }, tx);
        queued++;
      }
      return queued;
    });
  }

  /** "Manager absent, requests waiting": to each Admin, once a day, for the pending requests whose manager is away. */
  queueManagerAbsentNotices(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const today = await workspaceToday(tx, tenantId, now);
      const rows = await tx.select().from(timeoffRequests).where(eq(timeoffRequests.status, 'pending'));
      const byAdmin = new Map<string, { employeeId: string; requestIds: string[] }>();
      for (const row of rows) {
        const approver = await this.requests.approver(tx, tenantId, row.employeeId, today);
        if (approver?.reason !== 'manager_absent') continue;
        for (const a of approver.approvers) {
          if (!a.employeeId) continue;
          const entry = byAdmin.get(a.userId) ?? { employeeId: a.employeeId, requestIds: [] };
          entry.requestIds.push(row.id);
          byAdmin.set(a.userId, entry);
        }
      }
      let queued = 0;
      for (const [userId, entry] of byAdmin) {
        const claimed = await tx.insert(timeoffNotices).values({ tenantId, kind: 'manager_absent', employeeId: entry.employeeId, period: today }).onConflictDoNothing().returning({ employeeId: timeoffNotices.employeeId });
        if (!claimed.length) continue;
        await this.jobs.send('timeoff.notice-email', { tenantId, kind: 'manager_absent', recipientUserId: userId, requestIds: entry.requestIds }, tx);
        queued++;
      }
      return queued;
    });
  }

  // ------------------------------------------------------------------ building blocks

  private async pending(tx: Tx, access: CallerAccess, id: string): Promise<TimeoffRequestRow> {
    const [row] = await tx.select().from(timeoffRequests).where(eq(timeoffRequests.id, id));
    if (!row || !access.canSeeEmployment(row.employeeId)) throw new NotFoundException('Request not found');
    if (row.status !== 'pending') throw new ConflictException(`This request is ${row.status}, not pending`);
    return row;
  }

  private async approved(tx: Tx, access: CallerAccess, id: string): Promise<TimeoffRequestRow> {
    const [row] = await tx.select().from(timeoffRequests).where(eq(timeoffRequests.id, id));
    if (!row || !access.canSeeEmployment(row.employeeId)) throw new NotFoundException('Request not found');
    if (row.status !== 'approved') throw new ConflictException(`This request is ${row.status}, not approved`);
    return row;
  }

  private async isApprover(tx: Tx, ctx: TenantContext, row: TimeoffRequestRow): Promise<boolean> {
    const approver = await this.requests.approver(tx, ctx.tenantId, row.employeeId, await workspaceToday(tx, ctx.tenantId));
    return !!approver?.approvers.some((a) => a.userId === ctx.userId);
  }

  /** Nobody approves their own request (spec 9.1), except the single Admin the rule names. */
  private async requireApprover(tx: Tx, ctx: TenantContext, row: TimeoffRequestRow): Promise<void> {
    if (!(await this.isApprover(tx, ctx, row))) throw new ForbiddenException('Only the approver of this request decides it');
  }

  /** The pending requests whose approvers include the caller, with the resolved approver. */
  private async pendingFor(tx: Tx, ctx: TenantContext, access: CallerAccess): Promise<{ row: TimeoffRequestRow; approver: ApproverView }[]> {
    if (!access.isAdmin && !access.isManager) return [];
    const rows = await tx
      .select()
      .from(timeoffRequests)
      .where(and(eq(timeoffRequests.status, 'pending'), access.isAdmin ? undefined : inArray(timeoffRequests.employeeId, [...access.reportIds])))
      .orderBy(asc(timeoffRequests.startDate));
    const out: { row: TimeoffRequestRow; approver: ApproverView }[] = [];
    const today = await workspaceToday(tx, ctx.tenantId);
    for (const row of rows) {
      const approver = await this.requests.approver(tx, ctx.tenantId, row.employeeId, today);
      if (approver?.approvers.some((a) => a.userId === ctx.userId)) out.push({ row, approver });
    }
    return out;
  }

  /** Who else is away on the request's days: the requester's unit and the approver's direct reports (spec 9.2). */
  private async alsoAway(tx: Tx, access: CallerAccess, row: TimeoffRequestRow): Promise<ApprovalRow['alsoAway']> {
    const [who] = await tx.select({ unitId: employees.unitId }).from(employees).where(eq(employees.id, row.employeeId));
    const ids = new Set<string>(access.directReportIds);
    if (who?.unitId) for (const e of await tx.select({ id: employees.id }).from(employees).where(and(eq(employees.unitId, who.unitId), shownAndActive))) ids.add(e.id);
    ids.delete(row.employeeId);
    if (!ids.size) return [];
    const overlaps = await tx
      .select({ employeeId: timeoffRequests.employeeId, fullName: employees.fullName, type: timeoffRequests.type, reasonId: timeoffRequests.reasonId, startDate: timeoffRequests.startDate, endDate: timeoffRequests.endDate, status: timeoffRequests.status })
      .from(timeoffRequests)
      .innerJoin(employees, eq(employees.id, timeoffRequests.employeeId))
      .where(and(inArray(timeoffRequests.employeeId, [...ids]), inArray(timeoffRequests.status, ['pending', 'approved']), lte(timeoffRequests.startDate, row.endDate), gte(timeoffRequests.endDate, row.startDate)))
      .orderBy(asc(employees.lastName), asc(timeoffRequests.startDate));
    const reasonIds = [...new Set(overlaps.map((o) => o.reasonId).filter((x): x is string => !!x))];
    const reasons = new Map(reasonIds.length ? (await tx.select({ id: timeoffReasons.id, name: timeoffReasons.name }).from(timeoffReasons).where(inArray(timeoffReasons.id, reasonIds))).map((r) => [r.id, r.name]) : []);
    return overlaps.map((o) => ({ employeeId: o.employeeId, fullName: o.fullName, what: describeType(o.type, o.reasonId ? (reasons.get(o.reasonId) ?? null) : null), startDate: o.startDate, endDate: o.endDate, status: o.status === 'approved' ? 'approved' : 'pending' }));
  }

  /** Cancelled or shortened (spec 15.2): the employee and the approvers, the actor left out. */
  private async notifyChanged(tx: Tx, ctx: TenantContext, row: TimeoffRequestRow, change: 'cancelled' | 'shortened'): Promise<void> {
    const [e] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, row.employeeId));
    const recipients = new Set<string | null>();
    if (!e?.userId || e.userId !== ctx.userId) recipients.add(e?.userId ?? null);
    const approver = await this.requests.approver(tx, ctx.tenantId, row.employeeId, await workspaceToday(tx, ctx.tenantId));
    for (const a of approver?.approvers ?? []) if (a.userId !== ctx.userId) recipients.add(a.userId);
    for (const recipientUserId of recipients) {
      await this.jobs.send('timeoff.notice-email', { tenantId: ctx.tenantId, kind: 'changed', requestId: row.id, change, recipientUserId, actorUserId: ctx.userId }, tx);
    }
  }
}
