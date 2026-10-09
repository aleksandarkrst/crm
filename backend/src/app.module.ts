import { Module } from '@nestjs/common';
import { ConfigModule } from './infrastructure/config/config.module';
import { loadEnv } from './infrastructure/config/env';
import { LoggingModule } from './infrastructure/logging/logging.module';
import { DevMailModule } from './infrastructure/mail/mail.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { HealthController } from './modules/health/health.controller';
import { CrmModule } from './modules/crm';
import { IdentityModule } from './modules/identity';
import { NotificationsDevModule, NotificationsModule } from './modules/notifications';
import { PeopleDevModule, PeopleModule } from './modules/people';
import { ProjectsDevModule, ProjectsModule } from './modules/projects';
import { TimesheetModule } from './modules/timesheet';
import { RealtimeModule } from './modules/realtime';
import { AuditModule } from './shared/audit/audit.module';
import { DatabaseModule } from './shared/database/database.module';
import { EventsModule } from './shared/events/events.module';
import { RateLimitModule } from './shared/rate-limit';

/**
 * The HTTP API. Business modules live in src/modules; add new domains (projects, workforce,
 * reporting, integrations) as sibling modules and register them here.
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ...(loadEnv().RATE_LIMIT_ENABLED ? [RateLimitModule] : []),
    DatabaseModule,
    StorageModule,
    AuditModule,
    EventsModule.forRole('api'),
    IdentityModule,
    CrmModule,
    NotificationsModule,
    PeopleModule,
    ProjectsModule,
    TimesheetModule,
    // Development only: the emails the log mail driver "sent" (GET /api/dev/mail), and sending
    // your daily digest now (POST /api/dev/digest), the daily deactivation job (POST /api/dev/people/deactivate-due),
    // and stand-in hours on a task until time entries exist (POST /api/dev/tasks/:id/hours, CD-147).
    ...(loadEnv().AUTH_MODE === 'dev' ? [DevMailModule, NotificationsDevModule, PeopleDevModule, ProjectsDevModule] : []),
    RealtimeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
