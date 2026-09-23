import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { ActivitiesService, CreateActivity } from './activities.service';
import { CreateDeal, DealsQuery, DealsService, MoveDeal, UpdateDeal } from './deals.service';

const Id = new ZodPipe(UuidParam);

@Controller('crm/deals')
@RequireTenant('member')
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly activities: ActivitiesService,
  ) {}

  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(DealsQuery)) query: DealsQuery) {
    return this.deals.list(ctx, query);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.deals.get(ctx, id);
  }

  @Post()
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateDeal)) body: CreateDeal) {
    return this.deals.create(ctx, body);
  }

  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateDeal)) body: UpdateDeal) {
    return this.deals.update(ctx, id, body);
  }

  /** Pipeline drag & drop and "Advance to <stage>". */
  @Post(':id/move')
  @HttpCode(200)
  move(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(MoveDeal)) body: MoveDeal) {
    return this.deals.moveToStage(ctx, id, body.stageId);
  }

  @Put(':id/contacts/:contactId')
  @HttpCode(204)
  linkContact(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('contactId', Id) contactId: string) {
    return this.deals.linkContact(ctx, id, contactId);
  }

  @Delete(':id/contacts/:contactId')
  @HttpCode(204)
  unlinkContact(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('contactId', Id) contactId: string) {
    return this.deals.unlinkContact(ctx, id, contactId);
  }

  @Get(':id/activities')
  listActivities(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.activities.list(ctx, id);
  }

  /** Composer "Send & log", "Save note", "Log call", completed to-dos. */
  @Post(':id/activities')
  logActivity(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(CreateActivity)) body: CreateActivity) {
    return this.activities.create(ctx, id, body);
  }

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.deals.remove(ctx, id);
  }
}
