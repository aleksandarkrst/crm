import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { employees, projects, taskAssignments, taskLimitAlerts, tasks, tenants, timeEntries, users } from '../../shared/database/schema';
import type { JobsService } from '../../shared/events/jobs.service';

/**
 * Hour limits (CD-149, spec 10.3, 10.4): how far someone's logged hours on a task are into their
 * limit, the "once per crossing" emails, and Block mode. Logged hours are every time entry of the
 * person on the task (draft, submitted, rejected and approved days), summed when read.
 */

/** 0 below 80 % of the limit, 80 from 80 %, 100 from the limit; 0 without a limit. */
export type AlertLevel = 0 | 80 | 100;

export function alertLevel(loggedMinutes: number, limitMinutes: number | null): AlertLevel {
  if (limitMinutes == null || limitMinutes <= 0) return 0;
  if (loggedMinutes >= limitMinutes) return 100;
  return loggedMinutes * 5 >= limitMinutes * 4 ? 80 : 0;
}

/**
 * The email a change of level sends: only going up, and only the highest threshold crossed (7 h →
 * 10 h of 10 sends "Hour limit reached", not both). Going down sends nothing, so crossing again later
 * sends again (spec 10.3).
 */
export const crossing = (before: AlertLevel, after: AlertLevel): 80 | 100 | null => (after > before && after !== 0 ? after : null);

/** "7.25" (hours with up to two decimals, spec 10.1). */
export const hoursText = (minutes: number) => String(Math.round((minutes / 60) * 100) / 100);

/** Block mode's refusal (spec 10.4): "You have 1.5 h left on T-142 (limit 8 h). Ask Marko Petrović to raise your limit." */
export function blockMessage(task: { number: number }, loggedMinutes: number, limitMinutes: number, leadName: string | null): string {
  const left = Math.max(0, limitMinutes - loggedMinutes);
  return `You have ${hoursText(left)} h left on T-${task.number} (limit ${hoursText(limitMinutes)} h). Ask ${leadName ?? 'the project lead'} to raise your limit.`;
}

/** Someone's logged minutes on a task, all time; `except` leaves out entries being replaced. */
export async function loggedMinutes(tx: Tx, taskId: string, employeeId: string, except: string[] = []): Promise<number> {
  const [row] = await tx
    .select({ minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)::int` })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.taskId, taskId),
        eq(timeEntries.employeeId, employeeId),
        except.length ? notInArray(timeEntries.id, except) : undefined,
      ),
    );
  return row?.minutes ?? 0;
}

/**
 * Block mode (spec 10.4) for one person and task: the refusal message when `minutes` more (after
 * leaving out the entries in `except`, which the change replaces) take them past their limit, else
 * null. Warn mode, no limit or a removed assignee: null. Lowering hours is always fine, so someone
 * already over their limit when Block was turned on keeps their entries and can't add more.
 */
export async function hourLimitBlock(tx: Tx, tenantId: string, employeeId: string, taskId: string, minutes: number, except: string[] = []): Promise<string | null> {
  const [row] = await tx
    .select({
      mode: tenants.hourLimitMode,
      number: tasks.number,
      hourLimit: taskAssignments.hourLimit,
      active: taskAssignments.active,
      leadName: sql<string | null>`(select coalesce(u.display_name, u.email) from ${users} u where u.id = ${projects.leadUserId})`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(tenants, eq(tenants.id, tasks.tenantId))
    .innerJoin(taskAssignments, and(eq(taskAssignments.taskId, tasks.id), eq(taskAssignments.employeeId, employeeId)))
    .where(eq(tasks.id, taskId));
  if (!row || row.mode !== 'block' || !row.active || row.hourLimit == null) return null;
  const limit = Math.round(row.hourLimit * 60);
  const logged = await loggedMinutes(tx, taskId, employeeId, except);
  return logged + minutes > limit ? blockMessage(row, logged, limit, row.leadName) : null;
}

/** An Open (To do) task moves to In progress on its first time entry (spec 9.2, CD-148). */
export async function startOnFirstEntry(tx: Tx, taskId: string): Promise<boolean> {
  const rows = await tx
    .update(tasks)
    .set({ status: 'in_progress' })
    .where(and(eq(tasks.id, taskId), eq(tasks.status, 'todo'), sql`exists (select 1 from ${timeEntries} e where e.task_id = ${tasks.id})`))
    .returning({ id: tasks.id });
  return rows.length > 0;
}

/**
 * Recomputes one person's alert on a task and queues the emails a crossing sends: "Hour limit
 * almost reached" to them and the project lead, "Hour limit reached" also to their direct manager;
 * each member once. The row is locked, so two jobs for the same person and task can't both send.
 * Called by the `timesheet.task-hours-changed` handler and when a limit changes (raising it clears
 * the badge at once).
 */
export async function refreshLimitAlert(tx: Tx, jobs: JobsService, tenantId: string, taskId: string, employeeId: string): Promise<{ before: AlertLevel; after: AlertLevel }> {
  await tx.insert(taskLimitAlerts).values({ tenantId, taskId, employeeId }).onConflictDoNothing();
  const [state] = await tx
    .select({ level: taskLimitAlerts.level })
    .from(taskLimitAlerts)
    .where(and(eq(taskLimitAlerts.taskId, taskId), eq(taskLimitAlerts.employeeId, employeeId)))
    .for('update');
  if (!state) return { before: 0, after: 0 }; // the task or the person is gone
  const [facts] = await tx
    .select({
      hourLimit: taskAssignments.hourLimit,
      active: taskAssignments.active,
      leadUserId: projects.leadUserId,
      personUserId: employees.userId,
      managerUserId: sql<string | null>`(select m.user_id from ${employees} m where m.id = ${employees.managerId} and m.deactivated_at is null)`,
    })
    .from(taskAssignments)
    .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(employees, eq(employees.id, taskAssignments.employeeId))
    .where(and(eq(taskAssignments.taskId, taskId), eq(taskAssignments.employeeId, employeeId)));
  const limit = facts?.active && facts.hourLimit != null ? Math.round(facts.hourLimit * 60) : null;
  const logged = await loggedMinutes(tx, taskId, employeeId);
  const before = state.level as AlertLevel;
  const after = alertLevel(logged, limit);
  if (after !== before) {
    await tx
      .update(taskLimitAlerts)
      .set({ level: after, updatedAt: sql`now()` })
      .where(and(eq(taskLimitAlerts.taskId, taskId), eq(taskLimitAlerts.employeeId, employeeId)));
  }
  const level = crossing(before, after);
  if (level && facts && limit != null) {
    const recipients = new Set([facts.personUserId, facts.leadUserId, level === 100 ? facts.managerUserId : null].filter((id): id is string => !!id));
    for (const recipientUserId of recipients) {
      await jobs.send('projects.limit-alert', { tenantId, taskId, employeeId, level, recipientUserId, loggedMinutes: logged, limitMinutes: limit }, tx);
    }
  }
  return { before, after };
}
