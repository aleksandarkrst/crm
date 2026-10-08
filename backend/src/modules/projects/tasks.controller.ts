import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { AssignTask, CreateTask, ListTasksQuery, SetHourLimit, TaskHistoryQuery, UpdateTask } from './tasks.schemas';
import { TasksService } from './tasks.service';

const Id = new ZodPipe(UuidParam);

/**
 * Project tasks (CD-146). Only tasks the caller can see exist for them (404 otherwise; the rules
 * are in task-access.ts). A task: `{ id, number, name, projectId, projectName, projectCode,
 * projectStatus, projectLeadUserId, companyId, companyName, stageId, stageName, stagePosition,
 * status, onHoldReason, description, startDate, dueDate, estimateHours, doneAt, createdAt, version,
 * assignees: { employeeId, name, jobTitle, active, hasAccount, formerMember, hourLimit }[], access: 'act' |
 * 'read', canManage }`. Changes answer with the task.
 */
@Controller('tasks')
@RequireTenant('member')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** `?projectId=`, `?assigneeId=<employeeId|me>`, `?status=`, `?q=` (name, "T-12", project name). */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ListTasksQuery)) query: ListTasksQuery) {
    return this.tasks.list(ctx, query);
  }

  /** The caller's tasks they can log time on now (milestone 15's Timesheet): `{ id, number, name, status, projectId, projectName }[]`. */
  @Get('loggable')
  loggable(@Tenant() ctx: TenantContext) {
    return this.tasks.loggable(ctx);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.tasks.get(ctx, id);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateTask)) body: CreateTask) {
    return this.tasks.create(ctx, body);
  }

  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateTask)) body: UpdateTask) {
    return this.tasks.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.tasks.remove(ctx, id);
  }

  @Post(':id/assignees')
  assign(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(AssignTask)) body: AssignTask) {
    return this.tasks.assign(ctx, id, body);
  }

  /** Someone's hour limit (CD-147): the lead, owners and admins. Answers with the task. */
  @Patch(':id/assignees/:employeeId')
  setHourLimit(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('employeeId', Id) employeeId: string, @Body(new ZodPipe(SetHourLimit)) body: SetHourLimit) {
    return this.tasks.setHourLimit(ctx, id, employeeId, body);
  }

  /**
   * The People and hours card (CD-147): `{ rows: { employeeId, name, jobTitle, active, formerMember,
   * hourLimit, visible, logged, approved, remaining, usedPercent, level, over }[], total: { logged,
   * approved, taskLimit, remaining, someWithoutLimit } }`. Hidden hours are null.
   */
  @Get(':id/hours')
  hours(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.tasks.hours(ctx, id);
  }

  @Delete(':id/assignees/:employeeId')
  unassign(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('employeeId', Id) employeeId: string) {
    return this.tasks.unassign(ctx, id, employeeId);
  }

  /** `{ entries, more }`, newest first, in the CRM history's shape. */
  @Get(':id/history')
  history(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Query(new ZodPipe(TaskHistoryQuery)) query: TaskHistoryQuery) {
    return this.tasks.history(ctx, id, query);
  }
}
