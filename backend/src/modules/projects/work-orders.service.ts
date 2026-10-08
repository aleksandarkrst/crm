import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { AuditService } from '../../shared/audit/audit.service';
import { hasRole, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { mapDbError } from '../../shared/database/errors';
import { companies, employees, projects, workOrderCounters, workOrders, workOrderTechnicians } from '../../shared/database/schema';
import type { CreateWorkOrder, ListWorkOrdersQuery, UpdateWorkOrder } from './work-orders.schemas';

export interface WorkOrderTechnicianView {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  isLead: boolean;
}

const techniciansJson = sql<WorkOrderTechnicianView[]>`coalesce((
  select json_agg(json_build_object('employeeId', e.id, 'name', e.full_name, 'jobTitle', e.job_title, 'isLead', t.is_lead) order by t.is_lead desc, e.full_name)
  from work_order_technicians t join employees e on e.id = t.employee_id where t.work_order_id = "work_orders"."id"), '[]'::json)`;

const columns = {
  id: workOrders.id,
  number: workOrders.number,
  title: workOrders.title,
  companyId: workOrders.companyId,
  companyName: companies.name,
  projectId: workOrders.projectId,
  projectName: projects.name,
  projectCode: projects.code,
  projectLeadUserId: projects.leadUserId,
  type: workOrders.type,
  priority: workOrders.priority,
  status: workOrders.status,
  holdReason: workOrders.holdReason,
  scheduledDate: sql<string | null>`${workOrders.scheduledDate}::text`,
  scheduledStart: sql<string | null>`to_char(${workOrders.scheduledStart}, 'HH24:MI')`,
  durationHours: workOrders.durationHours,
  location: workOrders.location,
  equipment: workOrders.equipment,
  job: workOrders.job,
  report: workOrders.report,
  completedAt: workOrders.completedAt,
  createdByUserId: workOrders.createdByUserId,
  createdAt: workOrders.createdAt,
  version: workOrders.updatedAt,
  technicians: techniciansJson,
};

function selectOrders(tx: Tx, where?: SQL, limit = 500) {
  return tx
    .select(columns)
    .from(workOrders)
    .innerJoin(companies, eq(companies.id, workOrders.companyId))
    .leftJoin(projects, eq(projects.id, workOrders.projectId))
    .where(where)
    .orderBy(desc(workOrders.number))
    .limit(limit);
}
type Row = Awaited<ReturnType<typeof selectOrders>>[number];

/**
 * Work orders (CD-265, design v2 §5). Every member sees every work order. Owners and admins, the
 * project lead, the order's technicians and whoever created it change it; owners, admins and the
 * creator delete it. New work orders: any member.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: TenantContext, query: ListWorkOrdersQuery) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const me = query.technicianId === 'me' ? await this.employeeOf(tx, ctx) : query.technicianId;
      if (query.technicianId === 'me' && !me) return [];
      const q = query.q?.toLowerCase();
      const where = and(
        query.projectId ? eq(workOrders.projectId, query.projectId) : undefined,
        query.companyId ? eq(workOrders.companyId, query.companyId) : undefined,
        query.status ? eq(workOrders.status, query.status) : undefined,
        me ? sql`exists (select 1 from work_order_technicians t where t.work_order_id = "work_orders"."id" and t.employee_id = ${me})` : undefined,
        q ? sql`(position(${q} in lower(${workOrders.title})) > 0 or ('wo-' || ${workOrders.number}) = ${q} or ${workOrders.number}::text = ${q} or position(${q} in lower(${companies.name})) > 0)` : undefined,
      );
      const rows = await selectOrders(tx, where, query.limit);
      return Promise.all(rows.map((r) => this.present(tx, ctx, r)));
    });
  }

  get(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => this.present(tx, ctx, await this.row(tx, id)));
  }

  create(ctx: TenantContext, input: CreateWorkOrder) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        await this.checkCompany(tx, input.companyId);
        if (input.projectId) await this.checkProject(tx, input.projectId, input.companyId);
        const technicianIds = [...new Set(input.technicianIds ?? [])];
        await this.checkTechnicians(tx, technicianIds);
        const date = input.scheduledDate ?? null;
        const start = input.scheduledStart ?? null;
        if ((date === null) !== (start === null)) throw new BadRequestException('Set both the date and the start, or neither');
        const [counter] = await tx
          .insert(workOrderCounters)
          .values({ tenantId: ctx.tenantId, lastNumber: 1001 })
          .onConflictDoUpdate({ target: workOrderCounters.tenantId, set: { lastNumber: sql`${workOrderCounters.lastNumber} + 1` } })
          .returning({ number: workOrderCounters.lastNumber });
        const [row] = await tx
          .insert(workOrders)
          .values({
            tenantId: ctx.tenantId,
            number: counter!.number,
            title: input.title,
            companyId: input.companyId,
            projectId: input.projectId ?? null,
            type: input.type,
            priority: input.priority,
            status: technicianIds.length && date && start ? 'scheduled' : 'unscheduled',
            scheduledDate: date,
            scheduledStart: start,
            durationHours: input.durationHours,
            location: input.location ?? null,
            equipment: input.equipment ?? null,
            job: input.job ?? null,
            createdByUserId: ctx.userId,
          })
          .returning({ id: workOrders.id });
        await this.setTechnicians(tx, ctx, row!.id, technicianIds);
        await this.audit.record(tx, ctx, { action: 'work_order.created', entityType: 'work_order', entityId: row!.id, data: { ...input, number: counter!.number } });
        return this.present(tx, ctx, await this.row(tx, row!.id));
      })
      .catch(mapDbError);
  }

  update(ctx: TenantContext, id: string, input: UpdateWorkOrder) {
    return this.database
      .withTenant(ctx.tenantId, async (tx) => {
        const row = await this.row(tx, id);
        if (!(await this.canChange(tx, ctx, row))) throw new ForbiddenException("Only owners, admins, the project lead, the technicians and the one who created it can change a work order");
        if (input.projectId) await this.checkProject(tx, input.projectId, row.companyId);

        const technicianIds = input.technicianIds ? [...new Set(input.technicianIds)] : row.technicians.map((t) => t.employeeId);
        if (input.technicianIds) await this.checkTechnicians(tx, technicianIds);
        const date = input.scheduledDate !== undefined ? input.scheduledDate : row.scheduledDate;
        const start = input.scheduledStart !== undefined ? input.scheduledStart : row.scheduledStart;
        if ((date === null) !== (start === null)) throw new BadRequestException('Set both the date and the start, or neither');
        const scheduleable = technicianIds.length > 0 && date !== null && start !== null;

        let status = input.status ?? row.status;
        if (input.status === 'scheduled' && !scheduleable) throw new BadRequestException('Scheduling needs a technician, a date and a start time');
        if (!input.status) {
          // Setting or clearing the schedule moves the order between Unscheduled and Scheduled.
          if (status === 'unscheduled' && scheduleable) status = 'scheduled';
          else if (status === 'scheduled' && !scheduleable) status = 'unscheduled';
        }
        let holdReason: string | null = null;
        if (status === 'on_hold') {
          holdReason = input.holdReason ?? row.holdReason;
          if (!holdReason) throw new BadRequestException('Tell the team why the work is paused');
        } else if (input.holdReason) {
          throw new BadRequestException('Only a work order on hold has a reason');
        }

        await tx
          .update(workOrders)
          .set({
            title: input.title,
            projectId: input.projectId,
            type: input.type,
            priority: input.priority,
            status,
            holdReason,
            scheduledDate: date,
            scheduledStart: start,
            durationHours: input.durationHours,
            location: input.location,
            equipment: input.equipment,
            job: input.job,
            report: input.report,
            completedAt: status === row.status ? undefined : status === 'completed' ? new Date() : null,
          })
          .where(eq(workOrders.id, id));
        if (input.technicianIds) await this.setTechnicians(tx, ctx, id, technicianIds);
        await this.audit.record(tx, ctx, { action: 'work_order.updated', entityType: 'work_order', entityId: id, data: input });
        return this.present(tx, ctx, await this.row(tx, id));
      })
      .catch(mapDbError);
  }

  remove(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const row = await this.row(tx, id);
      if (!hasRole(ctx.role, 'admin') && row.createdByUserId !== ctx.userId) throw new ForbiddenException('Only owners, admins and the one who created it can delete a work order');
      await tx.delete(workOrders).where(eq(workOrders.id, id));
      await this.audit.record(tx, ctx, { action: 'work_order.deleted', entityType: 'work_order', entityId: id, data: { number: row.number, title: row.title } });
    });
  }

  private async row(tx: Tx, id: string): Promise<Row> {
    const [row] = await selectOrders(tx, eq(workOrders.id, id));
    if (!row) throw new NotFoundException('Work order not found');
    return row;
  }

  private async employeeOf(tx: Tx, ctx: TenantContext): Promise<string | null> {
    const [e] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, ctx.userId));
    return e?.id ?? null;
  }

  private async canChange(tx: Tx, ctx: TenantContext, row: Row): Promise<boolean> {
    if (hasRole(ctx.role, 'admin') || row.createdByUserId === ctx.userId || row.projectLeadUserId === ctx.userId) return true;
    const me = await this.employeeOf(tx, ctx);
    return !!me && row.technicians.some((t) => t.employeeId === me);
  }

  private async present(tx: Tx, ctx: TenantContext, row: Row) {
    // The project lead's id is only for the access check, not for the client.
    const order: Omit<Row, 'projectLeadUserId'> & { projectLeadUserId?: string | null } = { ...row };
    delete order.projectLeadUserId;
    return { ...order, canChange: await this.canChange(tx, ctx, row), canDelete: hasRole(ctx.role, 'admin') || row.createdByUserId === ctx.userId };
  }

  private async checkCompany(tx: Tx, companyId: string) {
    const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    if (!c) throw new BadRequestException('Company not found');
  }

  private async checkProject(tx: Tx, projectId: string, companyId: string) {
    const [p] = await tx.select({ companyId: projects.companyId, status: projects.status }).from(projects).where(eq(projects.id, projectId));
    if (!p) throw new BadRequestException('Project not found');
    if (p.companyId !== companyId) throw new BadRequestException("The project belongs to another company");
  }

  /** Active employees whose work type is Service or Both (CD-268). */
  private async checkTechnicians(tx: Tx, ids: string[]) {
    if (!ids.length) return;
    const found = await tx.select({ id: employees.id, deactivatedAt: employees.deactivatedAt, workType: employees.workType }).from(employees).where(inArray(employees.id, ids));
    if (found.length !== ids.length) throw new BadRequestException('Employee not found');
    if (found.some((e) => e.deactivatedAt)) throw new BadRequestException("Someone who left can't be a technician");
    if (found.some((e) => e.workType === 'office')) throw new BadRequestException('Only people with the Service or Both work type can be technicians');
  }

  /** Replaces the technicians; the first is the lead. */
  private async setTechnicians(tx: Tx, ctx: TenantContext, workOrderId: string, ids: string[]) {
    await tx.delete(workOrderTechnicians).where(eq(workOrderTechnicians.workOrderId, workOrderId));
    if (ids.length) await tx.insert(workOrderTechnicians).values(ids.map((employeeId, i) => ({ tenantId: ctx.tenantId, workOrderId, employeeId, isLead: i === 0 })));
  }
}
