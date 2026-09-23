import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { Tx } from '../database/database.service';
import { JOB_NAMES, type JobName, type JobPayloads } from './job-types';

export const JOBS_ROLE = Symbol('JOBS_ROLE');
/** "api" only sends jobs; "worker" also processes them and runs pg-boss maintenance and cron. */
export type JobsRole = 'api' | 'worker';

/**
 * Background jobs on pg-boss, a queue stored in PostgreSQL (schema "pgboss"), so no Redis is
 * needed. Add Redis later only if you need caching or much higher job throughput.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(JobsService.name);
  private readonly boss: PgBoss;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(JOBS_ROLE) private readonly role: JobsRole,
  ) {
    const isWorker = role === 'worker';
    this.boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: 'pgboss',
      // The schema is pre-created by infra/postgres/init (owned by the runtime role). The runtime
      // role has no CREATE on the database, and Postgres checks that privilege even for
      // "CREATE SCHEMA IF NOT EXISTS", so pg-boss must not try.
      createSchema: false,
      max: 4,
      supervise: isWorker,
      schedule: isWorker,
    });
    this.boss.on('error', (err) => this.logger.error(err));
  }

  async onModuleInit(): Promise<void> {
    // Both api and worker install/upgrade the pgboss schema and queues on start (pg-boss
    // serialises this with an advisory lock), so either may start first.
    await this.boss.start();
    for (const name of JOB_NAMES) {
      if (await this.boss.getQueue(name)) continue;
      try {
        await this.boss.createQueue(name);
      } catch (err) {
        if (!(await this.boss.getQueue(name))) throw err; // lost a race with the other process: fine
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true });
  }

  /**
   * Enqueues a job. Pass the current transaction so the job only exists if the business change
   * commits (no "deal marked won but handover job lost" failure mode).
   */
  async send<N extends JobName>(name: N, data: JobPayloads[N], tx?: Tx): Promise<void> {
    await this.boss.send(name, data, tx ? { db: fromDrizzle(tx, sql) } : undefined);
  }

  async work<N extends JobName>(name: N, handler: (data: JobPayloads[N], jobId: string) => Promise<void>): Promise<void> {
    await this.boss.work<JobPayloads[N]>(name, async (jobs) => {
      for (const job of jobs) await handler(job.data, job.id);
    });
  }

  async schedule(name: JobName, cron: string): Promise<void> {
    await this.boss.schedule(name, cron, {}, { tz: 'UTC' });
  }
}
