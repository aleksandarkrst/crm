import { Module } from '@nestjs/common';
import { ConfigModule } from './infrastructure/config/config.module';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { DocumentGenerator } from './modules/crm';
import { AuditModule } from './shared/audit/audit.module';
import { DatabaseModule } from './shared/database/database.module';
import { EventsModule } from './shared/events/events.module';
import { JobHandlers } from './worker/job-handlers';

/** The background worker: same codebase and modules as the API, no HTTP server. */
@Module({
  imports: [ConfigModule, LoggingModule, DatabaseModule, StorageModule, AuditModule, EventsModule.forRole('worker')],
  providers: [JobHandlers, DocumentGenerator],
})
export class WorkerModule {}
