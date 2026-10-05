import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { CreateVisitPlan, UpdateVisitPlan, VisitPlansQuery, VisitPlansService } from './visit-plans.service';
import { ProgressBatchQuery, ProgressSummaryQuery, VisitProgressService, VisitReportQuery } from './visit-progress.service';

const Id = new ZodPipe(UuidParam);

/**
 * Customer visit plans (CD-134). Everyone reads (members only their own plans); owners and admins
 * create, change and delete them. Planned vs. held visits (CD-135): a plan's progress, the totals
 * of several plans, the Overview summary (members: their own) and the report (owners and admins).
 */
@Controller('crm/visit-plans')
@RequireTenant('member')
export class VisitPlansController {
  constructor(
    private readonly plans: VisitPlansService,
    private readonly tracking: VisitProgressService,
  ) {}

  /** `?periodType=&periodStart=&salespersonUserId=&ids=` → `{ plans }`, newest period first. */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(VisitPlansQuery)) query: VisitPlansQuery) {
    return this.plans.list(ctx, query);
  }

  /** `?ids=` → `{ progress: [{ planId, totals }] }` (the list's completion column). */
  @Get('progress')
  progressBatch(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ProgressBatchQuery)) query: ProgressBatchQuery) {
    return this.tracking.batch(ctx, query.ids);
  }

  /** Reports → Visit-plan completion: `?periodType=&periodStart=&salespersonUserId=&companyId=`. */
  @Get('report')
  @RequireTenant('admin')
  report(@Tenant() ctx: TenantContext, @Query(new ZodPipe(VisitReportQuery)) query: VisitReportQuery) {
    return this.tracking.report(ctx, query);
  }

  /** The Overview card: `?periodType=&periodStart=[&salespersonUserId=|&all=1][&companyId=]`; members get their own. */
  @Get('progress-summary')
  summary(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ProgressSummaryQuery)) query: ProgressSummaryQuery) {
    return this.tracking.summary(ctx, query);
  }

  @Get(':id/progress')
  progress(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.tracking.progress(ctx, id);
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
