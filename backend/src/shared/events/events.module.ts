import { type DynamicModule, Global, Module } from '@nestjs/common';
import { JOBS_ROLE, type JobsRole, JobsService } from './jobs.service';
import { TenantProvisioning } from './tenant-provisioning';

/** Cross-module communication: background jobs and in-process tenant provisioning hooks. */
@Global()
@Module({})
export class EventsModule {
  static forRole(role: JobsRole): DynamicModule {
    return {
      module: EventsModule,
      providers: [{ provide: JOBS_ROLE, useValue: role }, JobsService, TenantProvisioning],
      exports: [JobsService, TenantProvisioning],
    };
  }
}
