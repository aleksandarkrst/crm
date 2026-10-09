import { Body, Controller, HttpCode, Injectable, Logger, Module, type OnApplicationBootstrap, Post } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { employees, tenants, timesheetDeadlineRuns, timesheetWeeks } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { zonedDayStart, zonedParts } from '../../shared/time/zoned-time';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { addDays, deadlineInstant, deadlineOf, isoWeek, mondayOf, type TimesheetSettings } from './timesheet-rules';
import { type Caller, readWeek, submitDays } from './timesheet.service';
import { holidaysBetween, timesheetSettings } from './timesheet-settings';

/** How often the worker looks for deadlines that passed. */
export const TIMESHEET_TICK_CRON = '*/15 * * * *';

/** The deadlines of the weeks around `monday`, in order: last weeks' (a "next week" deadline falls in this one), this week's, the next. */
const mondaysAround = (monday: string) => [addDays(monday, -14), addDays(monday, -7), monday, addDays(monday, 7), addDays(monday, 14)];

async function deadlinesAround(tx: Tx, settings: TimesheetSettings, timeZone: string, today: string) {
  const monday = mondayOf(today);
  const holidays = await holidaysBetween(tx, addDays(monday, -21), addDays(monday, 70));
  return mondaysAround(monday).map((weekStart) => {
    const due = deadlineOf(weekStart, settings, (d) => holidays.has(d));
    return { weekStart, ...due, at: deadlineInstant(zonedDayStart(due.date, timeZone), due.time) };
  });
}

/** One employee as the Timesheet reads them, for the deadline job (not the signed-in caller). */
async function callerFor(tx: Tx, employeeId: string, today: string, settings: TimesheetSettings): Promise<Caller> {
  const [e] = await tx
    .select({ name: employees.fullName, start: employees.employmentStartDate, end: employees.employmentEndDate })
    .from(employees)
    .where(eq(employees.id, employeeId));
  return { employeeId, name: e?.name ?? '', employment: { start: e?.start ?? null, end: e?.end ?? null }, today, settings };
}

/**
 * The submission deadline (CD-153): the next one for the settings page, and auto submit. At a
 * deadline (from when auto submit was turned on), every week of that deadline with hours in it gets
 * its required Draft days submitted and is flagged Late and Auto-submitted; weeks without hours and
 * Rejected days are left alone (spec 6.3). `timesheet_deadline_runs` makes it once per week, so a
 * tick run twice, or after the worker was down, does it once.
 */
@Injectable()
export class TimesheetDeadlines {
  constructor(private readonly database: DatabaseService) {}

  /** The first deadline that hasn't passed: "Week 42 is due Fri 16 Oct, 17:00". */
  next(ctx: TenantContext, now = new Date()) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      const tz = tenant?.timezone ?? 'UTC';
      const settings = await timesheetSettings(tx, ctx.tenantId);
      const deadlines = await deadlinesAround(tx, settings, tz, zonedParts(now, tz).date);
      const due = deadlines.find((d) => d.at > now) ?? deadlines[deadlines.length - 1]!;
      return { weekStart: due.weekStart, weekNumber: isoWeek(due.weekStart), date: due.date, time: due.time };
    });
  }

  /** Auto submit for one workspace at `now`; answers how many weeks it submitted. */
  autoSubmitDue(tenantId: string, now = new Date()): Promise<number> {
    return this.database.withTenant(tenantId, async (tx) => {
      const settings = await timesheetSettings(tx, tenantId);
      if (!settings.autoSubmit || !settings.autoSubmitSince) return 0;
      const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
      const tz = tenant?.timezone ?? 'UTC';
      const today = zonedParts(now, tz).date;
      let total = 0;
      for (const due of await deadlinesAround(tx, settings, tz, today)) {
        if (due.at > now || due.at < settings.autoSubmitSince) continue;
        const [claimed] = await tx.insert(timesheetDeadlineRuns).values({ tenantId, weekStart: due.weekStart }).onConflictDoNothing().returning({ weekStart: timesheetDeadlineRuns.weekStart });
        if (!claimed) continue;
        // People with an app account (the others have no timesheet of their own, spec 4.8), still active, with hours that week.
        const { rows } = await tx.execute<{ employee_id: string }>(sql`
          select distinct e.employee_id from time_entries e join employees p on p.id = e.employee_id
          where e.work_date between ${due.weekStart} and ${addDays(due.weekStart, 6)} and p.user_id is not null and p.deactivated_at is null`);
        let submitted = 0;
        for (const { employee_id: employeeId } of rows) {
          const week = await readWeek(tx, await callerFor(tx, employeeId, today, settings), due.weekStart);
          if (week.submittable.length === 0) continue;
          await submitDays(tx, tenantId, employeeId, due.weekStart, week.submittable, null, now);
          await tx
            .insert(timesheetWeeks)
            .values({ tenantId, employeeId, weekStart: due.weekStart, lateAt: now, autoSubmittedAt: now })
            .onConflictDoUpdate({
              target: [timesheetWeeks.tenantId, timesheetWeeks.employeeId, timesheetWeeks.weekStart],
              set: { lateAt: sql`coalesce(${timesheetWeeks.lateAt}, excluded.late_at)`, autoSubmittedAt: now },
            });
          submitted++;
        }
        await tx.update(timesheetDeadlineRuns).set({ submittedWeeks: submitted }).where(eq(timesheetDeadlineRuns.weekStart, due.weekStart));
        total += submitted;
      }
      return total;
    });
  }
}

/** The worker's side (CD-153): `timesheet.tick` every 15 minutes runs auto submit for each workspace that has it on. */
@Injectable()
export class TimesheetJobs implements OnApplicationBootstrap {
  private readonly logger = new Logger(TimesheetJobs.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly deadlines: TimesheetDeadlines,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('timesheet.tick', () => this.tick());
    await this.jobs.schedule('timesheet.tick', TIMESHEET_TICK_CRON);
  }

  async tick(now: Date = new Date()): Promise<void> {
    const workspaces = await this.database.db.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.timesheetAutoSubmit, true), sql`${tenants.timesheetAutoSubmitSince} is not null`));
    for (const w of workspaces) {
      const submitted = await this.deadlines.autoSubmitDue(w.id, now);
      if (submitted) this.logger.log(`Auto-submitted ${submitted} timesheet week(s) in workspace ${w.id}`);
    }
  }
}

@Module({ providers: [TimesheetDeadlines, TimesheetJobs] })
export class TimesheetWorkerModule {}

const Tick = z.object({ now: z.iso.datetime().optional() });
type Tick = z.infer<typeof Tick>;

/** Development only (AUTH_MODE=dev): runs auto submit for the caller's workspace at `now` (tests). */
@Controller('dev/timesheet')
export class DevTimesheetController {
  constructor(private readonly deadlines: TimesheetDeadlines) {}

  @Post('deadline-tick')
  @RequireTenant('member')
  @HttpCode(200)
  async tick(@Tenant() ctx: TenantContext, @Body(new ZodPipe(Tick)) body: Tick) {
    return { submitted: await this.deadlines.autoSubmitDue(ctx.tenantId, body.now ? new Date(body.now) : new Date()) };
  }
}

@Module({ controllers: [DevTimesheetController], providers: [TimesheetDeadlines] })
export class TimesheetDevModule {}
