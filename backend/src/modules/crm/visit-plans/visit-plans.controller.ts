import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../../shared/authorization';
import { UuidParam } from '../../../shared/validation/common';
import { ZodPipe } from '../../../shared/validation/zod-validation.pipe';
import { parseVersion } from '../history/record-history.service';
import { CreateVisitPlan, UpdateVisitPlan, VisitPlansQuery, VisitPlansService } from './visit-plans.service';
import { ProgressBatchQuery, ProgressSummaryQuery, VisitProgressService, VisitReportQuery } from './visit-progress.service';

const Id = new ZodPipe(UuidParam);

/**
 * Customer visit plans (CD-134). Who sees and manages whose plans follows the permission matrix
 * (VisitScope, CD-142): everyone their own (read-only), managers their reports' (and they create,
 * change and delete their direct reports'), owners and admins all. Planned vs. held visits
 * (CD-135): a plan's progress, the totals of several plans, the Overview summary and the report
 * (owners, admins and managers), each limited to the plans the caller sees.
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

  /** Whose plans the caller sees and manages: `{ all, manageAll, seesTeam, visibleUserIds, manageableUserIds }`. */
  @Get('scope')
  scope(@Tenant() ctx: TenantContext) {
    return this.plans.scopeView(ctx);
  }

  /** `?ids=` → `{ progress: [{ planId, totals }] }` (the list's completion column). */
  @Get('progress')
  progressBatch(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ProgressBatchQuery)) query: ProgressBatchQuery) {
    return this.tracking.batch(ctx, query.ids);
  }

  /** Reports → Visit-plan completion: `?periodType=&periodStart=&salespersonUserId=&companyId=`. */
  @Get('report')
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
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateVisitPlan)) body: CreateVisitPlan) {
    return this.plans.create(ctx, body);
  }

  /** `lines` replaces the plan's lines. `If-Match: <updatedAt>` makes it fail with 409 if someone changed these fields since (CD-20). */
  @Patch(':id')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateVisitPlan)) body: UpdateVisitPlan, @Headers('if-match') ifMatch?: string) {
    return this.plans.update(ctx, id, body, parseVersion(ifMatch));
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.plans.remove(ctx, id);
  }
}
