import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Mailer } from '../../infrastructure/mail/mailer';
import { DatabaseService } from '../../shared/database/database.service';
import { signupRequests } from '../../shared/database/schema';
import type { JobPayloads } from '../../shared/events/job-types';
import { JobsService } from '../../shared/events/jobs.service';
import { existingAccountEmail, loginLink, signInMethod, signupEmail, signupLink, signupLinkBox } from './signup-email';
import { accountFor, SIGNUP_TTL_HOURS } from './signup.service';

/**
 * Worker side of "Continue with email" (CD-114): emails the confirmation link, or, when the
 * address already has an account, tells its owner to sign in. A send that throws is retried
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
    if (account) {
      await this.mailer.send(existingAccountEmail({ to: row.email, link: loginLink(this.env.APP_URL), method: signInMethod(account.authSubject) }));
      return;
    }
    const token = signupLinkBox(this.env)?.open(row.tokenSealed);
    if (!token) {
      // Sealed with another APP_SECRET: retrying can't help. Asking again sends a new link.
      this.logger.error(`Sign-up request ${requestId}: the link can't be read with this APP_SECRET; not emailed`);
      return;
    }
    await this.mailer.send(signupEmail({ to: row.email, link: signupLink(this.env.APP_URL, token), hours: SIGNUP_TTL_HOURS }));
  }
}
