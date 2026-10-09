import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { employees, memberships, tenants, timesheetNotices, type TimesheetNoticeKind, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { JobsService } from '../../shared/events/jobs.service';
import { zonedParts } from '../../shared/time/zoned-time';
import { PeopleAccess } from '../people';
import { autoSubmittedEmail, lateEmail, type LatePerson, lateSummaryEmail, reminderEmail, type WeekFacts } from './notice-emails';
import { callerFor, deadlinesAround } from './deadlines';
import { isoWeek } from './timesheet-rules';
import { readWeek, type WeekView } from './timesheet.service';
import { timesheetSettings } from './timesheet-settings';

/** After downtime, a deadline up to this old still gets its emails. */
const CATCH_UP_MS = 24 * 3_600_000;

/** Of `days`, those without hours: what the emails call missing (design: "31.5 of 32 h · Missing Friday"). */
const emptyOf = (w: WeekView, days: string[]) => days.filter((d) => (w.days.find((x) => x.date === d)?.minutes ?? 0) === 0);

const factsOf = (w: WeekView, missing: string[]): WeekFacts => ({
  weekStart: w.weekStart,
  weekNumber: w.weekNumber,
  deadline: w.deadline,
  enteredMinutes: w.days.reduce((a, d) => a + d.minutes, 0),
  expectedMinutes: w.days.reduce((a, d) => a + d.expectedMinutes, 0),
  missing,
});

/**
 * The timesheet emails (CD-154, spec 7.1, 7.2). `queueDue` (the worker's tick, after auto submit):
 * - the reminder the set hours before each deadline, to every active member with a required Draft
 *   or a Rejected day that week;
 * - at the deadline (up to a day late after downtime): "late" to each member with a required day
 *   never submitted, or "submitted automatically" to those auto submit sent in, and one summary per
 *   approver (the approver rule: the manager, or Admins) of their late people.
 * Each email is claimed in `timesheet_notices` in the same transaction that queues it, so it goes
 * out once; TimesheetNoticeMailer sends it (job `timesheet.notice-email`, retried like every email).
 */
@Injectable()
export class TimesheetNotices {
  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly people: PeopleAccess,
  ) {}

  /** Queues the emails due in one workspace at `now`; answers how many. */
  queueDue(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const settings = await timesheetSettings(tx, tenantId);
      const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
      const tz = tenant?.timezone ?? 'UTC';
      const today = zonedParts(now, tz).date;
      const deadlines = (await deadlinesAround(tx, settings, tz, today)).filter((due) => {
        const reminding = settings.reminderHours !== null && due.at > now && due.at.getTime() - settings.reminderHours * 3_600_000 <= now.getTime();
        const passed = due.at <= now && now.getTime() - due.at.getTime() <= CATCH_UP_MS;
        return reminding || passed;
      });
      if (!deadlines.length) return 0;
      // Active members of this workspace with an email: only they have a timesheet of their own (spec 4.8).
      const members = await tx
        .select({ employeeId: employees.id, userId: employees.userId, name: employees.fullName })
        .from(employees)
        .innerJoin(memberships, and(eq(memberships.userId, employees.userId), eq(memberships.tenantId, tenantId)))
        .innerJoin(users, eq(users.id, employees.userId))
        .where(and(isNull(employees.deactivatedAt), isNotNull(users.email)));
      let queued = 0;
      const claim = async (weekStart: string, kind: TimesheetNoticeKind, recipient: string) => {
        const [row] = await tx.insert(timesheetNotices).values({ tenantId, weekStart, kind, recipient }).onConflictDoNothing().returning({ kind: timesheetNotices.kind });
        return !!row;
      };
      const send = async (data: JobPayloads['timesheet.notice-email']) => {
        await this.jobs.send('timesheet.notice-email', data, tx, { singletonKey: `${tenantId}:${data.weekStart}:${data.kind}:${data.recipientUserId}` });
        queued++;
      };

      for (const due of deadlines) {
        if (due.at > now) {
          for (const m of members) {
            const week = await readWeek(tx, await callerFor(tx, m.employeeId, today, settings, tz, now), due.weekStart);
            const rejected = week.days.filter((d) => d.status === 'rejected').map((d) => d.date);
            if (!week.submittable.length && !rejected.length) continue;
            if (!(await claim(due.weekStart, 'reminder', m.employeeId))) continue;
            const missing = [...new Set([...emptyOf(week, week.submittable), ...rejected])].sort();
            await send({ tenantId, kind: 'reminder', weekStart: due.weekStart, recipientUserId: m.userId!, week: factsOf(week, missing) });
          }
          continue;
        }
        const late: { employeeId: string; person: LatePerson }[] = [];
        for (const m of members) {
          const week = await readWeek(tx, await callerFor(tx, m.employeeId, today, settings, tz, now), due.weekStart);
          const name = m.name;
          if (week.autoSubmitted) {
            // Submitted for them at the deadline: told always (it follows the auto submit switch).
            if (await claim(due.weekStart, 'auto_submitted', m.employeeId)) {
              await send({ tenantId, kind: 'auto_submitted', weekStart: due.weekStart, recipientUserId: m.userId!, week: factsOf(week, []) });
              late.push({ employeeId: m.employeeId, person: { name, enteredMinutes: factsOf(week, []).enteredMinutes, autoSubmitted: true } });
            }
          } else if (week.lateIfSubmitted.length && settings.afterDeadlineEmails) {
            if (await claim(due.weekStart, 'late', m.employeeId)) {
              await send({ tenantId, kind: 'late', weekStart: due.weekStart, recipientUserId: m.userId!, week: factsOf(week, emptyOf(week, week.lateIfSubmitted)) });
              late.push({ employeeId: m.employeeId, person: { name, enteredMinutes: factsOf(week, []).enteredMinutes, autoSubmitted: false } });
            }
          }
        }
        if (!settings.afterDeadlineEmails || !late.length) continue;
        // One summary per approver (spec 7.2): the manager, or every Admin when there is none.
        const byApprover = new Map<string, LatePerson[]>();
        for (const l of late) {
          const result = await this.people.approversFor(tenantId, l.employeeId, due.date, tx);
          for (const a of result?.approvers ?? []) if (a.employeeId !== l.employeeId) byApprover.set(a.userId, [...(byApprover.get(a.userId) ?? []), l.person]);
        }
        for (const [userId, people] of byApprover) {
          if (!(await claim(due.weekStart, 'late_summary', userId))) continue;
          const week = { weekStart: due.weekStart, weekNumber: isoWeek(due.weekStart), deadline: { date: due.date, time: due.time }, enteredMinutes: 0, expectedMinutes: 0, missing: [] };
          await send({ tenantId, kind: 'late_summary', weekStart: due.weekStart, recipientUserId: userId, week, people });
        }
      }
      return queued;
    });
  }

}

/** Sends one timesheet email (job `timesheet.notice-email`, the worker), built when it is sent. */
@Injectable()
export class TimesheetNoticeMailer {
  private readonly logger = new Logger(TimesheetNoticeMailer.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async send(data: JobPayloads['timesheet.notice-email']): Promise<void> {
    const [r] = await this.database.db
      .select({ email: users.email, name: users.displayName, workspaceName: tenants.name, timeFormat: tenants.timesheetTimeFormat })
      .from(users)
      .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.tenantId, data.tenantId)))
      .innerJoin(tenants, eq(tenants.id, data.tenantId))
      .where(eq(users.id, data.recipientUserId));
    if (!r?.email) return;
    if (this.mailer.notDelivered) {
      this.logger.warn(`Timesheet ${data.kind} email not sent: ${this.mailer.notDelivered}`);
      return;
    }
    const common = { to: r.email, recipientName: r.name, workspaceName: r.workspaceName, appUrl: this.env.APP_URL, timeFormat: r.timeFormat };
    const week = data.week;
    const message =
      data.kind === 'reminder'
        ? reminderEmail(common, week)
        : data.kind === 'late'
          ? lateEmail(common, week)
          : data.kind === 'auto_submitted'
            ? autoSubmittedEmail(common, week)
            : lateSummaryEmail(common, week, data.people ?? []);
    await this.mailer.send(message);
  }
}

