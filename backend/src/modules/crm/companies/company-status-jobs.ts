import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from '../../../shared/database/database.service';
import { JobsService } from '../../../shared/events/jobs.service';
import { CompanyStatusService } from './company-status.service';

/**
 * Worker side of the company status (CD-358): projects send `projects.company-projects-changed`
 * when a company's projects change (projects doesn't write CRM tables), and the companies' status
 * is recomputed (Client, Past client), attributed to the person who changed the project.
 */
@Injectable()
export class CompanyStatusJobs implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly status: CompanyStatusService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('projects.company-projects-changed', ({ tenantId, companyIds, actorUserId }) =>
      this.database.withTenant(tenantId, (tx) => this.status.recompute(tx, { tenantId, userId: actorUserId }, companyIds)),
    );
  }
}
