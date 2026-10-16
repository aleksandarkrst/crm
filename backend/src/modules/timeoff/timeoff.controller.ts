import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { BalancesService } from './balances.service';
import { EntitlementsService } from './entitlements.service';
import { TimeoffPoliciesService } from './policies.service';
import { BalanceQuery, BalancesQuery, BulkChangePolicy, BulkRecalculate, CreateAdjustment, CreatePolicy, HistoryQuery, Recalculate, UpdateEntitlement, UpdatePolicy, UpdateProfile, YearParam } from './timeoff.schemas';

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
  ) {}

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
