import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobsService } from '../../shared/events/jobs.service';
import { HrDocumentsService } from './hr-documents.service';

/**
 * Generated legal documents (spec 10): the engine other modules queue documents on. No routes of
 * its own: the owning module (timeoff for vacation decisions) serves them under its permissions.
 */
@Module({ providers: [HrDocumentsService], exports: [HrDocumentsService] })
export class HrDocumentsModule {}

/** The worker's side: `documents.generate-pdf` renders and stores, `documents.email` delivers. */
@Injectable()
export class HrDocumentsJobs implements OnApplicationBootstrap {
  constructor(
    private readonly jobs: JobsService,
    private readonly documents: HrDocumentsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('documents.generate-pdf', (data, attempt) => this.documents.generate(data.tenantId, data.documentId, attempt));
    await this.jobs.work('documents.email', (data) => this.documents.email(data));
  }
}

@Module({ providers: [HrDocumentsService, HrDocumentsJobs], exports: [HrDocumentsService] })
export class HrDocumentsWorkerModule {}
