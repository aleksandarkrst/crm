import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { DocumentGenerator } from '../modules/crm';
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
    private readonly documents: DocumentGenerator,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('crm.generate-document', ({ tenantId, documentId }, attempt) => this.documents.run(tenantId, documentId, attempt));

    await this.jobs.work('reporting.nightly', async () => {
      await this.documents.failInterrupted();
      this.logger.log('Nightly reporting job ran (placeholder)');
    });
    await this.jobs.schedule('reporting.nightly', '0 2 * * *');

    this.logger.log('Worker ready');
  }
}
