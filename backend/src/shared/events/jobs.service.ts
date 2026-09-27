import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { fromDrizzle, type JobResult, PgBoss } from 'pg-boss';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { reportError } from '../../infrastructure/monitoring';
import type { Tx } from '../database/database.service';
import { JOB_NAMES, type JobName, type JobPayloads, MAIL_JOBS } from './job-types';

/** What a handler learns about the attempt it runs in. */
export interface JobAttempt {
  id: string;
  /** 0 on the first attempt. */
  retryCount: number;
  retryLimit: number;
  /** True when a failure now is final: pg-boss won't retry it. */
  lastAttempt: boolean;
}

export interface SendOptions {
  /** Passed to pg-boss, which drops duplicates where the queue's policy allows; handlers stay idempotent anyway. */
  singletonKey?: string;
}

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
    @Inject(ENV) private readonly env: Env,
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
    this.boss.on('error', (err) => {
      this.logger.error(err);
      reportError(err, { tags: { component: 'pg-boss' } });
    });
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
  async send<N extends JobName>(name: N, data: JobPayloads[N], tx?: Tx, options: SendOptions = {}): Promise<void> {
    const retry = MAIL_JOBS.has(name) ? { retryLimit: this.env.MAIL_RETRY_LIMIT, retryDelay: this.env.MAIL_RETRY_DELAY_SECONDS, retryBackoff: true } : {};
    await this.boss.send(name, data, { ...retry, ...options, ...(tx ? { db: fromDrizzle(tx, sql) } : {}) });
  }

  /**
   * Runs `handler` for each job of the queue. Jobs are fetched up to 10 at a time and fetched
   * again straight away while batches come back full; each job succeeds or fails on its own, so
   * one failing email doesn't fail (and retry) the others in its batch.
   */
  async work<N extends JobName>(name: N, handler: (data: JobPayloads[N], attempt: JobAttempt) => Promise<void>): Promise<void> {
    const options = { includeMetadata: true, perJobResults: true, batchSize: 10, burstWhenBatchFull: true } as const;
    await this.boss.work<JobPayloads[N], unknown, typeof options>(name, options, async (jobs) => {
      const results: JobResult[] = [];
      for (const job of jobs) {
        try {
          await handler(job.data, { id: job.id, retryCount: job.retryCount, retryLimit: job.retryLimit, lastAttempt: job.retryCount >= job.retryLimit });
          results.push({ id: job.id, status: 'completed' });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Job ${name} ${job.id} failed (attempt ${job.retryCount + 1} of ${job.retryLimit + 1}): ${message}`);
          // Only when no retry is left: a send that works on the second try isn't worth an alert.
          if (job.retryCount >= job.retryLimit) reportError(err, { tags: { job: name } });
          results.push({ id: job.id, status: 'failed', output: { message } });
        }
      }
      return results;
    });
  }

  async schedule(name: JobName, cron: string): Promise<void> {
    await this.boss.schedule(name, cron, {}, { tz: 'UTC' });
  }
}
