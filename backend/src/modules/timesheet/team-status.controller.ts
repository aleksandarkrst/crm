import { Controller, Get, Query } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { TeamStatusService } from './team-status.service';
import { TeamStatusQuery } from './timesheet.schemas';

/**
 * Today's status (CD-162, spec 15 section 12): managers and Admins only, everyone else 403.
 * `{ date, today, minDate, maxDate, scope, updatedAt, rows: TeamStatusRow[] }`; `scope=reports`
 * keeps the caller's direct and indirect reports (the Today screen's Team today card).
 */
@Controller('timesheet/status')
@RequireTenant('member')
export class TeamStatusController {
  constructor(private readonly status: TeamStatusService) {}

  @Get()
  list(@Tenant() ctx: TenantContext, @Query(new ZodPipe(TeamStatusQuery)) query: TeamStatusQuery) {
    return this.status.list(ctx, query.date, query.scope ?? 'all');
  }
}
