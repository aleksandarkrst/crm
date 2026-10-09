import { Controller, Get } from '@nestjs/common';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { ProjectReportsService } from './project-reports.service';

/**
 * The Workload report (CD-261, design v2 §9): remaining task hours per person and week across open
 * projects, by team. `{ weeks: monday[], teams: { name, rows: { employeeId, name, jobTitle, cells:
 * minutes[], projects: string[] }[] }[] }`. Read-only; every member.
 */
@Controller('workload')
@RequireTenant('member')
export class WorkloadController {
  constructor(private readonly reports: ProjectReportsService) {}

  @Get()
  workload(@Tenant() ctx: TenantContext) {
    return this.reports.workload(ctx);
  }
}
