import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { employees, memberships, type SickLeaveRow, type SickLeaveStatus, sickLeaves, sickLeaveTypes, timeoffNotices, timeoffRequestDays, timeoffRequests } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { TenantProvisioning, type TenantProvisioner } from '../../shared/events/tenant-provisioning';
import { type CallerAccess, PeopleAccess } from '../people';
import { holidaysBetween, timesheetSettings } from '../timesheet';
import { csvCell, type CsvValue } from './csv';
import { assignPools } from './balance';
import { BalancesService } from './balances.service';
import { DecisionsService } from './decisions.service';
import { addDays, workingDaysBetween } from './request-rules';
import { calendarDays, continues, countedEnd, day31, periodsOverlap } from './sick-leave-rules';
import type { CancelSickLeave, ConfirmSickLeave, CreateSickLeave, CreateSickLeaveType, SickLeaveQuery, UpdateSickLeave, UpdateSickLeaveType } from './timeoff.schemas';
import { workspaceToday } from './today';

/** The defaults of a new workspace (spec 13.3, assumption A16); the migration gave them to existing ones. */
export const DEFAULT_SICK_LEAVE_TYPES: { name: string; payerNote: string }[] = [
  { name: 'Illness or injury outside work', payerNote: '65%. Employer for the first 30 days, then RFZO.' },
  { name: 'Injury at work or occupational disease', payerNote: '100%. Payer to confirm.' },
  { name: 'Pregnancy related', payerNote: '100%. RFZO from the first day.' },
  { name: 'Care of a family member', payerNote: '65%. RFZO from the first day in some cases, otherwise the employer for the first 30 days.' },
  { name: 'Other legal ground', payerNote: 'As per the sick note (e.g. organ donation, isolation).' },
];

export interface SickLeaveTypeView {
  id: string;
  name: string;
  payerNote: string | null;
  active: boolean;
  /** Records that use it (a used type can't be deleted). */
  used: number;
}

/**
 * A sick leave record as the caller may see it (spec 13.6): the type for the employee themselves
 * and Admins (never managers), the note and the sick note reference for Admins only.
 */
export interface SickLeaveView {
  id: string;
  employee: { id: string; fullName: string };
  startDate: string;
  endDate: string | null;
  status: SickLeaveStatus;
  type: { id: string; name: string } | null;
  sickNoteRef: string | null;
  note: string | null;
  cancelReason: string | null;
  continuationOfId: string | null;
  /** Admins: an earlier record this one seems to continue (spec 13.2), when none is set. */
  suggestedContinuationId: string | null;
  calendarDays: number;
  workingDays: number;
  /** The 31st calendar day across the record and the ones it continues (spec 13.3), or null when not reached. */
  day31: string | null;
  /** Open and unchanged for over 30 days (spec 13.4): "Still open: check the end date". */
  stillOpen: boolean;
  /** Approved time off days it interrupted (spec 13.4, A9). */
  interruptedDays: number;
  canEdit: boolean;
  /** The employee or their direct manager may set the end date while it isn't confirmed or set. */
  canSetEnd: boolean;
  canConfirm: boolean;
  canCancel: boolean;
}

/** Sick leave in a period for the team calendar and "who is absent" (no type). */
export interface SickDay {
  employeeId: string;
  date: string;
  status: 'reported' | 'confirmed';
  sickLeaveId: string;
}

const ACTIVE = ['reported', 'confirmed'] as const;
const PAST_LIMIT_DAYS = 60;
const STILL_OPEN_DAYS = 30;
const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Sick leave (CD-169, spec 13): employees report their own, managers their direct reports', Admins
 * create, confirm (with the type), edit and cancel any. An open record (no end date) counts up to
 * today and the daily job extends it. Approved time off overlapping it is interrupted: those days
 * go back to the balance, the request stays Approved with fewer days, its decision becomes
 * Outdated, and the employee, approvers and Admins are emailed. No medical data is stored.
 */
@Injectable()
export class SickLeaveService implements TenantProvisioner, OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly access: PeopleAccess,
    private readonly decisions: DecisionsService,
    private readonly balances: BalancesService,
    private readonly provisioning: TenantProvisioning,
  ) {}

  onModuleInit(): void {
    this.provisioning.register(this);
  }

  async provision(tx: Tx, tenantId: string): Promise<void> {
    await tx
      .insert(sickLeaveTypes)
      .values(DEFAULT_SICK_LEAVE_TYPES.map((t, i) => ({ tenantId, ...t, position: i + 1 })))
      .onConflictDoNothing();
  }

  // ------------------------------------------------------------------ types (Settings → Time off)

  types(ctx: TenantContext): Promise<SickLeaveTypeView[]> {
    return this.database.withTenant(ctx.tenantId, (tx) => this.typesIn(tx));
  }

  private async typesIn(tx: Tx, id?: string): Promise<SickLeaveTypeView[]> {
    const rows = await tx
      .select({ id: sickLeaveTypes.id, name: sickLeaveTypes.name, payerNote: sickLeaveTypes.payerNote, active: sickLeaveTypes.active, used: sql<number>`(select count(*)::int from ${sickLeaves} s where s.type_id = ${sickLeaveTypes}.id)` })
      .from(sickLeaveTypes)
      .where(id ? eq(sickLeaveTypes.id, id) : undefined)
      .orderBy(asc(sickLeaveTypes.position), asc(sickLeaveTypes.name));
    return rows;
  }

  createType(ctx: TenantContext, input: CreateSickLeaveType): Promise<SickLeaveTypeView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const [last] = await tx.select({ n: sql<number>`coalesce(max(${sickLeaveTypes.position}), 0)::int` }).from(sickLeaveTypes);
        const [row] = await tx.insert(sickLeaveTypes).values({ tenantId: ctx.tenantId, name: input.name, payerNote: input.payerNote ?? null, position: (last?.n ?? 0) + 1 }).returning({ id: sickLeaveTypes.id });
        await this.audit.record(tx, ctx, { action: 'timeoff.sick_type_created', entityType: 'sick_leave_type', entityId: row!.id, data: { ...input } });
        return (await this.typesIn(tx, row!.id))[0]!;
      })
      .catch(mapDbError);
  }

  updateType(ctx: TenantContext, id: string, input: UpdateSickLeaveType): Promise<SickLeaveTypeView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
        const [row] = await tx.update(sickLeaveTypes).set(patch).where(eq(sickLeaveTypes.id, id)).returning({ id: sickLeaveTypes.id });
        if (!row) throw new NotFoundException('Sick leave type not found');
        await this.audit.record(tx, ctx, { action: 'timeoff.sick_type_updated', entityType: 'sick_leave_type', entityId: id, data: { ...input } });
        return (await this.typesIn(tx, id))[0]!;
      })
      .catch(mapDbError);
  }

  /** Only a type no record uses (spec 13.3); deactivate a used one. */
  removeType(ctx: TenantContext, id: string): Promise<void> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [type] = await this.typesIn(tx, id);
      if (!type) throw new NotFoundException('Sick leave type not found');
      if (type.used) throw new ConflictException(`${type.name} is used by ${type.used} sick leave record${type.used === 1 ? '' : 's'}. Deactivate it instead.`);
      await tx.delete(sickLeaveTypes).where(eq(sickLeaveTypes.id, id));
      await this.audit.record(tx, ctx, { action: 'timeoff.sick_type_deleted', entityType: 'sick_leave_type', entityId: id, data: { name: type.name } });
    });
  }

  // ------------------------------------------------------------------ records

  /**
   * Own records by default; `employeeId` a report's (managers) or anyone's (Admins); `all` every
   * record the caller may see (managers: their direct and indirect reports; Admins: everyone).
   */
  list(ctx: TenantContext, query: SickLeaveQuery): Promise<SickLeaveView[]> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const today = await workspaceToday(tx, ctx.tenantId);
      let scope: string[] | null;
      if (query.employeeId) {
        if (!access.canSeeEmployment(query.employeeId)) throw new NotFoundException('Employee not found');
        scope = [query.employeeId];
      } else if (query.all) {
        if (!access.isAdmin && !access.isManager) throw new ForbiddenException('Only managers and Admins see others\' sick leave');
        scope = access.isAdmin ? null : [...access.reportIds];
      } else {
        scope = access.employeeId ? [access.employeeId] : [];
      }
      if (scope && !scope.length) return [];
      const where = [scope ? inArray(sickLeaves.employeeId, scope) : undefined];
      if (query.status) where.push(eq(sickLeaves.status, query.status));
      if (query.open) where.push(and(isNull(sickLeaves.endDate), ne(sickLeaves.status, 'cancelled')));
      if (query.month) {
        const from = `${query.month}-01`;
        const to = new Date(Date.UTC(Number(query.month.slice(0, 4)), Number(query.month.slice(5, 7)), 0)).toISOString().slice(0, 10);
        where.push(lte(sickLeaves.startDate, to), or(isNull(sickLeaves.endDate), gte(sickLeaves.endDate, from)));
      }
      if (query.typeId && access.isAdmin) where.push(eq(sickLeaves.typeId, query.typeId));
      if (query.unitId) where.push(sql`${sickLeaves.employeeId} in (select e.id from ${employees} e where e.unit_id = ${query.unitId})`);
      const rows = await tx
        .select()
        .from(sickLeaves)
        .where(and(...where))
        .orderBy(desc(sickLeaves.startDate));
      return this.views(tx, ctx, access, rows, today);
    });
  }

  get(ctx: TenantContext, id: string): Promise<SickLeaveView> {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const row = await this.visible(tx, access, id);
      return (await this.views(tx, ctx, access, [row], await workspaceToday(tx, ctx.tenantId)))[0]!;
    });
  }

  /**
   * Report (spec 13.4): the employee for themselves, a manager for a direct report, up to 60 days
   * back; Admins for anyone, any date, and with `confirm` (and a type) a Confirmed record at once.
   * Only Admins set the type, the sick note reference and the note.
   */
  create(ctx: TenantContext, input: CreateSickLeave): Promise<SickLeaveView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        const employeeId = input.employeeId ?? access.employeeId;
        if (!employeeId) throw new ForbiddenException('You have no employee record in this workspace');
        const [employee] = await tx.select({ id: employees.id, deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, employeeId));
        if (!employee || !access.canSeeEmployment(employeeId)) throw new NotFoundException('Employee not found');
        if (employee.deactivatedAt) throw new ConflictException('This employee has left; their sick leave can\'t be reported any more');
        if (!access.isAdmin) {
          if (!access.isSelf(employeeId) && !access.isDirectReport(employeeId)) throw new ForbiddenException('Managers report sick leave for their direct reports only');
          if (input.typeId || input.sickNoteRef || input.note || input.confirm || input.continuationOfId) throw new ForbiddenException('Only Admins set the type, the sick note reference, the note, the continuation, or confirm');
        }
        const today = await workspaceToday(tx, ctx.tenantId);
        if (!access.isAdmin && input.startDate < addDays(today, -PAST_LIMIT_DAYS)) throw new BadRequestException(`Sick leave can be reported up to ${PAST_LIMIT_DAYS} days back; ask an Admin for older records`);
        if (input.endDate && input.endDate < input.startDate) throw new BadRequestException('The last day is before the first day');
        if (input.confirm && !input.typeId) throw new BadRequestException('Pick the type to confirm the record');
        if (input.typeId) await this.activeType(tx, input.typeId);
        await this.lock(tx, employeeId);
        await this.refuseOverlap(tx, employeeId, { startDate: input.startDate, endDate: input.endDate ?? null }, null);
        if (input.continuationOfId) await this.checkContinuation(tx, employeeId, input.continuationOfId, input.startDate);
        const confirmed = !!input.confirm;
        const [row] = await tx
          .insert(sickLeaves)
          .values({
            tenantId: ctx.tenantId,
            employeeId,
            startDate: input.startDate,
            endDate: input.endDate ?? null,
            typeId: input.typeId ?? null,
            continuationOfId: input.continuationOfId ?? null,
            sickNoteRef: input.sickNoteRef ?? null,
            note: input.note ?? null,
            status: confirmed ? 'confirmed' : 'reported',
            reportedByUserId: ctx.userId,
            ...(confirmed ? { confirmedByUserId: ctx.userId, confirmedAt: new Date() } : {}),
          })
          .returning();
        await this.audit.record(tx, ctx, { action: 'timeoff.sick_leave_reported', entityType: 'sick_leave', entityId: row!.id, data: { employeeId, startDate: row!.startDate, endDate: row!.endDate, status: row!.status } });
        await this.applyInterruptions(tx, ctx.tenantId, row!, today);
        if (!confirmed) await this.jobs.send('timeoff.sick-email', { tenantId: ctx.tenantId, kind: 'reported', sickLeaveId: row!.id, actorUserId: ctx.userId }, tx);
        return (await this.views(tx, ctx, access, [row!], today))[0]!;
      })
      .catch(mapDbError);
  }

  /**
   * Edit (spec 13.4). Admins: every field. The employee and their direct manager: only the end date,
   * while it isn't set yet or the record isn't confirmed. Setting the end date emails the manager.
   */
  update(ctx: TenantContext, id: string, input: UpdateSickLeave): Promise<SickLeaveView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        const row = await this.lockedRow(tx, access, id);
        if (row.status === 'cancelled') throw new ConflictException('This record was cancelled');
        if (!access.isAdmin) {
          if (input.endDate === null) throw new ForbiddenException('Only Admins reopen a record');
          if (!this.mayReport(access, row.employeeId)) throw new ForbiddenException('Only the employee, their manager and Admins change sick leave');
          const others = Object.entries(input).filter(([k, v]) => k !== 'endDate' && v !== undefined);
          if (others.length) throw new ForbiddenException('Only Admins change anything but the end date');
          if (row.endDate !== null && row.status === 'confirmed') throw new ForbiddenException('The end date of a confirmed record is changed by an Admin');
        }
        const next = { startDate: input.startDate ?? row.startDate, endDate: input.endDate === undefined ? row.endDate : input.endDate };
        if (next.endDate && next.endDate < next.startDate) throw new BadRequestException('The last day is before the first day');
        if (input.typeId && input.typeId !== row.typeId) await this.activeType(tx, input.typeId);
        await this.refuseOverlap(tx, row.employeeId, next, row.id);
        const continuationOfId = input.continuationOfId === undefined ? row.continuationOfId : input.continuationOfId;
        if (continuationOfId) await this.checkContinuation(tx, row.employeeId, continuationOfId, next.startDate, row.id);
        if (row.status === 'confirmed' && input.typeId === null) throw new BadRequestException('A confirmed record keeps its type');
        const patch = Object.fromEntries(Object.entries({ ...input, continuationOfId }).filter(([, v]) => v !== undefined));
        const [updated] = await tx.update(sickLeaves).set(patch).where(eq(sickLeaves.id, id)).returning();
        await this.audit.record(tx, ctx, { action: 'timeoff.sick_leave_updated', entityType: 'sick_leave', entityId: id, data: { employeeId: row.employeeId, ...input } });
        const today = await workspaceToday(tx, ctx.tenantId);
        await this.applyInterruptions(tx, ctx.tenantId, updated!, today);
        if (row.endDate === null && updated!.endDate !== null) await this.jobs.send('timeoff.sick-email', { tenantId: ctx.tenantId, kind: 'ended', sickLeaveId: id, actorUserId: ctx.userId }, tx);
        return (await this.views(tx, ctx, access, [updated!], today))[0]!;
      })
      .catch(mapDbError);
  }

  /** Confirm (spec 13.4, Admins): the type, and the end date and continuation if known. */
  confirm(ctx: TenantContext, id: string, input: ConfirmSickLeave): Promise<SickLeaveView> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const access = await this.access.of(ctx, tx);
        const row = await this.lockedRow(tx, access, id);
        if (row.status !== 'reported') throw new ConflictException(`This record is ${row.status}, not reported`);
        const endDate = input.endDate === undefined ? row.endDate : input.endDate;
        if (endDate && endDate < row.startDate) throw new BadRequestException('The last day is before the first day');
        await this.activeType(tx, input.typeId);
        await this.refuseOverlap(tx, row.employeeId, { startDate: row.startDate, endDate }, row.id);
        const continuationOfId = input.continuationOfId === undefined ? row.continuationOfId : input.continuationOfId;
        if (continuationOfId) await this.checkContinuation(tx, row.employeeId, continuationOfId, row.startDate, row.id);
        const [updated] = await tx
          .update(sickLeaves)
          .set({ status: 'confirmed', typeId: input.typeId, endDate, continuationOfId, ...(input.sickNoteRef !== undefined ? { sickNoteRef: input.sickNoteRef } : {}), confirmedByUserId: ctx.userId, confirmedAt: new Date() })
          .where(eq(sickLeaves.id, id))
          .returning();
        await this.audit.record(tx, ctx, { action: 'timeoff.sick_leave_confirmed', entityType: 'sick_leave', entityId: id, data: { employeeId: row.employeeId, typeId: input.typeId, endDate } });
        const today = await workspaceToday(tx, ctx.tenantId);
        await this.applyInterruptions(tx, ctx.tenantId, updated!, today);
        if (row.endDate === null && endDate !== null) await this.jobs.send('timeoff.sick-email', { tenantId: ctx.tenantId, kind: 'ended', sickLeaveId: id, actorUserId: ctx.userId }, tx);
        return (await this.views(tx, ctx, access, [updated!], today))[0]!;
      })
      .catch(mapDbError);
  }

  /**
   * Cancel a wrong entry (spec 13.4, Admins, a reason). Interrupted time off days still ahead go
   * back to their requests; past ones stay returned and `notRestored` says how many.
   */
  cancel(ctx: TenantContext, id: string, input: CancelSickLeave): Promise<SickLeaveView & { notRestored: number }> {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
      const access = await this.access.of(ctx, tx);
      const row = await this.lockedRow(tx, access, id);
      if (row.status === 'cancelled') throw new ConflictException('This record was cancelled already');
      const [updated] = await tx.update(sickLeaves).set({ status: 'cancelled', cancelReason: input.reason }).where(eq(sickLeaves.id, id)).returning();
      await this.audit.record(tx, ctx, { action: 'timeoff.sick_leave_cancelled', entityType: 'sick_leave', entityId: id, data: { employeeId: row.employeeId, reason: input.reason } });
      const today = await workspaceToday(tx, ctx.tenantId);
      const { notRestored } = await this.applyInterruptions(tx, ctx.tenantId, updated!, today);
      return { ...(await this.views(tx, ctx, access, [updated!], today))[0]!, notRestored };
      })
      .catch(mapDbError);
  }

  /** CSV for Admins (spec 13.5): the list with the same filters. */
  async csv(ctx: TenantContext, query: SickLeaveQuery): Promise<string> {
    const rows = await this.list(ctx, { ...query, all: true });
    const header = ['Employee', 'First day', 'Last day', 'Calendar days', 'Working days', 'Type', 'Status', 'Day 31', 'Sick note reference'];
    const lines: CsvValue[][] = [header, ...rows.map((r) => [r.employee.fullName, r.startDate, r.endDate ?? 'open', r.calendarDays, r.workingDays, r.type?.name ?? null, r.status, r.day31, r.sickNoteRef])];
    return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------ other modules and the daily job

  /** Sick leave days (reported or confirmed) of these employees between two dates: the team calendar. */
  async daysIn(tx: Tx, tenantId: string, employeeIds: string[], from: string, to: string): Promise<SickDay[]> {
    if (!employeeIds.length) return [];
    const today = await workspaceToday(tx, tenantId);
    const rows = await tx
      .select({ id: sickLeaves.id, employeeId: sickLeaves.employeeId, startDate: sickLeaves.startDate, endDate: sickLeaves.endDate, status: sickLeaves.status })
      .from(sickLeaves)
      .where(and(inArray(sickLeaves.employeeId, employeeIds), inArray(sickLeaves.status, [...ACTIVE]), lte(sickLeaves.startDate, to), or(isNull(sickLeaves.endDate), gte(sickLeaves.endDate, from))));
    const out: SickDay[] = [];
    for (const r of rows) {
      // An open record shows up to today: nobody knows yet when the employee is back.
      const last = r.endDate ?? today;
      for (let d = r.startDate < from ? from : r.startDate; d <= last && d <= to; d = addDays(d, 1)) out.push({ employeeId: r.employeeId, date: d, status: r.status as SickDay['status'], sickLeaveId: r.id });
    }
    return out;
  }

  /** Who of these employees is on sick leave on a date (the approver rule's "absent manager", spec 13.4). */
  async sickOn(tx: Tx, employeeIds: string[], date: string): Promise<Set<string>> {
    if (!employeeIds.length) return new Set();
    const rows = await tx
      .selectDistinct({ employeeId: sickLeaves.employeeId })
      .from(sickLeaves)
      .where(and(inArray(sickLeaves.employeeId, employeeIds), inArray(sickLeaves.status, [...ACTIVE]), lte(sickLeaves.startDate, date), or(isNull(sickLeaves.endDate), gte(sickLeaves.endDate, date))));
    return new Set(rows.map((r) => r.employeeId));
  }

  /** The daily job: open records reach a new day, interrupting the time off on it (spec 13.4). Returns the records extended. */
  extendOpen(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const today = await workspaceToday(tx, tenantId, now);
      const open = await tx.select().from(sickLeaves).where(and(isNull(sickLeaves.endDate), inArray(sickLeaves.status, [...ACTIVE]), lte(sickLeaves.startDate, today)));
      for (const row of open) {
        await this.lock(tx, row.employeeId);
        const [fresh] = await tx.select().from(sickLeaves).where(eq(sickLeaves.id, row.id));
        if (fresh && fresh.status !== 'cancelled') await this.applyInterruptions(tx, tenantId, fresh, today);
      }
      return open.length;
    });
  }

  /**
   * Monday's "Weekly sick leave check" (spec 15.2): to each Admin with an employee record (the
   * claim is keyed by it), the records still Reported or open and unchanged for over 30 days.
   */
  queueWeeklyCheck(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const today = await workspaceToday(tx, tenantId, now);
      if (isoWeekday(today) !== 1) return 0;
      const due = await tx
        .select({ id: sickLeaves.id })
        .from(sickLeaves)
        .where(or(eq(sickLeaves.status, 'reported'), and(eq(sickLeaves.status, 'confirmed'), isNull(sickLeaves.endDate), lte(sickLeaves.updatedAt, sql`now() - interval '30 days'`))));
      if (!due.length) return 0;
      const admins = await tx
        .select({ userId: memberships.userId, employeeId: employees.id })
        .from(memberships)
        .innerJoin(employees, and(eq(employees.userId, memberships.userId), isNull(employees.deactivatedAt)))
        .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.role, ['owner', 'admin'])));
      let queued = 0;
      for (const a of admins) {
        const claimed = await tx.insert(timeoffNotices).values({ tenantId, kind: 'sick_leave_check', employeeId: a.employeeId, period: today }).onConflictDoNothing().returning({ employeeId: timeoffNotices.employeeId });
        if (!claimed.length) continue;
        await this.jobs.send('timeoff.sick-email', { tenantId, kind: 'weekly_check', recipientUserId: a.userId, sickLeaveIds: due.map((d) => d.id) }, tx);
        queued++;
      }
      return queued;
    });
  }

  // ------------------------------------------------------------------ internals

  /**
   * Makes the approved time off match the record (spec 13.4, A9): its counted days inside the
   * record's period (up to today while open) become `interrupted` and go back to the balance; days
   * it no longer covers (shortened, cancelled) that are still ahead become `counted` again unless
   * the employee has booked that day meanwhile. The requests' working days follow, their decisions
   * become Outdated, and each newly interrupted request queues the "Time off interrupted" email.
   */
  private async applyInterruptions(tx: Tx, tenantId: string, sick: SickLeaveRow, today: string): Promise<{ notRestored: number }> {
    const active = sick.status !== 'cancelled';
    const end = active ? countedEnd(sick, today) : null;
    const touched = new Set<string>();
    let notRestored = 0;
    const mine = await tx
      .select({ id: timeoffRequestDays.id, date: timeoffRequestDays.date, requestId: timeoffRequestDays.requestId, status: timeoffRequests.status, type: timeoffRequests.type, startDate: timeoffRequests.startDate, endDate: timeoffRequests.endDate })
      .from(timeoffRequestDays)
      .innerJoin(timeoffRequests, eq(timeoffRequests.id, timeoffRequestDays.requestId))
      .where(and(eq(timeoffRequestDays.sickLeaveId, sick.id), eq(timeoffRequestDays.state, 'interrupted')));
    const restorable: typeof mine = [];
    for (const d of mine) {
      if (end !== null && d.date >= sick.startDate && d.date <= end) continue;
      // Past days stay returned; so do days of a request no longer approved or shortened since.
      if (d.date < today || d.status !== 'approved' || d.date < d.startDate || d.date > d.endDate) {
        notRestored++;
        continue;
      }
      const [taken] = await tx.select({ id: timeoffRequestDays.id }).from(timeoffRequestDays).where(and(eq(timeoffRequestDays.employeeId, sick.employeeId), eq(timeoffRequestDays.date, d.date), eq(timeoffRequestDays.state, 'counted')));
      if (taken) {
        notRestored++;
        continue;
      }
      restorable.push(d);
    }
    // Vacation days come back only while the balance has room (the freed days may be booked elsewhere since).
    const vacation = restorable.filter((d) => d.type === 'vacation');
    let pools = new Map<string, number>();
    if (vacation.length) {
      const years = [...new Set(vacation.map((d) => Number(d.date.slice(0, 4))))];
      const pc = await this.balances.poolContext(tx, tenantId, sick.employeeId, [...new Set(years.flatMap((y) => [y - 1, y]))]);
      const fit = pc ? assignPools(vacation.map((d) => d.date).sort(), { today: pc.today, policy: pc.policy, pools: pc.pools, days: pc.days }) : null;
      if (fit?.ok) pools = new Map(fit.days.map((a) => [a.date, a.poolYear]));
    }
    for (const d of restorable) {
      if (d.type === 'vacation' && !pools.has(d.date)) {
        notRestored++;
        continue;
      }
      await tx
        .update(timeoffRequestDays)
        .set({ state: 'counted', sickLeaveId: null, ...(d.type === 'vacation' ? { poolYear: pools.get(d.date)! } : {}) })
        .where(eq(timeoffRequestDays.id, d.id));
      touched.add(d.requestId);
    }
    const interrupted = new Map<string, string[]>();
    if (end !== null && end >= sick.startDate) {
      const rows = await tx
        .update(timeoffRequestDays)
        .set({ state: 'interrupted', sickLeaveId: sick.id })
        .where(
          and(
            eq(timeoffRequestDays.employeeId, sick.employeeId),
            eq(timeoffRequestDays.state, 'counted'),
            gte(timeoffRequestDays.date, sick.startDate),
            lte(timeoffRequestDays.date, end),
            sql`${timeoffRequestDays.requestId} in (select r.id from ${timeoffRequests} r where r.status = 'approved')`,
          ),
        )
        .returning({ requestId: timeoffRequestDays.requestId, date: timeoffRequestDays.date });
      for (const r of rows) {
        interrupted.set(r.requestId, [...(interrupted.get(r.requestId) ?? []), r.date]);
        touched.add(r.requestId);
      }
    }
    for (const requestId of touched) {
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(timeoffRequestDays).where(and(eq(timeoffRequestDays.requestId, requestId), eq(timeoffRequestDays.state, 'counted')));
      await tx.update(timeoffRequests).set({ workingDays: n?.n ?? 0 }).where(eq(timeoffRequests.id, requestId));
      await this.decisions.sourceChanged(tx, requestId, 'outdated');
    }
    for (const [requestId, dates] of interrupted) {
      await this.jobs.send('timeoff.sick-email', { tenantId, kind: 'interrupted', sickLeaveId: sick.id, requestId, dates: dates.sort() }, tx);
    }
    return { notRestored };
  }

  /** No two active records of the same employee share a day (spec 13.4). */
  private async refuseOverlap(tx: Tx, employeeId: string, period: { startDate: string; endDate: string | null }, exceptId: string | null): Promise<void> {
    const others = await tx
      .select({ id: sickLeaves.id, startDate: sickLeaves.startDate, endDate: sickLeaves.endDate })
      .from(sickLeaves)
      .where(and(eq(sickLeaves.employeeId, employeeId), inArray(sickLeaves.status, [...ACTIVE]), exceptId ? ne(sickLeaves.id, exceptId) : undefined));
    const clash = others.find((o) => periodsOverlap(o, period));
    if (clash) throw new ConflictException(`Overlaps sick leave from ${clash.startDate}${clash.endDate ? ` to ${clash.endDate}` : ' (still open)'}. Change that record instead.`);
  }

  private async checkContinuation(tx: Tx, employeeId: string, continuationOfId: string, startDate: string, selfId?: string): Promise<void> {
    if (continuationOfId === selfId) throw new BadRequestException('A record can\'t continue itself');
    const [earlier] = await tx.select({ employeeId: sickLeaves.employeeId, endDate: sickLeaves.endDate, status: sickLeaves.status }).from(sickLeaves).where(eq(sickLeaves.id, continuationOfId));
    if (!earlier || earlier.employeeId !== employeeId || earlier.status === 'cancelled') throw new BadRequestException('The continued record must be an earlier record of the same employee');
    if (!earlier.endDate || earlier.endDate >= startDate) throw new BadRequestException('The continued record must end before this one starts');
  }

  /**
   * Time off approved or recorded on days an active sick leave already covers (spec 13.4): the
   * same interruption as when the sick leave came first. Called in the approval's transaction.
   */
  async reapplyFor(tx: Tx, tenantId: string, employeeId: string, from: string, to: string): Promise<void> {
    const today = await workspaceToday(tx, tenantId);
    const rows = await tx
      .select()
      .from(sickLeaves)
      .where(and(eq(sickLeaves.employeeId, employeeId), inArray(sickLeaves.status, [...ACTIVE]), lte(sickLeaves.startDate, to), or(isNull(sickLeaves.endDate), gte(sickLeaves.endDate, from))));
    for (const row of rows) await this.applyInterruptions(tx, tenantId, row, today);
  }

  private lock(tx: Tx, employeeId: string) {
    return tx.execute(sql`select pg_advisory_xact_lock(hashtext(${employeeId}))`);
  }

  /** The record read again under its employee's lock, so checks see what the change will change. */
  private async lockedRow(tx: Tx, access: CallerAccess, id: string): Promise<SickLeaveRow> {
    const first = await this.visible(tx, access, id);
    await this.lock(tx, first.employeeId);
    const [row] = await tx.select().from(sickLeaves).where(eq(sickLeaves.id, id));
    return row!;
  }

  private async activeType(tx: Tx, typeId: string): Promise<void> {
    const [type] = await tx.select({ active: sickLeaveTypes.active }).from(sickLeaveTypes).where(eq(sickLeaveTypes.id, typeId));
    if (!type) throw new BadRequestException('Sick leave type not found');
    if (!type.active) throw new BadRequestException('This sick leave type is inactive');
  }

  private mayReport(access: CallerAccess, employeeId: string): boolean {
    return access.isAdmin || access.isSelf(employeeId) || access.isDirectReport(employeeId);
  }

  private async visible(tx: Tx, access: CallerAccess, id: string): Promise<SickLeaveRow> {
    const [row] = await tx.select().from(sickLeaves).where(eq(sickLeaves.id, id));
    if (!row || !access.canSeeEmployment(row.employeeId)) throw new NotFoundException('Sick leave not found');
    return row;
  }

  private async views(tx: Tx, ctx: TenantContext, access: CallerAccess, rows: SickLeaveRow[], today: string): Promise<SickLeaveView[]> {
    if (!rows.length) return [];
    const employeeIds = [...new Set(rows.map((r) => r.employeeId))];
    const names = new Map((await tx.select({ id: employees.id, fullName: employees.fullName }).from(employees).where(inArray(employees.id, employeeIds))).map((e) => [e.id, e.fullName]));
    const types = new Map((await tx.select({ id: sickLeaveTypes.id, name: sickLeaveTypes.name }).from(sickLeaveTypes)).map((t) => [t.id, t]));
    // Every record of these employees: the continuation chains and the suggestions need the earlier ones.
    const all = await tx.select().from(sickLeaves).where(and(inArray(sickLeaves.employeeId, employeeIds), ne(sickLeaves.status, 'cancelled')));
    const byId = new Map(all.map((r) => [r.id, r]));
    const settings = await timesheetSettings(tx, ctx.tenantId);
    const from = rows.reduce((m, r) => (r.startDate < m ? r.startDate : m), rows[0]!.startDate);
    const to = rows.reduce((m, r) => {
      const e = r.endDate ?? today;
      return e > m ? e : m;
    }, today);
    const holidays = await holidaysBetween(tx, addDays(from, -10), addDays(to, 10));
    const isWorkingDay = (d: string) => settings.workingDays.includes(isoWeekday(d)) && !holidays.has(d);
    const interruptedCounts = new Map(
      (
        await tx
          .select({ sickLeaveId: timeoffRequestDays.sickLeaveId, n: sql<number>`count(*)::int` })
          .from(timeoffRequestDays)
          .where(and(inArray(timeoffRequestDays.sickLeaveId, rows.map((r) => r.id)), eq(timeoffRequestDays.state, 'interrupted')))
          .groupBy(timeoffRequestDays.sickLeaveId)
      ).map((r) => [r.sickLeaveId!, r.n]),
    );
    const staleBefore = Date.now() - STILL_OPEN_DAYS * 86_400_000;
    return rows.map((r) => {
      const self = access.isSelf(r.employeeId);
      const admin = access.isAdmin;
      const last = countedEnd(r, today);
      // The calendar days of the records this one continues, newest first (at most 20 links).
      let prior = 0;
      for (let link = r.continuationOfId ? byId.get(r.continuationOfId) : undefined, hops = 0; link && hops < 20; link = link.continuationOfId ? byId.get(link.continuationOfId) : undefined, hops++) {
        prior += calendarDays(link.startDate, link.endDate ?? link.startDate);
      }
      const suggestion =
        admin && !r.continuationOfId && r.status !== 'cancelled'
          ? [...byId.values()].filter((o) => o.id !== r.id && o.employeeId === r.employeeId && continues(o, r.startDate, isWorkingDay)).sort((a, b) => (a.endDate! < b.endDate! ? 1 : -1))[0]
          : undefined;
      const type = r.typeId && (self || admin) ? (types.get(r.typeId) ?? null) : null;
      const reporter = this.mayReport(access, r.employeeId);
      return {
        id: r.id,
        employee: { id: r.employeeId, fullName: names.get(r.employeeId) ?? 'Employee' },
        startDate: r.startDate,
        endDate: r.endDate,
        status: r.status,
        type: type ? { id: type.id, name: type.name } : null,
        sickNoteRef: admin ? r.sickNoteRef : null,
        note: admin ? r.note : null,
        cancelReason: admin || self ? r.cancelReason : null,
        continuationOfId: admin ? r.continuationOfId : null,
        suggestedContinuationId: suggestion?.id ?? null,
        calendarDays: calendarDays(r.startDate, last),
        workingDays: last >= r.startDate ? workingDaysBetween(r.startDate, last, { workingWeekdays: settings.workingDays, holidays }).dates.length : 0,
        day31: r.status === 'cancelled' ? null : day31(r, prior),
        stillOpen: r.status !== 'cancelled' && r.endDate === null && r.updatedAt.getTime() < staleBefore,
        interruptedDays: interruptedCounts.get(r.id) ?? 0,
        canEdit: admin && r.status !== 'cancelled',
        canSetEnd: r.status !== 'cancelled' && (admin || (reporter && (r.endDate === null || r.status === 'reported'))),
        canConfirm: admin && r.status === 'reported',
        canCancel: admin && r.status !== 'cancelled',
      };
    });
  }
}
