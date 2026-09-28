import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { signupRequests } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { JobsService } from '../../shared/events/jobs.service';
import { existingAccountEmail, loginLink, noPasswordEmail, passwordResetEmail, resetLink, signInMethod, signupEmail, signupLink, signupLinkBox } from './signup-email';
import { accountFor, providerUserId, SIGNUP_TTL_HOURS, TTL_HOURS } from './signup.service';

/**
 * Worker side of "Continue with email" and "Forgot password?" (CD-114): emails the link, or, when
 * the address already has an account (sign-up) or has no password (reset), how to sign in instead.
 * A reset for an address without an account sends nothing. A send that throws is retried
 * (MAIL_JOBS). Requests that were used, replaced or expired in the meantime are not emailed.
 */
@Injectable()
export class SignupEmailJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(SignupEmailJob.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly database: DatabaseService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.jobs.work('identity.signup-email', (data) => this.run(data));
  }

  async run({ requestId }: JobPayloads['identity.signup-email']): Promise<void> {
    const found = await this.database.db.transaction(async (tx) => {
      const [row] = await tx.select().from(signupRequests).where(eq(signupRequests.id, requestId));
      return row && { row, account: await accountFor(tx, row.email) };
    });
    if (!found || found.row.usedAt || found.row.expiresAt <= new Date()) {
      this.logger.log(`Sign-up request ${requestId} is no longer pending; not emailed`);
      return;
    }
    const { row, account } = found;
    if (row.purpose === 'reset') return this.reset(row, account);
    if (account) {
      await this.mailer.send(existingAccountEmail({ to: row.email, link: loginLink(this.env.APP_URL), method: signInMethod(account.authSubject) }));
      return;
    }
    const token = this.open(row);
    if (!token) return;
    await this.mailer.send(signupEmail({ to: row.email, link: signupLink(this.env.APP_URL, token), hours: SIGNUP_TTL_HOURS }));
  }

  private async reset(row: typeof signupRequests.$inferSelect, account: { authSubject: string } | null): Promise<void> {
    if (!account) {
      this.logger.log(`Password reset ${row.id}: no account for the address; not emailed`);
      return;
    }
    if (!providerUserId(account.authSubject, this.env.AUTH_MODE)) {
      await this.mailer.send(noPasswordEmail({ to: row.email, link: loginLink(this.env.APP_URL) }));
      return;
    }
    const token = this.open(row);
    if (token) await this.mailer.send(passwordResetEmail({ to: row.email, link: resetLink(this.env.APP_URL, token), hours: TTL_HOURS.reset }));
  }

  private open(row: typeof signupRequests.$inferSelect): string | null {
    const token = signupLinkBox(this.env)?.open(row.tokenSealed) ?? null;
    // Sealed with another APP_SECRET: retrying can't help. Asking again sends a new link.
    if (!token) this.logger.error(`Email link ${row.id} can't be read with this APP_SECRET; not emailed`);
    return token;
  }
}
