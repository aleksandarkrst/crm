import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { employees, memberships, tenants, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { balanceAdjustedEmail, carryOverExpiringEmail } from './balance-emails';

/**
 * Sends one `timeoff.notice-email` (CD-164, spec 15.2). The address and the "Time off balance"
 * toggle are read now: a member who turned it off gets nothing; an employee without an account
 * gets it at their work email; nobody without an address. Retried like every email job.
 */
@Injectable()
export class TimeoffNoticeMailer {
  private readonly logger = new Logger(TimeoffNoticeMailer.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(data: JobPayloads['timeoff.notice-email']): Promise<void> {
    const row = await this.database.withTenant(data.tenantId, async (tx) => {
      const [e] = await tx
        .select({
          fullName: employees.fullName,
          userId: employees.userId,
          workEmail: employees.workEmail,
          signInEmail: sql<string | null>`(select u.email from ${users} u where u.id = ${employees.userId})`,
          workspaceName: sql<string>`(select t.name from ${tenants} t where t.id = ${employees.tenantId})`,
        })
        .from(employees)
        .where(eq(employees.id, data.employeeId));
      if (!e) return null;
      const [m] = e.userId ? await tx.select({ wants: memberships.notifyTimeoffBalance }).from(memberships).where(and(eq(memberships.tenantId, data.tenantId), eq(memberships.userId, e.userId))) : [];
      const [actor] = data.kind === 'balance_adjusted' && data.actorUserId ? await tx.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email})` }).from(users).where(eq(users.id, data.actorUserId)) : [];
      return { ...e, wants: m ? m.wants : true, actorName: actor?.name ?? null };
    });
    const to = row ? (row.signInEmail ?? row.workEmail) : null;
    if (!row || !to || !row.wants) {
      this.logger.log(`Time off notice ${data.kind} for employee ${data.employeeId}: ${!row || !to ? 'nobody to email' : 'turned off'}`);
      return;
    }
    const base = { to, employeeName: row.fullName, workspaceName: row.workspaceName, appUrl: this.env.APP_URL };
    await this.mailer.send(
      data.kind === 'balance_adjusted'
        ? balanceAdjustedEmail({ ...base, actorName: row.actorName, poolYear: data.adjustment.poolYear, days: data.adjustment.days, kind: data.adjustment.kind, reason: data.adjustment.reason, remaining: data.remaining, available: data.available })
        : carryOverExpiringEmail({ ...base, year: data.year, expiring: data.expiring }),
    );
  }
}
