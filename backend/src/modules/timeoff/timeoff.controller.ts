import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { ApprovalsService } from './approvals.service';
import { BalancesService } from './balances.service';
import { DecisionsService } from './decisions.service';
import { EntitlementsService } from './entitlements.service';
import { TimeoffPoliciesService } from './policies.service';
import { ReasonsService } from './reasons.service';
import { RequestsService } from './requests.service';
import {
  Approve,
  BalanceQuery,
  BalancesQuery,
  BulkApprove,
  BulkChangePolicy,
  BulkRecalculate,
  CalendarQuery,
  Cancel,
  CreateAdjustment,
  CreatePolicy,
  CreateReason,
  CreateRequest,
  DecisionsQuery,
  HistoryQuery,
  PreviewRequest,
  ReasonsQuery,
  Recalculate,
  Regenerate,
  Reject,
  RequestsQuery,
  Shorten,
  UpdateEntitlement,
  UpdatePolicy,
  UpdateProfile,
  UpdateReason,
  UpdateTimeoffSettings,
  YearParam,
} from './timeoff.schemas';

const Id = new ZodPipe(UuidParam);
const Year = new ZodPipe(YearParam);
const History = new ZodPipe(HistoryQuery);

/**
 * Time off (milestone 16): the vacation policies and the employee's profile and entitlements
 * (CD-163). Any member reads the policies; Admins (workspace owners and admins) change them.
 * The employee routes check the caller through PeopleAccess: self, the managers above and Admins
 * see a profile, Admins change it.
 */
@Controller('timeoff')
@RequireTenant('member')
export class TimeoffController {
  constructor(
    private readonly policies: TimeoffPoliciesService,
    private readonly entitlements: EntitlementsService,
    private readonly balances: BalancesService,
    private readonly reasons: ReasonsService,
    private readonly requests: RequestsService,
    private readonly approvals: ApprovalsService,
    private readonly decisions: DecisionsService,
  ) {}

  // ---------------------------------------------------------------- vacation decisions (CD-167, spec 11)

  /** The Decisions tab (Admins): every decision version, newest first. */
  @Get('decisions')
  @RequireTenant('admin')
  listDecisions(@Tenant() ctx: TenantContext, @Query(new ZodPipe(DecisionsQuery)) query: DecisionsQuery) {
    return this.decisions.list(ctx, query);
  }

  /** The PDF: the employee's own, any for Admins (404 for everyone else). */
  @Get('decisions/:id/pdf')
  async decisionPdf(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Res({ passthrough: true }) res: Response) {
    const { name, content } = await this.decisions.pdf(ctx, id);
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(content);
  }

  /** "Confirm receipt" (spec 11.4): the employee. */
  @Post('decisions/:id/acknowledge')
  @HttpCode(200)
  acknowledgeDecision(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.decisions.acknowledge(ctx, id);
  }

  /** A new version with the same number (spec 11.5), Admins. */
  @Post('decisions/:id/regenerate')
  @RequireTenant('admin')
  regenerateDecision(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(Regenerate)) body: Regenerate) {
    return this.decisions.regenerate(ctx, id, body.email);
  }

  // ---------------------------------------------------------------- approvals (CD-166, spec 9)

  /** The pending requests the caller decides, with the balance after, who else is away and the warnings (spec 9.2). */
  @Get('approvals')
  listApprovals(@Tenant() ctx: TenantContext) {
    return this.approvals.list(ctx);
  }

  /** `{ pending }` for the sidebar badge. */
  @Get('approvals/count')
  approvalsCount(@Tenant() ctx: TenantContext) {
    return this.approvals.count(ctx);
  }

  /** "Approve selected": `{ approved: ids, failed: [{ id, message }] }`. */
  @Post('approvals/approve')
  @HttpCode(200)
  approveMany(@Tenant() ctx: TenantContext, @Body(new ZodPipe(BulkApprove)) body: BulkApprove) {
    return this.approvals.approveMany(ctx, body.ids, body.comment ?? null);
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  approve(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(Approve)) body: Approve) {
    return this.approvals.approve(ctx, id, body.comment ?? null);
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  reject(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(Reject)) body: Reject) {
    return this.approvals.reject(ctx, id, body.comment);
  }

  /** Cancel approved leave before it starts (spec 9.4). */
  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(Cancel)) body: Cancel) {
    return this.approvals.cancel(ctx, id, body.comment ?? null);
  }

  /** Shorten leave that started (spec 9.4): approvers and Admins. */
  @Post('requests/:id/shorten')
  @HttpCode(200)
  shorten(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(Shorten)) body: Shorten) {
    return this.approvals.shorten(ctx, id, body.endDate, body.comment);
  }

  /** The team calendar (spec 9.5). */
  @Get('calendar')
  calendar(@Tenant() ctx: TenantContext, @Query(new ZodPipe(CalendarQuery)) query: CalendarQuery) {
    return this.approvals.calendar(ctx, query);
  }

  // ---------------------------------------------------------------- reasons and settings (CD-165, spec 7.2, 7.3)

  @Get('reasons')
  listReasons(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ReasonsQuery)) query: ReasonsQuery) {
    return this.reasons.list(ctx, query.kind);
  }

  @Post('reasons')
  @RequireTenant('admin')
  createReason(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateReason)) body: CreateReason) {
    return this.reasons.create(ctx, body);
  }

  @Patch('reasons/:id')
  @RequireTenant('admin')
  updateReason(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateReason)) body: UpdateReason) {
    return this.reasons.update(ctx, id, body);
  }

  /** Only an unused reason (409 otherwise: deactivate it). */
  @Delete('reasons/:id')
  @RequireTenant('admin')
  @HttpCode(204)
  removeReason(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.reasons.remove(ctx, id);
  }

  /** `{ paidLeaveYearlyLimit }`. */
  @Get('settings')
  settings(@Tenant() ctx: TenantContext) {
    return this.reasons.settings(ctx);
  }

  @Patch('settings')
  @RequireTenant('admin')
  updateSettings(@Tenant() ctx: TenantContext, @Body(new ZodPipe(UpdateTimeoffSettings)) body: UpdateTimeoffSettings) {
    return this.reasons.updateSettings(ctx, body);
  }

  // ---------------------------------------------------------------- requests (CD-165, spec 8)

  /** Own by default; `?employeeId=` a report's (managers) or anyone's (Admins); `?all=true` everyone the caller may see. */
  @Get('requests')
  listRequests(@Tenant() ctx: TenantContext, @Query(new ZodPipe(RequestsQuery)) query: RequestsQuery) {
    return this.requests.list(ctx, query);
  }

  /** The working days, holidays inside, the balance before and after, warnings and the approver (spec 8.4). */
  @Post('requests/preview')
  @HttpCode(200)
  previewRequest(@Tenant() ctx: TenantContext, @Body(new ZodPipe(PreviewRequest)) body: PreviewRequest) {
    return this.requests.preview(ctx, body);
  }

  /** Submit (spec 8.3); Admins may request for anyone and `record` leave as approved (spec 8.7). */
  @Post('requests')
  createRequest(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateRequest)) body: CreateRequest) {
    return this.requests.create(ctx, body);
  }

  /** The request with its history (self, the managers above, Admins). */
  @Get('requests/:id')
  getRequest(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.requests.get(ctx, id);
  }

  /** A pending request is withdrawn by the employee or an Admin (spec 9.4). */
  @Post('requests/:id/withdraw')
  @HttpCode(200)
  withdrawRequest(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.requests.withdraw(ctx, id);
  }

  // ---------------------------------------------------------------- balances (CD-164)

  /** The Balances table (spec 6.5): Admins everyone, managers their reports. `?year=&unitId=&managerId=&policyId=&expiring=true`. */
  @Get('balances')
  balancesTable(@Tenant() ctx: TenantContext, @Query(new ZodPipe(BalancesQuery)) query: BalancesQuery) {
    return this.balances.table(ctx, query);
  }

  /** The same table as CSV (UTF-8 with a BOM). */
  @Get('balances/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pultly-vacation-balances.csv"')
  @Header('Cache-Control', 'private, no-store')
  balancesCsv(@Tenant() ctx: TenantContext, @Query(new ZodPipe(BalancesQuery)) query: BalancesQuery) {
    return this.balances.csv(ctx, query);
  }

  /** "Change policy" for the selected employees (Admins): `{ changed }`. */
  @Post('balances/policy')
  @RequireTenant('admin')
  @HttpCode(200)
  bulkPolicy(@Tenant() ctx: TenantContext, @Body(new ZodPipe(BulkChangePolicy)) body: BulkChangePolicy) {
    return this.balances.bulkChangePolicy(ctx, body);
  }

  /** Recalculate the year for the selected employees (Admins): `{ changed }`. */
  @Post('balances/recalculate')
  @RequireTenant('admin')
  @HttpCode(200)
  bulkRecalculate(@Tenant() ctx: TenantContext, @Body(new ZodPipe(BulkRecalculate)) body: BulkRecalculate) {
    return this.balances.bulkRecalculate(ctx, body);
  }

  /** One employee's balance and history for `?year=` (this year by default): self, the managers above, Admins. */
  @Get('employees/:id/balance')
  balance(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Query(new ZodPipe(BalanceQuery)) query: BalanceQuery) {
    return this.balances.balance(ctx, id, query.year);
  }

  /** An adjustment (Admins, spec 6.4); answers this year's balance (next year's for an adjustment of next year's pool). */
  @Post('employees/:id/adjustments')
  @RequireTenant('admin')
  adjust(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(CreateAdjustment)) body: CreateAdjustment) {
    return this.balances.adjust(ctx, id, body);
  }

  // ---------------------------------------------------------------- policies (Settings → Time off)

  @Get('policies')
  list(@Tenant() ctx: TenantContext) {
    return this.policies.list(ctx);
  }

  @Post('policies')
  @RequireTenant('admin')
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreatePolicy)) body: CreatePolicy) {
    return this.policies.create(ctx, body);
  }

  /** Answers the policy with `recalculated`: how many employees' entitlements changed. */
  @Patch('policies/:id')
  @RequireTenant('admin')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdatePolicy)) body: UpdatePolicy) {
    return this.policies.update(ctx, id, body);
  }

  @Delete('policies/:id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.policies.remove(ctx, id);
  }

  @Post('policies/:id/default')
  @RequireTenant('admin')
  @HttpCode(200)
  makeDefault(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.policies.makeDefault(ctx, id);
  }

  @Get('policies/:id/history')
  @RequireTenant('admin')
  policyHistory(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Query(History) query: HistoryQuery) {
    return this.policies.history(ctx, id, query);
  }

  // ---------------------------------------------------------------- the employee card's Time off section

  @Get('employees/:id/profile')
  profile(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.entitlements.profile(ctx, id);
  }

  @Patch('employees/:id/profile')
  @RequireTenant('admin')
  updateProfile(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateProfile)) body: UpdateProfile) {
    return this.entitlements.updateProfile(ctx, id, body);
  }

  @Patch('employees/:id/entitlements/:year')
  @RequireTenant('admin')
  updateEntitlement(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('year', Year) year: number, @Body(new ZodPipe(UpdateEntitlement)) body: UpdateEntitlement) {
    return this.entitlements.updateEntitlement(ctx, id, year, body);
  }

  /** `{ preview: true }` answers `{ before, after }` without saving. */
  @Post('employees/:id/entitlements/:year/recalculate')
  @RequireTenant('admin')
  @HttpCode(200)
  recalculate(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Param('year', Year) year: number, @Body(new ZodPipe(Recalculate)) body: Recalculate) {
    return this.entitlements.recalculate(ctx, id, year, body.preview);
  }

  @Get('employees/:id/history')
  employeeHistory(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Query(History) query: HistoryQuery) {
    return this.entitlements.history(ctx, id, query);
  }
}
