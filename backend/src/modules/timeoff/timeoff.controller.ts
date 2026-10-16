import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { EntitlementsService } from './entitlements.service';
import { TimeoffPoliciesService } from './policies.service';
import { CreatePolicy, HistoryQuery, Recalculate, UpdateEntitlement, UpdatePolicy, UpdateProfile, YearParam } from './timeoff.schemas';

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
  ) {}

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
