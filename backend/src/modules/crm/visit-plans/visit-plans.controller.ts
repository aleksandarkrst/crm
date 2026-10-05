import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { CreateVisitPlan, UpdateVisitPlan, VisitPlansQuery, VisitPlansService } from './visit-plans.service';

const Id = new ZodPipe(UuidParam);

/**
 * Customer visit plans (CD-134). Everyone reads (members only their own plans); owners and admins
 * create, change and delete them.
 */
@Controller('crm/visit-plans')
@RequireTenant('member')
export class VisitPlansController {
  constructor(private readonly plans: VisitPlansService) {}

  /** `?periodType=&periodStart=&salespersonUserId=&ids=` → `{ plans }`, newest period first. */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(VisitPlansQuery)) query: VisitPlansQuery) {
    return this.plans.list(ctx, query);
  }

  @Get(':id')
  get(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.plans.get(ctx, id);
  }

  @Post()
  @RequireTenant('admin')
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateVisitPlan)) body: CreateVisitPlan) {
    return this.plans.create(ctx, body);
  }

  /** `lines` replaces the plan's lines. `If-Match: <updatedAt>` makes it fail with 409 if someone changed these fields since (CD-20). */
  @Patch(':id')
  @RequireTenant('admin')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateVisitPlan)) body: UpdateVisitPlan, @Headers('if-match') ifMatch?: string) {
    return this.plans.update(ctx, id, body, parseVersion(ifMatch));
  }

  @Delete(':id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.plans.remove(ctx, id);
  }
}
