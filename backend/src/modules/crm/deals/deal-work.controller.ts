import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { PaginationQuery, UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { DealLinesService, SaveDealProducts } from './deal-lines.service';
import { CreateExtraTask, DealTasksService, UpdateTask, UpsertPlaybookTask } from './deal-tasks.service';
import { StageHistoryQuery, StageHistoryService } from './stage-history.service';

const Id = new ZodPipe(UuidParam);
const Page = new ZodPipe(PaginationQuery);

/** Deal products (lines), stage to-dos and stage history. */
@Controller('crm')
@RequireTenant('member')
export class DealWorkController {
  constructor(
    private readonly lines: DealLinesService,
    private readonly tasks: DealTasksService,
    private readonly history: StageHistoryService,
  ) {}

  // ------------------------------------------------------------ deal lines
  @Get('deal-lines')
  listLines(@Tenant() ctx: TenantContext, @Query(Page) page: PaginationQuery) {
    return this.lines.list(ctx, page);
  }

  /** Saves a deal's products, currency, tax mode, discounts and installments together (CD-83). */
  @Put('deals/:id/products')
  saveProducts(@Tenant() ctx: TenantContext, @Param('id', Id) dealId: string, @Body(new ZodPipe(SaveDealProducts)) body: SaveDealProducts) {
    return this.lines.save(ctx, dealId, body);
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

  // ------------------------------------------------------------ stage history
  /** Every stage and outcome change, oldest first (Overview computes conversion metrics from it). */
  @Get('deal-stage-history')
  listStageHistory(@Tenant() ctx: TenantContext, @Query(new ZodPipe(StageHistoryQuery)) query: StageHistoryQuery) {
    return this.history.list(ctx, query);
  }
}
