import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { SecretBox } from '../../infrastructure/crypto/secret-box';
import { AuditService } from '../../shared/audit/audit.service';
import { type AuthUser, hasRole, type TenantContext } from '../../shared/authorization';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { employees, INVITATION_ROLES, invitations, MEMBERSHIP_ROLES, memberships, tenants, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { createInvitedEmployee, dropUnusedInvitedEmployees, linkNewMember } from '../people';
import { inviteLinkBox } from './invitation-email';
import { createInvitation, hashInviteToken, invitationColumns, inviteExpiry, keepAnOwner, pendingInvitation as pending, removeMembership } from './membership';

export const CreateInvitation = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  role: z.enum(INVITATION_ROLES).default('member'),
});
export const UpdateMember = z.object({ role: z.enum(MEMBERSHIP_ROLES) });
export type CreateInvitation = z.infer<typeof CreateInvitation>;
export type UpdateMember = z.infer<typeof UpdateMember>;

const NO_STORED_LINK = 'This invitation was created before invite links were kept, so it can only be withdrawn. Withdraw it and invite them again.';

/**
 * Team management: members of a tenant and invitations to join it.
 *
 * Rules: admins invite and manage members; only an owner can grant or take away the owner role
 * or remove an owner; a tenant always keeps at least one owner. An invitation can only be
 * accepted by a signed-in user with the invited email address.
 */
@Injectable()
export class TeamService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.box = inviteLinkBox(env);
  }

  /** Members (with their employee record, milestone 13: the Team tab links to the card) and pending invitations. */
  list(ctx: TenantContext) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const members = await tx
        .select({ userId: users.id, email: users.email, displayName: users.displayName, role: memberships.role, joinedAt: memberships.createdAt, employeeId: employees.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(employees, and(eq(employees.userId, memberships.userId), eq(employees.tenantId, memberships.tenantId)))
        .where(eq(memberships.tenantId, ctx.tenantId))
        .orderBy(asc(memberships.createdAt));
      const invites = await tx
        .select(invitationColumns)
        .from(invitations)
        .where(and(eq(invitations.tenantId, ctx.tenantId), pending()))
        .orderBy(asc(invitations.createdAt));
      return { members, invitations: invites };
    });
  }

  /**
   * Returns the one-time token; the frontend turns it into the invite link. The worker emails the
   * link too (job "identity.invitation-email", queued in this transaction). The invited person gets
   * an employee record (CD-226, people's `createInvitedEmployee`), shown as Invited on the Org
   * structure; accepting links it.
   */
  invite(ctx: TenantContext, input: CreateInvitation) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const employeeId = await createInvitedEmployee(tx, ctx.tenantId, input.email);
      return createInvitation(tx, { jobs: this.jobs, audit: this.audit, env: this.env }, ctx, { ...input, employeeId });
    });
  }

  /** Emails a pending invitation again, with the same link, and gives it another 7 days. */
  resend(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const found = await this.pendingInvitation(tx, ctx.tenantId, id);
      if (!found.tokenSealed || !this.box?.open(found.tokenSealed)) throw new ConflictException(NO_STORED_LINK);
      const [row] = await tx
        .update(invitations)
        .set({ emailStatus: 'queued', emailError: null, expiresAt: inviteExpiry() })
        .where(and(eq(invitations.id, id), eq(invitations.tenantId, ctx.tenantId)))
        .returning(invitationColumns);
      await this.jobs.send('identity.invitation-email', { tenantId: ctx.tenantId, invitationId: id }, tx);
      await this.audit.record(tx, ctx, { action: 'invitation.resent', entityType: 'invitation', entityId: id });
      return row!;
    });
  }

  /** The token of a pending invitation, for "Copy link" (the same link as in the email). */
  link(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const found = await this.pendingInvitation(tx, ctx.tenantId, id);
      const token = found.tokenSealed ? this.box?.open(found.tokenSealed) : null;
      if (!token) throw new ConflictException(NO_STORED_LINK);
      return { token };
    });
  }

  private async pendingInvitation(tx: Tx, tenantId: string, id: string) {
    const [row] = await tx
      .select({ id: invitations.id, tokenSealed: invitations.tokenSealed })
      .from(invitations)
      .where(and(eq(invitations.id, id), eq(invitations.tenantId, tenantId), pending()));
    if (!row) throw new NotFoundException('Invitation not found. It may have been accepted, withdrawn or expired.');
    return row;
  }

  revoke(ctx: TenantContext, id: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(and(eq(invitations.id, id), eq(invitations.tenantId, ctx.tenantId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
        .returning({ id: invitations.id });
      if (!row) throw new NotFoundException('Invitation not found');
      await this.audit.record(tx, ctx, { action: 'invitation.revoked', entityType: 'invitation', entityId: id });
      // The employee record the invitation made goes with it (CD-226).
      await dropUnusedInvitedEmployees(tx, ctx.tenantId);
    });
  }

  updateMember(ctx: TenantContext, userId: string, input: UpdateMember) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const target = await this.memberRole(tx, ctx.tenantId, userId);
      if ((target === 'owner' || input.role === 'owner') && ctx.role !== 'owner') throw new ForbiddenException('Only an owner can change who is an owner');
      if (target === 'owner' && input.role !== 'owner') await keepAnOwner(tx, ctx.tenantId);
      await tx.update(memberships).set({ role: input.role }).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)));
      await this.audit.record(tx, ctx, { action: 'member.role_changed', entityType: 'user', entityId: userId, data: { from: target, to: input.role } });
      return { userId, role: input.role };
    });
  }

  /** Admins remove members; anyone may remove themselves (leave). Their future meetings are updated by a job. */
  removeMember(ctx: TenantContext, userId: string) {
    return this.database.withTenant(ctx.tenantId, async (tx) => {
      const self = userId === ctx.userId;
      if (!self && !hasRole(ctx.role, 'admin')) throw new ForbiddenException('Requires admin role');
      const target = await this.memberRole(tx, ctx.tenantId, userId);
      if (target === 'owner' && !self && ctx.role !== 'owner') throw new ForbiddenException('Only an owner can remove an owner');
      // Their employee record stays, Active with "No account" (spec 4.8).
      await removeMembership(tx, this.audit, ctx, userId, self ? 'member.left' : 'member.removed');
      // CRM takes them off future meetings (CD-131), only if this commits.
      await this.jobs.send('identity.member-removed', { tenantId: ctx.tenantId, userId }, tx);
    });
  }

  /** What an invite link is for, shown before accepting it. */
  async preview(token: string) {
    const row = await this.findByToken(token);
    const [inviter] = row.invitedByUserId
      ? await this.database.db.select({ name: sql<string | null>`coalesce(${users.displayName}, ${users.email})` }).from(users).where(eq(users.id, row.invitedByUserId))
      : [];
    return { tenantName: row.tenantName, email: row.email, role: row.role, invitedBy: inviter?.name ?? null, expiresAt: row.expiresAt };
  }

  /** Joins the tenant. The signed-in user's email must be the invited one. */
  async accept(user: AuthUser, token: string) {
    return this.join(user, await this.findByToken(token));
  }

  /**
   * Joins the tenant of a pending invitation for the signed-in user's email, found by its id
   * instead of the link (CD-115: onboarding lists the invitations waiting for the address).
   */
  async acceptPending(user: AuthUser, id: string) {
    // Someone else's invitation is "not found": its id says nothing about who it is for.
    const email = user.email?.toLowerCase() ?? '';
    return this.join(user, await this.find(and(eq(invitations.id, id), eq(invitations.email, email))!));
  }

  private async join(user: AuthUser, row: Awaited<ReturnType<TeamService['find']>>) {
    if (!user.email) throw new BadRequestException('Your sign-in did not include an email address, so the invitation cannot be matched to you');
    if (user.email.toLowerCase() !== row.email) throw new ForbiddenException(`This invitation is for ${row.email}. You are signed in as ${user.email}.`);

    const ctx: TenantContext = { tenantId: row.tenantId, userId: user.id, role: row.role };
    return this.database.withTenant(row.tenantId, async (tx) => {
      const [claimed] = await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedByUserId: user.id })
        .where(and(eq(invitations.id, row.id), pending()))
        .returning({ id: invitations.id });
      if (!claimed) throw new GoneException('This invitation was already used or withdrawn');
      // Someone who is already a member keeps their current role (and their employee record).
      const [joined] = await tx
        .insert(memberships)
        .values({ tenantId: row.tenantId, userId: user.id, role: row.role })
        .onConflictDoNothing()
        .returning({ userId: memberships.userId });
      // The new member's employee record (spec 4.6): the one the invitation was sent from, else
      // one with their email, else a new one.
      if (joined) {
        await linkNewMember(tx, { tenantId: row.tenantId, userId: user.id, invitedEmployeeId: row.employeeId });
      }
      const role = (await this.memberRole(tx, row.tenantId, user.id))!;
      await this.audit.record(tx, ctx, { action: 'invitation.accepted', entityType: 'invitation', entityId: row.id });
      return { id: row.tenantId, name: row.tenantName, slug: row.tenantSlug, role };
    });
  }

  private findByToken(token: string) {
    return this.find(eq(invitations.tokenHash, hashInviteToken(token)));
  }

  private async find(where: SQL) {
    const [row] = await this.database.db
      .select({
        id: invitations.id,
        tenantId: invitations.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        email: invitations.email,
        role: invitations.role,
        invitedByUserId: invitations.invitedByUserId,
        employeeId: invitations.employeeId,
        expiresAt: invitations.expiresAt,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
      })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .where(where);
    if (!row) throw new NotFoundException('Invitation not found');
    if (row.acceptedAt || row.revokedAt || row.expiresAt <= new Date()) throw new GoneException('This invitation has expired or was already used');
    return row;
  }

  private async memberRole(tx: Tx, tenantId: string, userId: string) {
    const [m] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)));
    if (!m) throw new NotFoundException('Member not found');
    return m.role;
  }
}
