import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { employees, memberships, tenants, timeoffReasons, timeoffRequestDays, timeoffRequests, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { BalancesService } from './balances.service';
import { approvalReminderEmail, changedEmail, decidedEmail, managerAbsentEmail, type WaitingRequest, withdrawnEmail } from './request-emails';
import { describeType } from './requests.service';

type Payload = JobPayloads['timeoff.notice-email'];
type Of<K extends Payload['kind']> = Extract<Payload, { kind: K }>;

interface RequestFacts {
  id: string;
  employeeId: string;
  status: string;
  type: Parameters<typeof describeType>[0];
  startDate: string;
  endDate: string;
  workingDays: number;
  submittedAt: Date;
  decisionComment: string | null;
  decidedByUserId: string | null;
  reasonName: string | null;
  employeeName: string;
  employeeUserId: string | null;
  employeeWorkEmail: string | null;
  managerId: string | null;
  workspaceName: string;
}

/**
 * Sends the request emails of CD-166 (`timeoff.notice-email` kinds `decided`, `withdrawn`,
 * `changed`, `approval_reminder`, `manager_absent`), reading everything when sending: a request
 * decided or withdrawn meanwhile changes what goes out, a recipient who left the workspace or
 * turned "Approval reminders" off gets nothing.
 */
@Injectable()
export class TimeoffRequestMailer {
  private readonly logger = new Logger(TimeoffRequestMailer.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    private readonly balances: BalancesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(data: Of<'decided'> | Of<'withdrawn'> | Of<'changed'> | Of<'approval_reminder'> | Of<'manager_absent'>): Promise<void> {
    switch (data.kind) {
      case 'decided':
        return this.decided(data);
      case 'withdrawn':
        return this.withdrawn(data);
      case 'changed':
        return this.changed(data);
      case 'approval_reminder':
        return this.reminder(data);
      case 'manager_absent':
        return this.managerAbsent(data);
    }
  }

  private async decided(data: Of<'decided'>): Promise<void> {
    const sent = await this.database.withTenant(data.tenantId, async (tx) => {
      const [r] = await this.requestsIn(tx, [data.requestId]);
      if (!r || (r.status !== 'approved' && r.status !== 'rejected')) return `request ${data.requestId}: not decided (${r?.status ?? 'missing'})`;
      const to = await this.employeeAddress(tx, r);
      if (!to) return 'nobody to email';
      const decider = r.decidedByUserId ? await this.userName(tx, r.decidedByUserId) : null;
      let remaining: number | null = null;
      if (r.status === 'approved' && r.type === 'vacation') {
        const year = Number(r.startDate.slice(0, 4));
        const pc = await this.balances.poolContext(tx, data.tenantId, r.employeeId, [year - 1, year]);
        remaining = pc ? pc.balance(year).remaining : null;
      }
      return decidedEmail({ to, employeeName: r.employeeName, deciderName: decider ?? 'Pultly', workspaceName: r.workspaceName, appUrl: this.env.APP_URL, decision: r.status, what: describeType(r.type, r.reasonName), startDate: r.startDate, endDate: r.endDate, workingDays: r.workingDays, comment: r.decisionComment, remaining });
    });
    await this.deliver(sent, data.kind);
  }

  private async withdrawn(data: Of<'withdrawn'>): Promise<void> {
    const sent = await this.database.withTenant(data.tenantId, async (tx) => {
      const to = await this.memberAddress(tx, data.tenantId, data.recipientUserId, 'approvals');
      if (!to) return 'nobody to email, or turned off';
      const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, data.tenantId));
      return withdrawnEmail({ to: to.email, approverName: to.name, employeeName: data.employeeName, workspaceName: t?.name ?? 'Pultly', appUrl: this.env.APP_URL, what: data.what, startDate: data.startDate, endDate: data.endDate });
    });
    await this.deliver(sent, data.kind);
  }

  private async changed(data: Of<'changed'>): Promise<void> {
    const sent = await this.database.withTenant(data.tenantId, async (tx) => {
      const [r] = await this.requestsIn(tx, [data.requestId]);
      if (!r) return 'request missing';
      const actorName = (await this.userName(tx, data.actorUserId)) ?? 'An Admin';
      const self = data.recipientUserId === null || data.recipientUserId === r.employeeUserId;
      let to: string | null;
      let recipientName = r.employeeName;
      if (self) to = await this.employeeAddress(tx, r);
      else {
        const m = await this.memberAddress(tx, data.tenantId, data.recipientUserId!, null);
        to = m?.email ?? null;
        recipientName = m?.name ?? 'there';
      }
      if (!to) return 'nobody to email';
      const returned = (await tx.select({ n: sql<number>`count(*)::int` }).from(timeoffRequestDays).where(and(eq(timeoffRequestDays.requestId, r.id), inArray(timeoffRequestDays.state, ['cancelled', 'returned']))))[0]?.n ?? 0;
      // The original last day: the shortened request now ends earlier, the returned days tell the old one.
      const [last] = await tx.select({ date: sql<string>`max(${timeoffRequestDays.date})` }).from(timeoffRequestDays).where(eq(timeoffRequestDays.requestId, r.id));
      return changedEmail({ to, recipientName, self, employeeName: r.employeeName, actorName, workspaceName: r.workspaceName, appUrl: this.env.APP_URL, change: data.change, what: describeType(r.type, r.reasonName), startDate: r.startDate, endDate: last?.date ?? r.endDate, newEndDate: data.change === 'shortened' ? r.endDate : null, returnedDays: returned, comment: r.decisionComment });
    });
    await this.deliver(sent, data.kind);
  }

  private async reminder(data: Of<'approval_reminder'>): Promise<void> {
    const sent = await this.database.withTenant(data.tenantId, async (tx) => {
      const to = await this.memberAddress(tx, data.tenantId, data.recipientUserId, 'approvals');
      if (!to) return 'nobody to email, or turned off';
      const requests = (await this.requestsIn(tx, data.requestIds)).filter((r) => r.status === 'pending');
      if (!requests.length) return 'nothing pending any more';
      return approvalReminderEmail({ to: to.email, approverName: to.name, workspaceName: requests[0]!.workspaceName, appUrl: this.env.APP_URL, requests: requests.map(waiting) });
    });
    await this.deliver(sent, data.kind);
  }

  private async managerAbsent(data: Of<'manager_absent'>): Promise<void> {
    const sent = await this.database.withTenant(data.tenantId, async (tx) => {
      const to = await this.memberAddress(tx, data.tenantId, data.recipientUserId, null);
      if (!to) return 'nobody to email';
      const requests = (await this.requestsIn(tx, data.requestIds)).filter((r) => r.status === 'pending');
      if (!requests.length) return 'nothing pending any more';
      const managerIds = [...new Set(requests.map((r) => r.managerId).filter((x): x is string => !!x))];
      const managers = new Map(managerIds.length ? (await tx.select({ id: employees.id, name: employees.fullName }).from(employees).where(inArray(employees.id, managerIds))).map((m) => [m.id, m.name]) : []);
      return managerAbsentEmail({ to: to.email, adminName: to.name, workspaceName: requests[0]!.workspaceName, appUrl: this.env.APP_URL, requests: requests.map((r) => ({ ...waiting(r), managerName: (r.managerId && managers.get(r.managerId)) || 'their manager' })) });
    });
    await this.deliver(sent, data.kind);
  }

  private async deliver(result: Awaited<ReturnType<typeof decidedEmail>> | string, kind: string): Promise<void> {
    if (typeof result === 'string') {
      this.logger.log(`Time off notice ${kind}: ${result}`);
      return;
    }
    await this.mailer.send(result);
  }

  private async requestsIn(tx: Tx, ids: string[]): Promise<RequestFacts[]> {
    if (!ids.length) return [];
    return tx
      .select({
        id: timeoffRequests.id,
        employeeId: timeoffRequests.employeeId,
        status: timeoffRequests.status,
        type: timeoffRequests.type,
        startDate: timeoffRequests.startDate,
        endDate: timeoffRequests.endDate,
        workingDays: timeoffRequests.workingDays,
        submittedAt: timeoffRequests.submittedAt,
        decisionComment: timeoffRequests.decisionComment,
        decidedByUserId: timeoffRequests.decidedByUserId,
        reasonName: sql<string | null>`(select x.name from ${timeoffReasons} x where x.id = ${timeoffRequests.reasonId})`,
        employeeName: employees.fullName,
        employeeUserId: employees.userId,
        employeeWorkEmail: employees.workEmail,
        managerId: employees.managerId,
        workspaceName: sql<string>`(select t.name from ${tenants} t where t.id = ${timeoffRequests.tenantId})`,
      })
      .from(timeoffRequests)
      .innerJoin(employees, eq(employees.id, timeoffRequests.employeeId))
      .where(inArray(timeoffRequests.id, ids));
  }

  /** The employee's sign-in email, else their work email. */
  private async employeeAddress(tx: Tx, r: RequestFacts): Promise<string | null> {
    if (r.employeeUserId) {
      const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, r.employeeUserId));
      if (u?.email) return u.email;
    }
    return r.employeeWorkEmail;
  }

  /** A member's address and name; `toggle` names the profile setting that must be on. */
  private async memberAddress(tx: Tx, tenantId: string, userId: string, toggle: 'approvals' | null): Promise<{ email: string; name: string } | null> {
    const [m] = await tx
      .select({ email: users.email, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'there')`, wants: memberships.notifyTimeoffApprovals })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.tenantId, tenantId)))
      .where(eq(users.id, userId));
    if (!m?.email || (toggle === 'approvals' && !m.wants)) return null;
    return { email: m.email, name: m.name };
  }

  private async userName(tx: Tx, userId: string): Promise<string | null> {
    const [u] = await tx.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email})` }).from(users).where(eq(users.id, userId));
    return u?.name ?? null;
  }
}

const waiting = (r: RequestFacts): WaitingRequest => ({ employeeName: r.employeeName, what: describeType(r.type, r.reasonName), startDate: r.startDate, endDate: r.endDate, workingDays: r.workingDays, submittedAt: r.submittedAt.toISOString() });
