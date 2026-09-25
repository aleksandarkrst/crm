import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DocumentGenerator } from '../modules/crm';
import { DatabaseService } from '../shared/database/database.service';
import { deals } from '../shared/database/schema';
import { JobsService } from '../shared/events/jobs.service';

/**
 * Registers a handler for every job in shared/events/job-types.ts, plus cron schedules.
 * As modules grow, move each handler next to the module that owns it and register it here.
 */
@Injectable()
export class JobHandlers implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobHandlers.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly documents: DocumentGenerator,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('crm.deal-won', async ({ tenantId, dealId }) => {
      // Placeholder for the sales → delivery handover. When the projects module exists, this
      // creates the project from the won deal instead of only logging.
      const deal = await this.database.withTenant(tenantId, async (tx) => {
        const [row] = await tx.select({ id: deals.id, title: deals.title }).from(deals).where(eq(deals.id, dealId));
        return row;
      });
      this.logger.log(`Deal won: ${deal?.title ?? dealId} (tenant ${tenantId}) — handover not implemented yet`);
    });

    await this.jobs.work('crm.generate-document', ({ tenantId, documentId }) => this.documents.run(tenantId, documentId));

    await this.jobs.work('reporting.nightly', async () => {
      this.logger.log('Nightly reporting job ran (placeholder)');
    });
    await this.jobs.schedule('reporting.nightly', '0 2 * * *');

    this.logger.log('Worker ready');
  }
}
