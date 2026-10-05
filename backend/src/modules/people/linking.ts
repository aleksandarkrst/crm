import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { employees, users } from '../../shared/database/schema';

/**
 * The link between a member and their employee record (spec 4.6). The identity module calls these
 * through people's index.ts, inside its own transaction (app.tenant_id set), when a membership is
 * created or removed. Every member is an employee: a workspace's creator and everyone who joins
 * gets a linked record.
 */

export interface NewMember {
  tenantId: string;
  userId: string;
  /** invitations.employee_id of the accepted invitation, when it was sent from an employee card. */
  invitedEmployeeId?: string | null;
}

/**
 * Links a new member to an employee record by the first rule that applies, and returns its id:
 *   1. the invitation was sent from an employee record that has no account: that record;
 *   2. an active employee without an account has the member's sign-in email as work email: that one;
 *   3. otherwise a new record from the profile (people_create_member_employee, the same function
 *      the migration used: name split at the last space, work email, job title and phone).
 * A member who already has a record in the workspace keeps it.
 */
export async function linkNewMember(tx: Tx, member: NewMember): Promise<string> {
  const [existing] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, member.userId));
  if (existing) return existing.id;

  const link = async (where: ReturnType<typeof and>) => {
    const [row] = await tx
      .update(employees)
      .set({ userId: member.userId, firstLinkedAt: sql`coalesce(${employees.firstLinkedAt}, now())` })
      .where(and(where, isNull(employees.userId), isNull(employees.deactivatedAt)))
      .returning({ id: employees.id });
    return row?.id ?? null;
  };

  if (member.invitedEmployeeId) {
    const id = await link(eq(employees.id, member.invitedEmployeeId));
    if (id) return id;
  }
  const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, member.userId));
  const email = user?.email?.trim().toLowerCase();
  if (email) {
    const id = await link(sql`lower(${employees.workEmail}) = ${email}`);
    if (id) return id;
  }
  const { rows } = await tx.execute<{ id: string }>(sql`select people_create_member_employee(${member.tenantId}, ${member.userId})::text as id`);
  return rows[0]!.id;
}

/**
 * A member was removed or left: their employee record stays (Active, "No account") and only the
 * link goes (spec 4.8). Deactivation is a separate, deliberate step.
 */
export async function unlinkMember(tx: Tx, tenantId: string, userId: string): Promise<void> {
  await tx
    .update(employees)
    .set({ userId: null })
    .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)));
}

