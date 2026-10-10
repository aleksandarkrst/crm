import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { UuidParam } from '../../shared/validation/common';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { AddRow, CopyWeek, CreateEntry, SetCell, SubmitWeek, UpdateEntry, WeekAction, WeekQuery } from './timesheet.schemas';
import { TimesheetService } from './timesheet.service';

/**
 * The caller's own weekly timesheet (CD-152). A week: `{ weekStart, weekNumber, label, today,
 * thisWeek, deadline: { date, time }, settings: { dayMinutes, maxDayMinutes, timeFormat }, employee,
 * status, statusLabel, submittable, canRecall, days: { date, status, submittedAt, expectedMinutes,
 * minutes, required, editable }[], rows: { key, kind, id, code, name, path, lockedReason, edit, limit,
 * cells: { [date]: { minutes, note, entries } }, minutes }[] }`. Changes answer with the week.
 */
@Controller('timesheet')
@RequireTenant('member')
export class TimesheetController {
  constructor(private readonly timesheet: TimesheetService) {}

  /** Employee card: own record, managers above and Admins only (CD-161). */
  @Get('employees/:id/late')
  employeeLate(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.timesheet.employeeLate(ctx, id);
  }

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

  /** Submit week; with `date`, that day only (Day by day mode, CD-156). */
  @Post('submit')
  submit(@Tenant() ctx: TenantContext, @Body(new ZodPipe(SubmitWeek)) body: SubmitWeek) {
    return this.timesheet.submit(ctx, body.weekStart, body.date);
  }

  /** An entry from the task or work order page (CD-276): `{ id, date, minutes, note, startTime, endTime }`. */
  @Post('entries')
  createEntry(@Tenant() ctx: TenantContext, @Body(new ZodPipe(CreateEntry)) body: CreateEntry) {
    return this.timesheet.createEntry(ctx, body);
  }

  @Patch('entries/:id')
  updateEntry(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string, @Body(new ZodPipe(UpdateEntry)) body: UpdateEntry) {
    return this.timesheet.updateEntry(ctx, id, body);
  }

  @Delete('entries/:id')
  @HttpCode(204)
  removeEntry(@Tenant() ctx: TenantContext, @Param('id', new ZodPipe(UuidParam)) id: string) {
    return this.timesheet.removeEntry(ctx, id);
  }

  @Post('recall')
  recall(@Tenant() ctx: TenantContext, @Body(new ZodPipe(WeekAction)) body: WeekAction) {
    return this.timesheet.recall(ctx, body.weekStart);
  }
}
