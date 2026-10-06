import { ConflictException } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../../infrastructure/config/config.module';
import type { AuditService } from '../../shared/audit/audit.service';
import type { TenantContext } from '../../shared/authorization';
import type { Tx } from '../../shared/database/database.service';
import { type InvitationRole, invitations, memberships, users } from '../../shared/database/schema';
import type { JobsService } from '../../shared/events/jobs.service';
import { unlinkMember } from '../people';
import { inviteLinkBox } from './invitation-email';

/**
 * Identity's public API for other modules (through index.ts): inviting someone and removing a
 * membership inside the caller's transaction (app.tenant_id set). TeamService uses the same
 * functions, so Settings → Team and the people module (spec 4.7, 4.8) follow one set of rules.
 * Plain functions, not a service: the worker (people.deactivate-due) has no
 * IdentityModule.
 */

const INVITE_TTL_DAYS = 7;

export const hashInviteToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** Not accepted, withdrawn or expired. */
export const pendingInvitation = () => and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, sql`now()`));
export const inviteExpiry = () => new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);

/** What the Team tab and the employee card show about a pending invitation (CD-7). */
export const invitationColumns = {
  id: invitations.id,
  email: invitations.email,
  role: invitations.role,
  expiresAt: invitations.expiresAt,
  createdAt: invitations.createdAt,
  emailStatus: invitations.emailStatus,
  emailSentAt: invitations.emailSentAt,
  emailError: invitations.emailError,
  /** False for invitations from before CD-7: no stored link to resend or copy. */
  hasLink: sql<boolean>`${invitations.tokenSealed} is not null`,
  /** The employee card it was sent from (milestone 13), if any. */
  employeeId: invitations.employeeId,
};

export interface InvitationDeps {
  jobs: JobsService;
  audit: AuditService;
  env: Env;
}

export interface NewInvitation {
  email: string;
  role: InvitationRole;
  /** The employee record it is sent from (spec 4.7): accepting it links the new member to that record. */
  employeeId?: string | null;
}

/**
 * Creates an invitation and queues its email (job "identity.invitation-email"), in `tx`. An
 * existing member's address is refused (409); a pending invitation for the same address is
 * replaced. Returns the row and the one-time token (the frontend turns it into the link).
 */
export async function createInvitation(tx: Tx, deps: InvitationDeps, ctx: TenantContext, input: NewInvitation) {
  const email = input.email.trim().toLowerCase();
  const [existing] = await tx
    .select({ userId: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, ctx.tenantId), sql`lower(${users.email}) = ${email}`));
  if (existing) throw new ConflictException(`${email} is already a member`);

  // A new invitation replaces any pending one for the same address.
  await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.tenantId, ctx.tenantId), eq(invitations.email, email), pendingInvitation()));

  const box = inviteLinkBox(deps.env);
  const token = randomBytes(32).toString('base64url');
  const [row] = await tx
    .insert(invitations)
    .values({
      tenantId: ctx.tenantId,
      email,
      role: input.role,
      tokenHash: hashInviteToken(token),
      invitedByUserId: ctx.userId,
      expiresAt: inviteExpiry(),
      tokenSealed: box?.seal(token) ?? null,
      emailStatus: box ? 'queued' : null,
      employeeId: input.employeeId ?? null,
    })
    .returning(invitationColumns);
  if (box) await deps.jobs.send('identity.invitation-email', { tenantId: ctx.tenantId, invitationId: row!.id }, tx);
  await deps.audit.record(tx, ctx, {
    action: 'invitation.created',
    entityType: 'invitation',
    entityId: row!.id,
    data: { email, role: input.role, ...(input.employeeId ? { employeeId: input.employeeId } : {}) },
  });
  return { invitation: row!, token };
}

/**
 * Withdraws the pending invitations sent from an employee record (its work email changed, or the
 * employee was deactivated, spec 4.7, 4.8). Returns how many were withdrawn.
 */
export async function withdrawEmployeeInvitations(tx: Tx, tenantId: string, employeeId: string): Promise<number> {
  const rows = await tx
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.employeeId, employeeId), pendingInvitation()))
    .returning({ id: invitations.id });
  return rows.length;
}

/** Throws if the tenant would be left without an owner after one owner is demoted or removed. */
export async function keepAnOwner(tx: Tx, tenantId: string): Promise<void> {
  // Lock the owner rows so two concurrent demotions can't both pass the check.
  const owners = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, 'owner')))
    .for('update');
  if (owners.length <= 1) throw new ConflictException('A workspace needs at least one owner. Make someone else an owner first.');
}

/** The member's workspace role, or null when they aren't a member. */
export async function membershipRole(tx: Tx, tenantId: string, userId: string) {
  const [m] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
  return m?.role ?? null;
}

/**
 * Removes a membership, in `tx`: the last owner can't go (409 "Make someone else an owner
 * first"), the member's employee record loses its link (people, spec 4.8) and the audit log says
 * `action`. The caller decides which event other modules get: Settings → Team sends
 * "identity.member-removed", deactivation "people.employee-deactivated". Returns false when they
 * weren't a member.
 */
export async function removeMembership(tx: Tx, audit: AuditService, ctx: TenantContext, userId: string, action: 'member.removed' | 'member.left' | 'member.deactivated'): Promise<boolean> {
  const role = await membershipRole(tx, ctx.tenantId, userId);
  if (!role) return false;
  if (role === 'owner') await keepAnOwner(tx, ctx.tenantId);
  await tx.delete(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)));
  // Their employee record stays (spec 4.8): Active with "No account", or Inactive when deactivated.
  await unlinkMember(tx, ctx.tenantId, userId);
  await audit.record(tx, ctx, { action, entityType: 'user', entityId: userId });
  return true;
}
