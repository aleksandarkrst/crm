import { Controller, Get, Header, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { TimeReportQuery, TimeReportService } from './time-report.service';

/**
 * The time report (CD-149, spec 10.2): `?groupBy=project|person`, `?period=all|this_month|
 * last_month|this_quarter|this_year|range` (with `from` and `to`), and the filters `companyId`,
 * `projectTypeId`, `projectId`, `unitId`, `leadUserId`, `employeeId`, `status`, `onlyOver80=true`.
 * Every member reads it (each sees the people they may see); the CSV is for admins, leads and managers.
 */
@Controller('time-report')
@RequireTenant('member')
export class TimeReportController {
  constructor(private readonly reports: TimeReportService) {}

  /** `{ groupBy, period: { from, to } | null, rows: node[], total }`; a node: see `ReportNode` in time-report.ts. */
  @Get()
  report(@Tenant() ctx: TenantContext, @Query(new ZodPipe(TimeReportQuery)) query: TimeReportQuery) {
    return this.reports.report(ctx, query);
  }

  /** The same view as CSV (UTF-8 with a BOM, formula guard, like the CRM exports). */
  @Get('csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pultly-time-report.csv"')
  @Header('Cache-Control', 'private, no-store')
  csv(@Tenant() ctx: TenantContext, @Query(new ZodPipe(TimeReportQuery)) query: TimeReportQuery) {
    return this.reports.csv(ctx, query);
  }
}
