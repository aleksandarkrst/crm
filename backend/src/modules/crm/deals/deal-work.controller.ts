import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { PaginationQuery, UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { CreateDealLine, DealLinesService, UpdateDealLine } from './deal-lines.service';
import { CreateExtraTask, DealTasksService, UpdateTask, UpsertPlaybookTask } from './deal-tasks.service';

const Id = new ZodPipe(UuidParam);
const Page = new ZodPipe(PaginationQuery);

/** Deal lines (products & payment schedules) and stage to-dos. */
@Controller('crm')
@RequireTenant('member')
export class DealWorkController {
  constructor(
    private readonly lines: DealLinesService,
    private readonly tasks: DealTasksService,
  ) {}

  // ------------------------------------------------------------ deal lines
  @Get('deal-lines')
  listLines(@Tenant() ctx: TenantContext, @Query(Page) page: PaginationQuery) {
    return this.lines.list(ctx, page);
  }

  @Post('deals/:id/lines')
  createLine(@Tenant() ctx: TenantContext, @Param('id', Id) dealId: string, @Body(new ZodPipe(CreateDealLine)) body: CreateDealLine) {
    return this.lines.create(ctx, dealId, body);
  }

  @Patch('deal-lines/:lineId')
  updateLine(@Tenant() ctx: TenantContext, @Param('lineId', Id) id: string, @Body(new ZodPipe(UpdateDealLine)) body: UpdateDealLine) {
    return this.lines.update(ctx, id, body);
  }

  @Delete('deal-lines/:lineId')
  @HttpCode(204)
  removeLine(@Tenant() ctx: TenantContext, @Param('lineId', Id) id: string) {
    return this.lines.remove(ctx, id);
  }

  // ------------------------------------------------------------ stage to-dos
  @Get('deal-tasks')
  listTasks(@Tenant() ctx: TenantContext, @Query(Page) page: PaginationQuery) {
    return this.tasks.list(ctx, page);
  }

  /** Ticks / annotates a playbook to-do (created on first touch). */
  @Put('deals/:id/tasks/playbook')
  upsertPlaybookTask(@Tenant() ctx: TenantContext, @Param('id', Id) dealId: string, @Body(new ZodPipe(UpsertPlaybookTask)) body: UpsertPlaybookTask) {
    return this.tasks.upsertPlaybook(ctx, dealId, body);
  }

  /** Adds an off-playbook to-do. */
  @Post('deals/:id/tasks')
  createTask(@Tenant() ctx: TenantContext, @Param('id', Id) dealId: string, @Body(new ZodPipe(CreateExtraTask)) body: CreateExtraTask) {
    return this.tasks.createExtra(ctx, dealId, body);
  }

  @Patch('deal-tasks/:taskId')
  updateTask(@Tenant() ctx: TenantContext, @Param('taskId', Id) id: string, @Body(new ZodPipe(UpdateTask)) body: UpdateTask) {
    return this.tasks.update(ctx, id, body);
  }

  @Delete('deal-tasks/:taskId')
  @HttpCode(204)
  removeTask(@Tenant() ctx: TenantContext, @Param('taskId', Id) id: string) {
    return this.tasks.remove(ctx, id);
  }
}
