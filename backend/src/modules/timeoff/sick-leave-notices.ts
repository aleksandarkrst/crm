import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer, type MailMessage } from '../../infrastructure/mail/mailer';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { employees, memberships, sickLeaves, tenants, timeoffReasons, timeoffRequests, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { holidaysBetween, timesheetSettings } from '../timesheet';
import { addDays } from './request-rules';
import { describeType, RequestsService } from './requests.service';
import { interruptedEmail, sickEndedEmail, sickReportedEmail, weeklyCheckEmail } from './sick-leave-emails';
import { workspaceToday } from './today';

type Payload = JobPayloads['timeoff.sick-email'];
type Of<K extends Payload['kind']> = Extract<Payload, { kind: K }>;
interface Recipient {
  email: string;
  name: string;
  userId: string | null;
}
const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/**
 * Sends the sick leave emails (`timeoff.sick-email`, CD-169, spec 15.2), reading everything at send
 * time: a record cancelled meanwhile sends nothing, a member who left or turned "Sick leave
 * notices" off gets nothing. One message per recipient; the actor is left out.
 */
@Injectable()
export class SickLeaveMailer {
  private readonly logger = new Logger(SickLeaveMailer.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    private readonly requests: RequestsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(data: Payload): Promise<void> {
    const messages = await this.database.withTenant(data.tenantId, async (tx) => {
      const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, data.tenantId));
      const base = { workspaceName: t?.name ?? 'Pultly', appUrl: this.env.APP_URL };
      switch (data.kind) {
        case 'reported':
          return this.reported(tx, data, base);
        case 'ended':
          return this.ended(tx, data, base);
        case 'interrupted':
          return this.interrupted(tx, data, base);
        case 'weekly_check':
          return this.weekly(tx, data, base);
      }
    });
    if (!messages.length) this.logger.log(`Sick leave email ${data.kind}: nobody to email`);
    for (const m of messages) await this.mailer.send(m);
  }

  private async reported(tx: Tx, data: Of<'reported'>, base: { workspaceName: string; appUrl: string }): Promise<MailMessage[]> {
    const r = await this.record(tx, data.sickLeaveId);
    if (!r || r.status === 'cancelled') return [];
    const reporter = r.reportedByUserId ? await this.userName(tx, r.reportedByUserId) : null;
    const manager = await this.managerOf(tx, data.tenantId, r.employeeId, true);
    const admins = await this.admins(tx, data.tenantId, true);
    const out: MailMessage[] = [];
    for (const [who, admin] of [...(manager ? [[manager, false] as const] : []), ...admins.map((a) => [a, true] as const)]) {
      if (who.userId === data.actorUserId || out.some((m) => m.to === who.email)) continue;
      out.push(sickReportedEmail({ ...base, to: who.email, recipientName: who.name, employeeName: r.employeeName, reporterName: reporter ?? r.employeeName, startDate: r.startDate, endDate: r.endDate, admin }));
    }
    return out;
  }

  private async ended(tx: Tx, data: Of<'ended'>, base: { workspaceName: string; appUrl: string }): Promise<MailMessage[]> {
    const r = await this.record(tx, data.sickLeaveId);
    if (!r || r.status === 'cancelled' || !r.endDate) return [];
    const manager = await this.managerOf(tx, data.tenantId, r.employeeId, true);
    if (!manager || manager.userId === data.actorUserId) return [];
    const settings = await timesheetSettings(tx, data.tenantId);
    const holidays = await holidaysBetween(tx, r.endDate, addDays(r.endDate, 30));
    let back = addDays(r.endDate, 1);
    while (!settings.workingDays.includes(isoWeekday(back)) || holidays.has(back)) back = addDays(back, 1);
    return [sickEndedEmail({ ...base, to: manager.email, recipientName: manager.name, employeeName: r.employeeName, startDate: r.startDate, endDate: r.endDate, returnDate: back })];
  }

  private async interrupted(tx: Tx, data: Of<'interrupted'>, base: { workspaceName: string; appUrl: string }): Promise<MailMessage[]> {
    const r = await this.record(tx, data.sickLeaveId);
    const [request] = await tx
      .select({ id: timeoffRequests.id, employeeId: timeoffRequests.employeeId, type: timeoffRequests.type, reasonName: sql<string | null>`(select x.name from ${timeoffReasons} x where x.id = ${timeoffRequests}.reason_id)` })
      .from(timeoffRequests)
      .where(eq(timeoffRequests.id, data.requestId));
    if (!r || r.status === 'cancelled' || !request) return [];
    const what = describeType(request.type, request.reasonName);
    const recipients: (Recipient & { self: boolean })[] = [];
    const add = (who: Recipient | null, self: boolean) => {
      if (who && !recipients.some((x) => x.email === who.email)) recipients.push({ ...who, self });
    };
    add(await this.employeeAddress(tx, r.employeeId), true);
    const approver = await this.requests.approver(tx, data.tenantId, request.employeeId, await workspaceToday(tx, data.tenantId));
    for (const a of approver?.approvers ?? []) add(await this.member(tx, data.tenantId, a.userId, false), false);
    for (const a of await this.admins(tx, data.tenantId, false)) add(a, false);
    return recipients.map((who) => interruptedEmail({ ...base, to: who.email, recipientName: who.self ? r.employeeName : who.name, self: who.self, employeeName: r.employeeName, what, dates: data.dates, vacation: request.type === 'vacation' }));
  }

  private async weekly(tx: Tx, data: Of<'weekly_check'>, base: { workspaceName: string; appUrl: string }): Promise<MailMessage[]> {
    const who = await this.member(tx, data.tenantId, data.recipientUserId, true);
    if (!who) return [];
    const rows = await tx
      .select({ status: sickLeaves.status, startDate: sickLeaves.startDate, endDate: sickLeaves.endDate, employeeName: employees.fullName })
      .from(sickLeaves)
      .innerJoin(employees, eq(employees.id, sickLeaves.employeeId))
      .where(and(inArray(sickLeaves.id, data.sickLeaveIds), inArray(sickLeaves.status, ['reported', 'confirmed'])));
    if (!rows.length) return [];
    return [weeklyCheckEmail({ ...base, to: who.email, recipientName: who.name, records: rows.map((r) => ({ ...r, stale: r.status !== 'reported' })) })];
  }

  private async record(tx: Tx, id: string) {
    const [r] = await tx
      .select({ id: sickLeaves.id, employeeId: sickLeaves.employeeId, startDate: sickLeaves.startDate, endDate: sickLeaves.endDate, status: sickLeaves.status, reportedByUserId: sickLeaves.reportedByUserId, employeeName: employees.fullName })
      .from(sickLeaves)
      .innerJoin(employees, eq(employees.id, sickLeaves.employeeId))
      .where(eq(sickLeaves.id, id));
    return r ?? null;
  }

  /** The employee's direct manager as a member of this workspace. */
  private async managerOf(tx: Tx, tenantId: string, employeeId: string, toggle: boolean): Promise<Recipient | null> {
    const [e] = await tx.select({ managerUserId: sql<string | null>`(select m.user_id from ${employees} m where m.id = ${employees}.manager_id)` }).from(employees).where(eq(employees.id, employeeId));
    return e?.managerUserId ? this.member(tx, tenantId, e.managerUserId, toggle) : null;
  }

  private async admins(tx: Tx, tenantId: string, toggle: boolean): Promise<Recipient[]> {
    const rows = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.role, ['owner', 'admin'])));
    const out: Recipient[] = [];
    for (const r of rows) {
      const m = await this.member(tx, tenantId, r.userId, toggle);
      if (m) out.push(m);
    }
    return out;
  }

  /** A member's address and name; with `toggle`, only while "Sick leave notices" is on. */
  private async member(tx: Tx, tenantId: string, userId: string, toggle: boolean): Promise<Recipient | null> {
    const [m] = await tx
      .select({ email: users.email, name: sql<string>`coalesce(${users.displayName}, ${users.email}, 'there')`, wants: memberships.notifySickLeave })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.tenantId, tenantId)))
      .where(eq(users.id, userId));
    if (!m?.email || (toggle && !m.wants)) return null;
    return { email: m.email, name: m.name, userId };
  }

  /** The employee's sign-in email, else their work email (employees without an account, spec 15.2). */
  private async employeeAddress(tx: Tx, employeeId: string): Promise<Recipient | null> {
    const [e] = await tx.select({ userId: employees.userId, workEmail: employees.workEmail, fullName: employees.fullName }).from(employees).where(eq(employees.id, employeeId));
    if (!e) return null;
    const signIn = e.userId ? (await tx.select({ email: users.email }).from(users).where(eq(users.id, e.userId)))[0]?.email : null;
    const email = signIn ?? e.workEmail;
    return email ? { email, name: e.fullName, userId: e.userId } : null;
  }

  private async userName(tx: Tx, userId: string): Promise<string | null> {
    const [u] = await tx.select({ name: sql<string>`coalesce(${users.displayName}, ${users.email})` }).from(users).where(eq(users.id, userId));
    return u?.name ?? null;
  }
}
