import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { CreateWorkOrder, ListWorkOrdersQuery, UpdateWorkOrder } from './work-orders.schemas';
import { WorkOrdersService } from './work-orders.service';

const Id = new ZodPipe(UuidParam);

/**
 * Work orders (CD-265). A work order: `{ id, number, title, companyId, companyName, projectId,
 * projectName, projectCode, type, priority, status, holdReason, scheduledDate, scheduledStart,
 * durationHours, location, equipment, job, report, completedAt, createdAt, version, technicians:
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

  @Delete(':id')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.orders.remove(ctx, id);
  }
}
