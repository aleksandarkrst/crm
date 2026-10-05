import { HttpException, Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { employees, invitations, memberships, tenants, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { JobsService } from '../../shared/events/jobs.service';
import { createInvitation } from '../identity';
import { bankAccountEmail } from './bank-email';
import { applyDeactivation, dueDeactivations, zonedParts } from './lifecycle';
import { lockReportingLines } from './reporting-lines';

/** How often the worker looks for workspaces where a day has ended (deactivations due). */
export const DEACTIVATE_DUE_CRON = '5,20,35,50 * * * *';
/** Deactivations apply from 00:05 local time on the day after the last working day (spec 4.8). */
const DUE_AFTER_MINUTES = 5;

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
 * "people.deactivate-due" (cron, every 15 minutes in UTC, like the digest tick): in each workspace
 * where it is 00:05 or later local time, applies the deactivations whose last working day is
 * before today (spec 4.8), each in its own transaction under the reporting-line lock, with the
 * choices of the dialog (employees.deactivation_plan). One that can't be applied (the last owner)
 * stays Leaving and is logged; the next tick tries again.
 */
@Injectable()
export class DeactivateDueJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeactivateDueJob.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('people.deactivate-due', (data) => this.run(data));
    await this.jobs.schedule('people.deactivate-due', DEACTIVATE_DUE_CRON);
  }

  async run({ now: at, tenantId }: JobPayloads['people.deactivate-due']): Promise<void> {
    const now = at ? new Date(at) : new Date();
    const workspaces = await this.database.db
      .select({ id: tenants.id, timezone: tenants.timezone })
      .from(tenants)
      .where(tenantId ? eq(tenants.id, tenantId) : undefined);
    for (const w of workspaces) {
      const local = zonedParts(w.timezone, now);
      if (local.minutes < DUE_AFTER_MINUTES) continue;
      const due = await this.database.withTenant(w.id, (tx) => dueDeactivations(tx, local.date));
      for (const d of due) {
        try {
          await this.database.withTenant(w.id, async (tx) => {
            await lockReportingLines(tx, w.id);
            // Read again under the lock: reactivated or applied meanwhile, nothing to do.
            const [still] = await tx
              .select({ id: employees.id })
              .from(employees)
              .where(and(eq(employees.id, d.id), isNull(employees.deactivatedAt), sql`${employees.employmentEndDate} < ${local.date}`));
            if (!still) return;
            const actor = d.plan?.byUserId ?? (await this.anyOwner(w.id));
            const ctx: TenantContext = { tenantId: w.id, userId: actor ?? '', role: 'admin' };
            await applyDeactivation(tx, { audit: this.audit, jobs: this.jobs }, ctx, {
              employeeId: d.id,
              lastWorkingDay: d.lastWorkingDay!,
              reason: d.reason,
              plan: { reportsManagerId: d.plan?.reportsManagerId ?? null, teamLeads: d.plan?.teamLeads ?? [], departmentHeads: d.plan?.departmentHeads ?? [] },
              lenient: true,
            });
          });
        } catch (err) {
          if (!(err instanceof HttpException)) throw err;
          this.logger.warn(`Deactivation of employee ${d.id} (${w.id}) not applied: ${err.message}`);
        }
      }
    }
  }

  /** Audit entries need an actor: who scheduled it, else an owner of the workspace. */
  private async anyOwner(tenantId: string): Promise<string | null> {
    const [m] = await this.database.db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner')))
      .limit(1);
    return m?.userId ?? null;
  }
}

/**
 * "people.bulk-invite" (spec 4.7, 5.4, 8.6): an invitation through identity for each employee that
 * is still Active or Leaving, has a work email, no account and no pending invitation, and whose
 * email isn't a member's already. Each in its own transaction, so one refusal doesn't stop the rest.
 */
@Injectable()
export class BulkInviteJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(BulkInviteJob.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('people.bulk-invite', (data) => this.run(data));
  }

  async run({ tenantId, actorUserId, employeeIds, role }: JobPayloads['people.bulk-invite']): Promise<void> {
    const ctx: TenantContext = { tenantId, userId: actorUserId, role: 'admin' };
    let invited = 0;
    for (const id of employeeIds) {
      try {
        const done = await this.database.withTenant(tenantId, async (tx) => {
          const [e] = await tx
            .select({ workEmail: employees.workEmail })
            .from(employees)
            .where(
              and(
                eq(employees.id, id),
                isNull(employees.userId),
                isNull(employees.deactivatedAt),
                sql`not exists (select 1 from ${invitations} i where i.employee_id = ${employees.id} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())`,
              ),
            );
          if (!e?.workEmail) return false;
          await createInvitation(tx, { jobs: this.jobs, audit: this.audit, env: this.env }, ctx, { email: e.workEmail, role, employeeId: id });
          return true;
        });
        if (done) invited++;
      } catch (err) {
        if (!(err instanceof HttpException)) throw err;
        this.logger.warn(`Bulk invite: employee ${id} (${tenantId}) skipped: ${err.message}`);
      }
    }
    this.logger.log(`Bulk invite in ${tenantId}: ${invited} of ${employeeIds.length} invited`);
  }
}

/** Registered in the worker (WorkerModule). */
@Module({ providers: [BankAccountEmailJob, DeactivateDueJob, BulkInviteJob] })
export class PeopleWorkerModule {}
