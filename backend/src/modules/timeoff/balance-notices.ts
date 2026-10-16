import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { employees, memberships, tenants, timeoffReasons, timeoffRequests, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { balanceAdjustedEmail, carryOverExpiringEmail, requestedEmail } from './balance-emails';

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
    if (data.kind === 'requested') return this.sendRequested(data);
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

  /** "Time off requested" (CD-165) to one approver, read when sending: a request withdrawn meanwhile sends nothing. */
  private async sendRequested(data: Extract<JobPayloads['timeoff.notice-email'], { kind: 'requested' }>): Promise<void> {
    const facts = await this.database.withTenant(data.tenantId, async (tx) => {
      const [r] = await tx
        .select({
          status: timeoffRequests.status,
          type: timeoffRequests.type,
          startDate: timeoffRequests.startDate,
          endDate: timeoffRequests.endDate,
          workingDays: timeoffRequests.workingDays,
          note: timeoffRequests.note,
          employeeName: sql<string>`(select e.full_name from ${employees} e where e.id = ${timeoffRequests.employeeId})`,
          reasonName: sql<string | null>`(select x.name from ${timeoffReasons} x where x.id = ${timeoffRequests.reasonId})`,
          workspaceName: sql<string>`(select t.name from ${tenants} t where t.id = ${timeoffRequests.tenantId})`,
        })
        .from(timeoffRequests)
        .where(eq(timeoffRequests.id, data.requestId));
      const [u] = await tx.select({ email: users.email, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'there')` }).from(users).where(eq(users.id, data.recipientUserId));
      return r && u?.email ? { ...r, to: u.email, approverName: u.name } : null;
    });
    if (!facts || facts.status !== 'pending') {
      this.logger.log(`Time off request ${data.requestId}: ${!facts ? 'nobody to email' : `no longer pending (${facts.status})`}`);
      return;
    }
    const what = facts.type === 'vacation' ? 'vacation' : facts.type === 'paid_leave' ? `paid leave (${facts.reasonName ?? 'reason'})` : facts.type === 'unpaid_leave' ? 'unpaid leave' : `an absence (${facts.reasonName ?? 'reason'})`;
    await this.mailer.send(requestedEmail({ to: facts.to, approverName: facts.approverName, employeeName: facts.employeeName, workspaceName: facts.workspaceName, appUrl: this.env.APP_URL, what, startDate: facts.startDate, endDate: facts.endDate, workingDays: facts.workingDays, note: facts.note, balanceAfter: null, requestId: data.requestId }));
  }
}
