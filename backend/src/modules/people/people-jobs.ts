import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { employees, tenants, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { JobsService } from '../../shared/events/jobs.service';
import { bankAccountEmail } from './bank-email';
import { ROLE_LABELS, roleChangedEmail } from './role-email';

/**
 * Worker side of the people module: the "Bank account changed" email (spec 10.2). It goes to the
 * employee's sign-in email when they have an account, otherwise to their work email, and to nobody
 * when they have neither. A deleted employee gets nothing. Retried like every email job.
 */
@Injectable()
export class BankAccountEmailJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(BankAccountEmailJob.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('people.bank-account-changed-email', (data) => this.run(data));
  }

  async run({ tenantId, employeeId, actorUserId, changes }: JobPayloads['people.bank-account-changed-email']): Promise<void> {
    const row = await this.database.withTenant(tenantId, async (tx) => {
      const [e] = await tx
        .select({
          fullName: employees.fullName,
          userId: employees.userId,
          workEmail: employees.workEmail,
          signInEmail: sql<string | null>`(select u.email from ${users} u where u.id = ${employees.userId})`,
          workspaceName: sql<string>`(select t.name from ${tenants} t where t.id = ${employees.tenantId})`,
        })
        .from(employees)
        .where(eq(employees.id, employeeId));
      const [actor] = actorUserId ? await tx.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email})` }).from(users).where(eq(users.id, actorUserId)) : [];
      return e ? { ...e, actorName: actor?.name ?? null } : null;
    });
    const to = row ? (row.signInEmail ?? row.workEmail) : null;
    if (!row || !to) {
      this.logger.log(`Bank account change of employee ${employeeId}: nobody to email`);
      return;
    }
    await this.mailer.send(
      bankAccountEmail({
        to,
        employeeName: row.fullName,
        actorName: row.actorName,
        self: !!actorUserId && actorUserId === row.userId,
        workspaceName: row.workspaceName,
        appUrl: this.env.APP_URL,
        employeeId,
        changes,
      }),
    );
  }
}

/**
 * "Role granted" / "Role removed" (spec 10.2, CD-142): to the employee's sign-in email when linked,
 * else their work email, else nobody. Sent even if the role changed again since: each change is
 * news. A deleted employee gets nothing.
 */
@Injectable()
export class RoleChangedEmailJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(RoleChangedEmailJob.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('people.role-changed-email', (data) => this.run(data));
  }

  async run({ tenantId, employeeId, role, kind, actorUserId }: JobPayloads['people.role-changed-email']): Promise<void> {
    const row = await this.database.withTenant(tenantId, async (tx) => {
      const [e] = await tx
        .select({
          fullName: employees.fullName,
          workEmail: employees.workEmail,
          signInEmail: sql<string | null>`(select u.email from ${users} u where u.id = ${employees.userId})`,
          workspaceName: sql<string>`(select t.name from ${tenants} t where t.id = ${employees.tenantId})`,
        })
        .from(employees)
        .where(eq(employees.id, employeeId));
      const [actor] = await tx.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email})` }).from(users).where(eq(users.id, actorUserId));
      return e ? { ...e, actorName: actor?.name ?? null } : null;
    });
    const to = row ? (row.signInEmail ?? row.workEmail) : null;
    if (!row || !to) {
      this.logger.log(`Role change of employee ${employeeId}: nobody to email`);
      return;
    }
    await this.mailer.send(
      roleChangedEmail({ to, employeeName: row.fullName, roleLabel: ROLE_LABELS[role], kind, actorName: row.actorName, workspaceName: row.workspaceName, appUrl: this.env.APP_URL }),
    );
  }
}

/** Registered in the worker (WorkerModule). */
@Module({ providers: [BankAccountEmailJob, RoleChangedEmailJob] })
export class PeopleWorkerModule {}
