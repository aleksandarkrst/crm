import { Body, Controller, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { JobsService } from '../../shared/events/jobs.service';
import { RateLimit } from '../../shared/rate-limit';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { BulkInvite, DeactivateDueNow, DeactivateEmployee, InviteEmployee, LinkMember, ReactivateEmployee } from './lifecycle.schemas';
import { EmployeeLifecycleService } from './lifecycle.service';

const Id = new ZodPipe(UuidParam);

/**
 * An employee's app access and leaving (milestone 13, spec 4.6–4.8). Who may do what is checked in
 * EmployeeLifecycleService through PeopleAccess: invitations, linking and unlinking are for Admins,
 * deactivating and reactivating for Admins.
 */
@Controller('people/employees')
@RequireTenant('member')
export class LifecycleController {
  constructor(private readonly lifecycle: EmployeeLifecycleService) {}

  /** "Invite selected": `{ employeeIds, role }` → `{ queued, skipped }`; a job creates the invitations. */
  @Post('invite')
  @RateLimit('email')
  @HttpCode(202)
  bulkInvite(@Tenant() ctx: TenantContext, @Body(new ZodPipe(BulkInvite)) body: BulkInvite) {
    return this.lifecycle.bulkInvite(ctx, body);
  }

  /** "Invite to Pultly": `{ role }` → `{ invitation, token, card }`. */
  @Post(':id/invite')
  @RateLimit('email')
  invite(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(InviteEmployee)) body: InviteEmployee) {
    return this.lifecycle.invite(ctx, id, body);
  }

  /** Members to link to this record, with whether their own record can be merged. */
  @Get(':id/link-candidates')
  linkCandidates(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.lifecycle.linkCandidates(ctx, id);
  }

  @Post(':id/link')
  @HttpCode(200)
  link(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(LinkMember)) body: LinkMember) {
    return this.lifecycle.link(ctx, id, body);
  }

  @Post(':id/unlink')
  @HttpCode(200)
  unlink(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.lifecycle.unlink(ctx, id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(DeactivateEmployee)) body: DeactivateEmployee) {
    return this.lifecycle.deactivate(ctx, id, body);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(ReactivateEmployee)) body: ReactivateEmployee) {
    return this.lifecycle.reactivate(ctx, id, body);
  }
}

/**
 * Development only (AUTH_MODE=dev): runs the daily deactivation job for the caller's workspace as
 * if it were `now` (default: now), so tests don't wait for midnight.
 */
@Controller('dev/people')
export class DevPeopleController {
  constructor(private readonly jobs: JobsService) {}

  @Post('deactivate-due')
  @RequireTenant('member')
  @HttpCode(202)
  async deactivateDue(@Tenant() ctx: TenantContext, @Body(new ZodPipe(DeactivateDueNow)) body: DeactivateDueNow) {
    await this.jobs.send('people.deactivate-due', { tenantId: ctx.tenantId, now: body.now });
    return { queued: true };
  }
}

@Module({ controllers: [DevPeopleController] })
export class PeopleDevModule {}
