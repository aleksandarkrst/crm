import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { TaskHistoryQuery } from './tasks.schemas';
import { AddWorkOrderItem, CreateWorkOrder, ListWorkOrdersQuery, UpdateWorkOrder, UpdateWorkOrderItem } from './work-orders.schemas';
import { WorkOrdersService } from './work-orders.service';

const Id = new ZodPipe(UuidParam);

/**
 * Work orders (CD-265). A work order: `{ id, number, title, companyId, companyName, projectId,
 * projectName, projectCode, type, priority, status, holdReason, scheduledDate, scheduledStart,
 * durationHours, location, workPlace, equipment, job, report, materials, customerName, signedOffAt,
 * signedOffByName, completedAt, createdAt, version, technicians:
 * { employeeId, name, jobTitle, isLead }[], canChange, canDelete }`. Changes answer with it.
 */
@Controller('work-orders')
@RequireTenant('member')
export class WorkOrdersController {
  constructor(private readonly orders: WorkOrdersService) {}

  /** `?projectId=`, `?companyId=`, `?technicianId=<employeeId|me>`, `?status=`, `?q=` (title, "WO-1044", company). */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ListWorkOrdersQuery)) query: ListWorkOrdersQuery) {
    return this.orders.list(ctx, query);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.orders.get(ctx, id);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateWorkOrder)) body: CreateWorkOrder) {
    return this.orders.create(ctx, body);
  }

  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateWorkOrder)) body: UpdateWorkOrder) {
    return this.orders.update(ctx, id, body);
  }

  /**
   * The Track time card (CD-276): `{ loggedMinutes, plannedMinutes, entries: { id, employeeId, name,
   * date, minutes, note, startTime, endTime, dayStatus, mine, canChange }[], canLog, lock }`.
   * Entries are written through `/api/timesheet/entries`.
   */
  @Get(':id/time')
  time(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.orders.time(ctx, id);
  }

  /** `{ entries, more }`, newest first (CD-266). */
  @Get(':id/history')
  history(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Query(new ZodPipe(TaskHistoryQuery)) query: TaskHistoryQuery) {
    return this.orders.history(ctx, id, query);
  }

  /** The checklist (CD-266): `{ id, text, done, position }[]`; every change answers with it. */
  @Get(':id/checklist')
  checklist(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.orders.checklist(ctx, id);
  }

  @Post(':id/checklist')
  addItem(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(AddWorkOrderItem)) body: AddWorkOrderItem) {
    return this.orders.addItem(ctx, id, body);
  }

  @Patch(':id/checklist/:itemId')
  updateItem(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('itemId', Id) itemId: string, @Body(new ZodPipe(UpdateWorkOrderItem)) body: UpdateWorkOrderItem) {
    return this.orders.updateItem(ctx, id, itemId, body);
  }

  @Delete(':id/checklist/:itemId')
  removeItem(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('itemId', Id) itemId: string) {
    return this.orders.removeItem(ctx, id, itemId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.orders.remove(ctx, id);
  }
}
