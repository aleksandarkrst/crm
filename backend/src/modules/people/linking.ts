import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { employees, invitations, memberships, tenants, users } from '../../shared/database/schema';

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
 * A member who already has a record in the workspace keeps it. A linked record without a work email
 * gets the sign-in email, unless another record has it (CD-226: work email = sign-in email); one
 * made by the invitation (`created_from_invite`) takes its names from the profile.
 */
export async function linkNewMember(tx: Tx, member: NewMember): Promise<string> {
  const [existing] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, member.userId));
  if (existing) return existing.id;
  const [user] = await tx.select({ email: users.email, displayName: users.displayName }).from(users).where(eq(users.id, member.userId));
  const email = user?.email?.trim().toLowerCase() || null;

  const link = async (where: ReturnType<typeof and>) => {
    const [row] = await tx
      .update(employees)
      .set({ userId: member.userId, firstLinkedAt: sql`coalesce(${employees.firstLinkedAt}, now())` })
      .where(and(where, isNull(employees.userId), isNull(employees.deactivatedAt)))
      .returning({ id: employees.id, createdFromInvite: employees.createdFromInvite });
    if (!row) return null;
    const names = row.createdFromInvite ? profileNames(user?.displayName ?? null) : null;
    if (names) await tx.update(employees).set(names).where(eq(employees.id, row.id));
    if (email) await fillWorkEmail(tx, row.id, email);
    return row.id;
  };

  if (member.invitedEmployeeId) {
    const id = await link(eq(employees.id, member.invitedEmployeeId));
    if (id) return id;
  }
  if (email) {
    const id = await link(sql`lower(${employees.workEmail}) = ${email}`);
    if (id) return id;
  }
  const { rows } = await tx.execute<{ id: string }>(sql`select people_create_member_employee(${member.tenantId}, ${member.userId})::text as id`);
  return rows[0]!.id;
}

/**
 * First and last name from a profile's display name, split at the last space like
 * people_create_member_employee; null without a name or with one word (the names from the email
 * stay then).
 */
function profileNames(displayName: string | null): { firstName: string; lastName: string } | null {
  const name = displayName?.replace(/\s+/g, ' ').trim();
  const at = name ? name.lastIndexOf(' ') : -1;
  if (!name || at < 0) return null;
  return { firstName: name.slice(0, at).slice(0, 100), lastName: name.slice(at + 1).slice(0, 100) };
}

/** Sets the work email of `employeeId` to `email` when it has none and no other record has it. */
async function fillWorkEmail(tx: Tx, employeeId: string, email: string) {
  await tx
    .update(employees)
    .set({ workEmail: email })
    .where(and(eq(employees.id, employeeId), isNull(employees.workEmail), sql`not exists (select 1 from ${employees} o where o.tenant_id = ${employees.tenantId} and lower(o.work_email) = ${email})`));
}

/**
 * The employee record of someone invited in Settings → Team (CD-226), so the Org structure shows
 * them as Invited. Called by identity through people's index.ts inside its transaction, before the
 * invitation is created; returns the id for `invitations.employee_id` (accepting links that record,
 * rule 1 above), or null when there is nothing to link:
 * - an active record without an account that has the email as its work email: that one;
 * - any other record with that work email (a member's, or someone who left): null, it is taken;
 * - otherwise a new record: names from the email's local part (`emailNames`), work email = the
 *   invited email, `created_from_invite` (names from the profile on joining; deleted if the
 *   invitation is withdrawn or expires first, `dropUnusedInvitedEmployees`).
 */
export async function createInvitedEmployee(tx: Tx, tenantId: string, email: string): Promise<string | null> {
  const mail = email.trim().toLowerCase();
  const [same] = await tx
    .select({ id: employees.id, userId: employees.userId, deactivatedAt: employees.deactivatedAt })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), sql`lower(${employees.workEmail}) = ${mail}`));
  if (same) return !same.userId && !same.deactivatedAt ? same.id : null;
  const [settings] = await tx.select({ hours: tenants.employeeDefaultWeeklyHours }).from(tenants).where(eq(tenants.id, tenantId));
  const [row] = await tx
    .insert(employees)
    .values({ tenantId, ...emailNames(mail), workEmail: mail, weeklyHours: settings?.hours ?? 40, createdFromInvite: true })
    .returning({ id: employees.id });
  return row!.id;
}

/**
 * Names from an email's local part: words split at dots, dashes, underscores and plus signs,
 * capitalised, the last word is the last name ("ana.petrovic" → Ana Petrovic); one word is both.
 */
export function emailNames(email: string): { firstName: string; lastName: string } {
  const words = (email.split('@')[0] ?? '')
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  if (!words.length) return { firstName: 'Invited', lastName: 'Person' };
  const last = words.length > 1 ? words.pop()! : words[0]!;
  return { firstName: words.join(' ').slice(0, 100), lastName: last.slice(0, 100) };
}

/**
 * Deletes the records made by invitations (`created_from_invite`) that nobody ever linked and that
 * have no pending invitation any more: withdrawn (Settings → Team, the card) or expired (the people
 * worker's tick, people-jobs.ts). People who were deactivated stay. Returns how many went.
 */
export async function dropUnusedInvitedEmployees(tx: Tx, tenantId: string): Promise<number> {
  const rows = await tx
    .delete(employees)
    .where(
      and(
        eq(employees.tenantId, tenantId),
        eq(employees.createdFromInvite, true),
        isNull(employees.userId),
        isNull(employees.firstLinkedAt),
        isNull(employees.deactivatedAt),
        sql`not exists (select 1 from ${invitations} i where i.employee_id = ${employees.id} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())`,
      ),
    )
    .returning({ id: employees.id });
  return rows.length;
}

/**
 * A member's sign-in email changed (CD-226, `IdentityService.upsert`, in its transaction): in each
 * workspace they belong to, their employee record's work email follows when it was empty or the
 * old address, unless another record has the new one. Sets app.tenant_id per workspace (RLS) and
 * clears it afterwards.
 */
export async function syncWorkEmail(tx: Tx, userId: string, oldEmail: string | null, newEmail: string): Promise<void> {
  const mail = newEmail.trim().toLowerCase();
  const old = oldEmail?.trim().toLowerCase() || null;
  const workspaces = await tx.select({ tenantId: memberships.tenantId }).from(memberships).where(eq(memberships.userId, userId));
  for (const { tenantId } of workspaces) {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx
      .update(employees)
      .set({ workEmail: mail })
      .where(
        and(
          eq(employees.tenantId, tenantId),
          eq(employees.userId, userId),
          old ? sql`(${employees.workEmail} is null or lower(${employees.workEmail}) = ${old})` : isNull(employees.workEmail),
          sql`not exists (select 1 from ${employees} o where o.tenant_id = ${tenantId} and lower(o.work_email) = ${mail} and o.id <> ${employees.id})`,
        ),
      );
  }
  if (workspaces.length) await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
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
