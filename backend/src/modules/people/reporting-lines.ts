import { BadRequestException, ConflictException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { employees } from '../../shared/database/schema';
import type { JobsService } from '../../shared/events/jobs.service';

/**
 * Reporting lines (spec 7.2): one manager per employee, never yourself, never a loop. Every change
 * of a manager (the card, bulk actions, team-lead dialogs, deactivation, import) must:
 *   1. `await lockReportingLines(tx, tenantId)` — a per-workspace transaction lock, so two
 *      simultaneous edits (A → B and B → A) can't both pass the check. Take it first, before
 *      locking employee rows (otherwise the two edits can deadlock on each other's rows);
 *   2. `await assertValidManager(tx, employeeId, managerId)` for each change, after the lock;
 *   3. write, in the same transaction.
 */

/** Takes the workspace's reporting-line lock until the transaction ends (pg_advisory_xact_lock). */
export async function lockReportingLines(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`people.reporting-lines:${tenantId}`}, 0))`);
}

/** "This would create a loop: Ana Petrović → Marko Jovanović → Ivan Ilić → Ana Petrović". */
export const loopMessage = (names: string[]) => `This would create a loop: ${names.join(' → ')}`;

/**
 * Refuses (400) a manager that is the employee themselves, isn't an active employee of the
 * workspace, or would close a loop: it walks up from the proposed manager, and if the chain
 * reaches the employee, names the loop. `managerId` null (no manager) is always fine.
 */
export async function assertValidManager(tx: Tx, employeeId: string, managerId: string | null): Promise<void> {
  if (!managerId) return;
  if (managerId === employeeId) throw new BadRequestException("An employee can't report to themselves");
  const [manager] = await tx.select({ id: employees.id, deactivatedAt: employees.deactivatedAt }).from(employees).where(eq(employees.id, managerId));
  if (!manager) throw new BadRequestException('The manager must be an employee of this workspace');
  if (manager.deactivatedAt) throw new BadRequestException('The manager must be an active employee: this person has left the company');

  const { rows } = await tx.execute<{ id: string; name: string }>(sql`
    with recursive up(id, manager_id, name, depth) as (
      select id, manager_id, full_name, 1 from employees where id = ${managerId}
      union all
      select e.id, e.manager_id, e.full_name, up.depth + 1 from employees e join up on e.id = up.manager_id
      where up.id <> ${employeeId} and up.depth < 1000
    )
    select id::text as id, name from up order by depth`);
  const at = rows.findIndex((r) => r.id === employeeId);
  if (at < 0) return;
  const [self] = await tx.select({ name: employees.fullName }).from(employees).where(eq(employees.id, employeeId));
  throw new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'reporting_loop',
    message: loopMessage([self?.name ?? 'This employee', ...rows.slice(0, at + 1).map((r) => r.name)]),
  });
}

/** A loop refusal of assertValidManager (409 `reporting_loop`), as opposed to other refusals. */
export function isLoopError(err: unknown): err is ConflictException {
  if (!(err instanceof ConflictException)) return false;
  const body = err.getResponse();
  return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === 'reporting_loop';
}

/** One manager change that was written: who, from whom, to whom. */
export interface ManagerChange {
  employeeId: string;
  oldManagerId: string | null;
  newManagerId: string | null;
}

/**
 * Sets the manager of each employee in `changes`, one after the other, so a bulk change is checked
 * against the lines it has already changed (A and B → C, then C → A is a loop). Takes the
 * reporting-line lock itself (a no-op when the transaction already holds it), locks each row,
 * skips employees whose manager doesn't change, and refuses the whole change on the first invalid
 * manager or loop. Returns what changed, for `queueManagerEmails`. Who may do it is the caller's
 * check.
 */
export async function setManagers(tx: Tx, tenantId: string, changes: readonly { employeeId: string; managerId: string | null }[]): Promise<ManagerChange[]> {
  if (!changes.length) return [];
  await lockReportingLines(tx, tenantId);
  const done: ManagerChange[] = [];
  for (const { employeeId, managerId } of changes) {
    const [current] = await tx.select({ managerId: employees.managerId }).from(employees).where(eq(employees.id, employeeId)).for('no key update');
    if (!current) throw new BadRequestException('Employee not found');
    if (current.managerId === managerId) continue;
    await assertValidManager(tx, employeeId, managerId);
    await tx.update(employees).set({ managerId }).where(eq(employees.id, employeeId));
    done.push({ employeeId, oldManagerId: current.managerId, newManagerId: managerId });
  }
  return done;
}

/**
 * Queues the "New manager" (to the employee) and "New direct report" (to the new manager) emails
 * of manager changes made in the app (spec 10.2), in the same transaction. The worker sends them
 * only to members who didn't make the change themselves and have "Org changes" on. Removing a
 * manager emails nobody. The import never calls this; deactivation passes `{ manager: false }`
 * (one "New manager" per moved report).
 */
export async function queueManagerEmails(
  jobs: JobsService,
  tx: Tx,
  tenantId: string,
  actorUserId: string | null,
  changes: readonly ManagerChange[],
  recipients: { employee?: boolean; manager?: boolean } = {},
): Promise<void> {
  for (const c of changes) {
    if (!c.newManagerId || c.newManagerId === c.oldManagerId) continue;
    const base = { tenantId, employeeId: c.employeeId, managerId: c.newManagerId, actorUserId };
    if (recipients.employee !== false) await jobs.send('people.reporting-line-changed', { ...base, recipient: 'employee' }, tx);
    if (recipients.manager !== false) await jobs.send('people.reporting-line-changed', { ...base, recipient: 'manager' }, tx);
  }
}
