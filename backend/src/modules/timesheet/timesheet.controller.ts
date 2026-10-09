import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { AddRow, CopyWeek, SetCell, WeekAction, WeekQuery } from './timesheet.schemas';
import { TimesheetService } from './timesheet.service';

/**
 * The caller's own weekly timesheet (CD-152). A week: `{ weekStart, weekNumber, label, today,
 * thisWeek, deadline: { date, time }, settings: { dayMinutes, maxDayMinutes, timeFormat }, employee,
 * status, statusLabel, submittable, canRecall, days: { date, status, submittedAt, expectedMinutes,
 * minutes, required, editable }[], rows: { key, kind, id, code, name, path, lockedReason, limit,
 * cells: { [date]: { minutes, note, entries } }, minutes }[] }`. Changes answer with the week.
 */
@Controller('timesheet')
@RequireTenant('member')
export class TimesheetController {
  constructor(private readonly timesheet: TimesheetService) {}

  /** `?week=<Monday>`, this week by default. */
  @Get('week')
  week(@Tenant() ctx: TenantContext, @Query(new ZodPipe(WeekQuery)) query: WeekQuery) {
    return this.timesheet.week(ctx, query.week);
  }

  /** "+ Add task or work order": `{ kind, id, code, name, path }[]`. */
  @Get('loggable')
  loggable(@Tenant() ctx: TenantContext) {
    return this.timesheet.loggable(ctx);
  }

  @Put('cells')
  setCell(@Tenant() ctx: TenantContext, @Body(new ZodPipe(SetCell)) body: SetCell) {
    return this.timesheet.setCell(ctx, body);
  }

  @Post('rows')
  addRow(@Tenant() ctx: TenantContext, @Body(new ZodPipe(AddRow)) body: AddRow) {
    return this.timesheet.addRow(ctx, body);
  }

  /** Copy last week's dialog: `{ fromWeek, toWeek, rows, skipped: { label, reason }[] }`. */
  @Get('copy')
  copyPreview(@Tenant() ctx: TenantContext, @Query(new ZodPipe(WeekAction)) query: WeekAction) {
    return this.timesheet.copyPreview(ctx, query.weekStart);
  }

  /** `{ week, copiedRows, copiedCells, skipped, fullDays }`. */
  @Post('copy')
  copy(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CopyWeek)) body: CopyWeek) {
    return this.timesheet.copy(ctx, body);
  }

  @Post('submit')
  submit(@Tenant() ctx: TenantContext, @Body(new ZodPipe(WeekAction)) body: WeekAction) {
    return this.timesheet.submit(ctx, body.weekStart);
  }

  @Post('recall')
  recall(@Tenant() ctx: TenantContext, @Body(new ZodPipe(WeekAction)) body: WeekAction) {
    return this.timesheet.recall(ctx, body.weekStart);
  }
}
