import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../../shared/database/database.service';
import { activities, deals } from '../../../shared/database/schema';
import { JobsService } from '../../../shared/events/jobs.service';

/**
 * Worker side of projects created from a deal (CD-275): "projects.project-created-from-deal" puts
 * "Project created · <name>" on the deal's timeline, by the person who created it (a system entry,
 * no channel). A deal deleted since is skipped.
 */
@Injectable()
export class ProjectLinkJobs implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('projects.project-created-from-deal', ({ tenantId, dealId, projectName, actorUserId }) =>
      this.database.withTenant(tenantId, async (tx) => {
        const [deal] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, dealId));
        if (!deal) return;
        await tx.insert(activities).values({ tenantId, dealId, actorUserId, channel: null, title: `Project created · ${projectName}`, detail: null });
      }),
    );
  }
}
