import { Module } from '@nestjs/common';
import { ConfigModule } from './infrastructure/config/config.module';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { HealthController } from './modules/health/health.controller';
import { CrmModule } from './modules/crm';
import { IdentityModule } from './modules/identity';
import { AuditModule } from './shared/audit/audit.module';
import { DatabaseModule } from './shared/database/database.module';
import { EventsModule } from './shared/events/events.module';

/**
 * The HTTP API. Business modules live in src/modules; add new domains (projects, workforce,
 * reporting, integrations) as sibling modules and register them here.
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule,
    StorageModule,
    AuditModule,
    EventsModule.forRole('api'),
    IdentityModule,
    CrmModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
