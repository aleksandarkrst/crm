import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { TimesheetDeadlines } from './deadlines';
import { HolidaysService } from './holidays.service';
import { CopyHolidays, CreateHoliday, HolidaysQuery, UpdateHoliday } from './timesheet.schemas';

const Id = new ZodPipe(UuidParam);

/**
 * Public holidays (CD-153): `{ id, date, name, minutes }` (minutes off; null is the whole standard
 * day). Any member reads them; owners and admins change them. And the next submission deadline,
 * for Settings → Workforce → Approvals.
 */
@Controller('timesheet')
@RequireTenant('member')
export class HolidaysController {
  constructor(
    private readonly holidays: HolidaysService,
    private readonly deadlines: TimesheetDeadlines,
  ) {}

  /** `?year=2026`, this year by default. */
  @Get('holidays')
  list(@Query(new ZodPipe(HolidaysQuery)) query: HolidaysQuery, @Tenant() ctx: TenantContext) {
    return this.holidays.list(ctx, query.year ?? new Date().getUTCFullYear());
  }

  @Post('holidays')
  @RequireTenant('admin')
  create(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateHoliday)) body: CreateHoliday) {
    return this.holidays.create(ctx, body);
  }

  /** Copy from last year: `{ copied, holidays }` (the year's holidays). */
  @Post('holidays/copy')
  @RequireTenant('admin')
  @HttpCode(200)
  copy(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CopyHolidays)) body: CopyHolidays) {
    return this.holidays.copyFromLastYear(ctx, body.year);
  }

  @Patch('holidays/:id')
  @RequireTenant('admin')
  update(@Tenant() ctx: TenantContext, @Param('id', Id) id: string, @Body(new ZodPipe(UpdateHoliday)) body: UpdateHoliday) {
    return this.holidays.update(ctx, id, body);
  }

  @Delete('holidays/:id')
  @RequireTenant('admin')
  @HttpCode(204)
  remove(@Tenant() ctx: TenantContext, @Param('id', Id) id: string) {
    return this.holidays.remove(ctx, id);
  }

  /** The first deadline that hasn't passed: `{ weekStart, weekNumber, date, time }`. */
  @Get('deadline')
  deadline(@Tenant() ctx: TenantContext) {
    return this.deadlines.next(ctx);
  }
}
