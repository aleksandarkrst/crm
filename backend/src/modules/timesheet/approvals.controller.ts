import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { ApprovalsService } from './approvals.service';
import { ApprovalsQuery, ApproveDays, ReturnDays, UnlockDays, WeekQuery } from './timesheet.schemas';

/**
 * Approvals (CD-157): the weeks the caller approves. The list: `{ weekStart, weekNumber, label,
 * thisWeek, deadline, deadlinePassed, approvalMode, timeFormat, rows: { employee, right, status,
 * statusLabel, late, autoSubmitted, days, enteredMinutes, expectedMinutes, missing, waiting,
 * returned, approvable }[] }`. One person's week and every decision answer `{ week, right }`, the
 * week as GET /api/timesheet/week gives it.
 */
@Controller('timesheet/approvals')
@RequireTenant('member')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** `?week=<Monday>`; without it the latest week whose deadline has passed. */
  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(ApprovalsQuery)) query: ApprovalsQuery) {
    return this.approvals.list(ctx, query.week);
  }

  @Get(':employeeId/week')
  personWeek(@Tenant() ctx: TenantContext, @Param('employeeId', new ZodPipe(UuidParam)) employeeId: string, @Query(new ZodPipe(WeekQuery)) query: WeekQuery) {
    return this.approvals.personWeek(ctx, employeeId, query.week);
  }

  /** The week (Whole week mode), or `dates` of it (Day by day). */
  @Post('approve')
  approve(@Tenant() ctx: TenantContext, @Body(new ZodPipe(ApproveDays)) body: ApproveDays) {
    return this.approvals.approve(ctx, body.employeeId, body.weekStart, body.dates);
  }

  /** The Submitted days (or `dates` of them) go back to the employee with the comment. */
  @Post('return')
  return(@Tenant() ctx: TenantContext, @Body(new ZodPipe(ReturnDays)) body: ReturnDays) {
    return this.approvals.return(ctx, body.employeeId, body.weekStart, body.comment, body.dates);
  }

  /** Admins only (CD-159): approved days (or `dates` of them) go back to the employee as Rejected, with the reason. */
  @Post('unlock')
  unlock(@Tenant() ctx: TenantContext, @Body(new ZodPipe(UnlockDays)) body: UnlockDays) {
    return this.approvals.unlock(ctx, body.employeeId, body.weekStart, body.reason, body.dates);
  }

  /** The week's history (CD-159): `{ events, changes }`, oldest first; for the employee, their approvers and Admins. */
  @Get(':employeeId/history')
  history(@Tenant() ctx: TenantContext, @Param('employeeId', new ZodPipe(UuidParam)) employeeId: string, @Query(new ZodPipe(WeekQuery)) query: WeekQuery) {
    return this.approvals.history(ctx, employeeId, query.week);
  }
}
