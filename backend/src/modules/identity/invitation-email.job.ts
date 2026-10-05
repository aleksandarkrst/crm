import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { invitations, tenants, users } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { type JobAttempt, JobsService } from '../../shared/events/jobs.service';
import { invitationEmail, inviteLink, inviteLinkBox } from './invitation-email';
import { EmployeeInviteJob } from './employee-invite.job';
import { SignupEmailJob } from './signup-email.job';

/**
 * Worker side of CD-7: emails an invitation. A send that throws fails the job and pg-boss retries
 * it (MAIL_RETRY_LIMIT, backoff); the invitation stays "queued" with the last error until the
 * final attempt fails, then it is "failed". Invitations that were accepted, withdrawn or expired
 * in the meantime are not emailed.
 */
@Injectable()
export class InvitationEmailJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(InvitationEmailJob.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('identity.invitation-email', (data, attempt) => this.run(data, attempt));
  }

  async run({ tenantId, invitationId }: JobPayloads['identity.invitation-email'], attempt: JobAttempt): Promise<void> {
    const inviter = sql<string | null>`(select u.display_name from ${users} u where u.id = ${invitations.invitedByUserId})`;
    const inviterEmail = sql<string | null>`(select u.email from ${users} u where u.id = ${invitations.invitedByUserId})`;
    const [row] = await this.database.withTenant(tenantId, (tx) =>
      tx
        .select({
          email: invitations.email,
          role: invitations.role,
          tokenSealed: invitations.tokenSealed,
          expiresAt: invitations.expiresAt,
          acceptedAt: invitations.acceptedAt,
          revokedAt: invitations.revokedAt,
          workspaceName: tenants.name,
          timeZone: tenants.timezone,
          inviterName: inviter,
          inviterEmail,
        })
        .from(invitations)
        .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
        .where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, tenantId))),
    );
    if (!row || row.acceptedAt || row.revokedAt || row.expiresAt <= new Date()) {
      this.logger.log(`Invitation ${invitationId} is no longer pending; not emailed`);
      return;
    }
    if (this.mailer.notDelivered) {
      // Retrying can't help either, and "sent" would be a lie: the owner has to share the link.
      await this.setStatus(tenantId, invitationId, { emailStatus: 'failed', emailError: this.mailer.notDelivered });
      return;
    }
    const token = row.tokenSealed ? inviteLinkBox(this.env)?.open(row.tokenSealed) : null;
    if (!token) {
      // Retrying can't help: the link was sealed with another APP_SECRET (or never stored).
      await this.setStatus(tenantId, invitationId, { emailStatus: 'failed', emailError: "The invite link can't be read any more. Withdraw the invitation and invite them again." });
      return;
    }

    const message = invitationEmail({
      to: row.email,
      workspaceName: row.workspaceName,
      inviterName: row.inviterName,
      inviterEmail: row.inviterEmail,
      role: row.role,
      link: inviteLink(this.env.APP_URL, token),
      expiresAt: row.expiresAt,
      timeZone: row.timeZone,
    });
    try {
      await this.mailer.send(message);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.setStatus(tenantId, invitationId, { emailStatus: attempt.lastAttempt ? 'failed' : 'queued', emailError: reason.slice(0, 500) });
      throw err;
    }
    await this.setStatus(tenantId, invitationId, { emailStatus: 'sent', emailSentAt: new Date(), emailError: null });
  }

  private setStatus(tenantId: string, invitationId: string, set: Partial<typeof invitations.$inferInsert>) {
    return this.database.withTenant(tenantId, (tx) =>
      tx
        .update(invitations)
        .set(set)
        .where(and(eq(invitations.id, invitationId), eq(invitations.tenantId, tenantId))),
    );
  }
}

/** Registered in the worker (WorkerModule). */
@Module({ providers: [InvitationEmailJob, SignupEmailJob, EmployeeInviteJob] })
export class IdentityWorkerModule {}
