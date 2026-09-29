import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthUser } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { invitations, type OnboardingUserStep, tenants, users } from '../../shared/database/schema';
import { IdentityService } from './identity.service';

export const OnboardingProfile = z.object({
  name: z.string().trim().min(1).max(100),
  jobTitle: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => v || null),
});
export type OnboardingProfile = z.infer<typeof OnboardingProfile>;

/** The steps in the order the app shows them. */
export type OnboardingStepKey = 'workspace' | OnboardingUserStep;

/**
 * Onboarding after the first sign-up (CD-115), per user:
 *
 * 1. **workspace** (required): join the workspace an invitation is for, or create one. Done once
 *    the user is a member of any workspace, so it is never stored.
 * 2. **profile** (required): the user's name (and, optionally, job title).
 * 3. **team** (owners only, can be skipped): invite colleagues to the workspace they created.
 *
 * Finished steps are stored on the user (`users.onboarding_steps`), so a refresh or a new session
 * resumes at the first unfinished one. Once every step that applies is done, `onboarded_at` is set
 * and the app opens directly from then on. Users who had a workspace before CD-115 were marked
 * onboarded by the migration.
 */
@Injectable()
export class UserOnboardingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly identity: IdentityService,
  ) {}

  async state(user: AuthUser) {
    const row = await this.row(user.id);
    const workspaces = await this.identity.listTenants(user.id);
    const pending = await this.pendingInvitations(user);
    if (row.onboardedAt) return { required: false, completedAt: row.onboardedAt, steps: [], invitations: pending };
    const saved = new Set(row.onboardingSteps);
    // Inviting the team is for the person who set the workspace up. Before a workspace exists it
    // is still ahead, unless the user was invited (they will join, not create).
    const team = workspaces.length ? workspaces.some((t) => t.role === 'owner') : pending.length === 0;
    const steps: { key: OnboardingStepKey; done: boolean; skippable: boolean }[] = [
      { key: 'workspace', done: workspaces.length > 0, skippable: false },
      { key: 'profile', done: saved.has('profile'), skippable: false },
      ...(team ? [{ key: 'team' as const, done: saved.has('team'), skippable: true }] : []),
    ];
    return { required: true, completedAt: null, steps, invitations: pending };
  }

  /** "About you": the name colleagues see, and the job title. */
  async saveProfile(user: AuthUser, input: OnboardingProfile) {
    await this.database.db
      .update(users)
      .set({ displayName: input.name, displayNameCustom: true, jobTitle: input.jobTitle, onboardingSteps: addStep('profile') })
      .where(eq(users.id, user.id));
    this.identity.forgetUser(user.authSubject);
    return this.completeIfDone(user);
  }

  /** "Invite your team" is done: the invitations went out through the Team API, or it was skipped. */
  async finishTeam(user: AuthUser) {
    await this.database.db
      .update(users)
      .set({ onboardingSteps: addStep('team') })
      .where(eq(users.id, user.id));
    return this.completeIfDone(user);
  }

  /** Marks the user onboarded once every step that applies is done, and returns the state. */
  async completeIfDone(user: AuthUser) {
    const state = await this.state(user);
    if (!state.required || !state.steps.every((s) => s.done)) return state;
    await this.database.db
      .update(users)
      .set({ onboardedAt: new Date() })
      .where(and(eq(users.id, user.id), isNull(users.onboardedAt)));
    return this.state(user);
  }

  /**
   * Invitations waiting for the signed-in user's email address, so someone who signed up without
   * the invite link at hand (the confirmation email opened in another tab) still joins the
   * workspace they were invited to instead of creating a second one.
   */
  private async pendingInvitations(user: AuthUser) {
    if (!user.email) return [];
    return this.database.db
      .select({
        id: invitations.id,
        tenantName: tenants.name,
        role: invitations.role,
        invitedBy: sql<string | null>`(select coalesce(u.display_name, u.email) from ${users} u where u.id = ${invitations.invitedByUserId})`,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
      .where(
        and(
          eq(invitations.email, user.email.toLowerCase()),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, sql`now()`),
          // A workspace the user is already in needs no invitation.
          sql`not exists (select 1 from memberships m where m.tenant_id = ${invitations.tenantId} and m.user_id = ${user.id})`,
        ),
      )
      .orderBy(asc(invitations.createdAt));
  }

  private async row(userId: string) {
    const [row] = await this.database.db
      .select({ onboardingSteps: users.onboardingSteps, onboardedAt: users.onboardedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!row) throw new NotFoundException('User not found');
    return row;
  }
}

/** Adds a step to `users.onboarding_steps` once, however often it is saved. */
const addStep = (step: OnboardingUserStep) =>
  sql`case when ${step} = any(${users.onboardingSteps}) then ${users.onboardingSteps} else array_append(${users.onboardingSteps}, ${step}::text) end`;
