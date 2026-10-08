import { BadRequestException, ConflictException, GoneException, HttpStatus, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { and, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { SecretBox } from '../../infrastructure/crypto/secret-box';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { signupRequests, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { AccountDirectory, AccountError } from './accounts';
import { type PasswordPolicy, passwordProblem } from './password-policy';
import { signInMethod, signupLinkBox } from './signup-email';

/** What an emailed link is for: creating an account, or choosing a new password ("Forgot password?"). */
export type LinkPurpose = 'signup' | 'reset';
export const SIGNUP_TTL_HOURS = 24;
/** A reset link opens the account, so it works for a shorter time. */
export const RESET_TTL_HOURS = 1;
export const TTL_HOURS: Record<LinkPurpose, number> = { signup: SIGNUP_TTL_HOURS, reset: RESET_TTL_HOURS };
/** A new email for the same address at most this often; asking sooner keeps the last one. */
const RESEND_AFTER_MS = 60_000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Why an emailed link doesn't work. The page explains it and offers a new email. */
export type LinkProblem = 'invalid' | 'expired' | 'used';
const INVALID = "This link doesn't work. It may be incomplete, or a newer email replaced it. Use the newest email, or ask for a new one.";
const LINK_PROBLEMS: Record<LinkPurpose, Record<LinkProblem, string>> = {
  signup: {
    invalid: INVALID,
    expired: `This link has expired: it works for ${SIGNUP_TTL_HOURS} hours. Ask for a new email.`,
    used: 'This link was already used, so the account exists. Sign in with your email and password.',
  },
  reset: {
    invalid: INVALID,
    expired: `This link has expired: it works for ${RESET_TTL_HOURS} hour. Ask for a new email.`,
    used: 'This link was already used. Sign in with your new password, or ask for another link.',
  },
};
const linkProblem = (purpose: LinkPurpose, code: LinkProblem, email?: string) =>
  new GoneException({ statusCode: HttpStatus.GONE, code, message: LINK_PROBLEMS[purpose][code], ...(code === 'expired' && email ? { email } : {}) });

/** The account an address already has, whichever way it signs in. */
export async function accountFor(tx: Tx, email: string) {
  const [row] = await tx.select({ authSubject: users.authSubject }).from(users).where(eq(sql`lower(${users.email})`, email)).limit(1);
  return row ?? null;
}

/**
 * "Create account" with email and password (CD-114): confirm the address first, then let the
 * person choose a password, which goes to the identity provider (AccountDirectory), never here.
 *
 * start() answers the same whether or not the address has an account; the email itself tells an
 * existing user to sign in instead (SignupEmailJob).
 */
@Injectable()
export class SignupService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: JobsService,
    private readonly accounts: AccountDirectory,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.box = signupLinkBox(env);
  }

  /** Which ways of creating an account this server offers. `google` is the provider's connection name. */
  options() {
    // Production with the log driver delivers nothing (docs/DEPLOYMENT.md, "Email").
    const mailWorks = this.env.MAIL_DRIVER === 'smtp' || this.env.NODE_ENV !== 'production';
    return {
      email: this.accounts.available && mailWorks && !!this.box,
      google: this.env.AUTH_MODE === 'oidc' && this.env.AUTH_GOOGLE_CONNECTION ? this.env.AUTH_GOOGLE_CONNECTION : null,
    };
  }

  /** Emails the link that confirms the address. The same answer whether or not the address has an account. */
  start(email: string): Promise<void> {
    return this.request(email, 'signup');
  }

  /**
   * "Forgot password?": emails a link to choose a new password. The same answer whatever the
   * address; the email itself says when the account signs in with Google instead.
   */
  startReset(email: string): Promise<void> {
    return this.request(email, 'reset');
  }

  private async request(email: string, purpose: LinkPurpose): Promise<void> {
    if (!this.options().email || !this.box) {
      throw new ServiceUnavailableException(purpose === 'signup' ? "Creating an account with email isn't available here." : "Resetting a password isn't available here yet.");
    }
    const box = this.box;
    const pending = and(eq(signupRequests.email, email), eq(signupRequests.purpose, purpose), isNull(signupRequests.usedAt));
    await this.database.db.transaction(async (tx) => {
      // One request at a time per address, so two quick clicks don't send two emails.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${purpose}:${email}`}))`);
      const [recent] = await tx
        .select({ id: signupRequests.id })
        .from(signupRequests)
        .where(and(pending, gt(signupRequests.createdAt, new Date(Date.now() - RESEND_AFTER_MS))))
        .limit(1);
      if (recent) return;
      // A new email replaces the older links, and requests long gone are cleaned up on the way.
      await tx.delete(signupRequests).where(or(pending, lt(signupRequests.expiresAt, sql`now() - interval '7 days'`)));
      const token = randomBytes(32).toString('base64url');
      const [row] = await tx
        .insert(signupRequests)
        .values({ email, purpose, tokenHash: hashToken(token), tokenSealed: box.seal(token), expiresAt: new Date(Date.now() + TTL_HOURS[purpose] * 3_600_000) })
        .returning({ id: signupRequests.id });
      await this.jobs.send('identity.signup-email', { requestId: row!.id }, tx);
    });
  }

  /**
   * The address a working link is for, and the password rules, for the "choose a password" page.
   * Doesn't use the link up.
   */
  async check(token: string, purpose: LinkPurpose = 'signup'): Promise<{ email: string; password: PasswordPolicy }> {
    const [row] = await this.database.db.select().from(signupRequests).where(eq(signupRequests.tokenHash, hashToken(token)));
    const { email } = usable(row, purpose);
    return { email, password: await this.accounts.passwordPolicy() };
  }

  /** Refuses a password that misses the provider's rules before asking the provider. */
  private async checkPassword(password: string): Promise<void> {
    const problem = passwordProblem(password, await this.accounts.passwordPolicy());
    if (problem) refused(new AccountError('password', problem));
  }

  /**
   * Uses the link up and creates the account with the chosen password. The row stays locked while
   * the provider answers, so the same link can't create two accounts.
   */
  async complete(token: string, password: string): Promise<{ email: string }> {
    await this.checkPassword(password);
    const outcome = await this.database.db.transaction(async (tx) => {
      const [row] = await tx.select().from(signupRequests).where(eq(signupRequests.tokenHash, hashToken(token))).for('update');
      const { id, email } = usable(row, 'signup');
      const useUp = () => tx.update(signupRequests).set({ usedAt: new Date() }).where(eq(signupRequests.id, id));
      if (await accountFor(tx, email)) {
        await useUp();
        return { kind: 'exists', email } as const;
      }
      try {
        await this.accounts.createPasswordUser(email, password);
      } catch (err) {
        if (!(err instanceof AccountError)) throw err;
        if (err.reason !== 'exists') return { kind: 'refused', error: err } as const;
        await useUp();
        return { kind: 'exists', email } as const;
      }
      await useUp();
      // Links for the same address sent before this one can't create a second account.
      await tx.delete(signupRequests).where(and(eq(signupRequests.email, email), ne(signupRequests.id, id), isNull(signupRequests.usedAt)));
      return { kind: 'created', email } as const;
    });
    if (outcome.kind === 'refused') refused(outcome.error);
    if (outcome.kind === 'exists') throw new ConflictException({ statusCode: HttpStatus.CONFLICT, code: 'exists', message: 'This email already has an account. Sign in instead.', email: outcome.email });
    return { email: outcome.email };
  }

  /**
   * Uses a reset link up and gives the account the new password. Only accounts that sign in with
   * a password have one to reset; the email to any other kind carries no link (SignupEmailJob).
   */
  async resetPassword(token: string, password: string): Promise<{ email: string }> {
    await this.checkPassword(password);
    const outcome = await this.database.db.transaction(async (tx) => {
      const [row] = await tx.select().from(signupRequests).where(eq(signupRequests.tokenHash, hashToken(token))).for('update');
      const { id, email } = usable(row, 'reset');
      const account = await accountFor(tx, email);
      const userId = account && providerUserId(account.authSubject, this.env.AUTH_MODE);
      if (!userId) throw linkProblem('reset', 'invalid');
      try {
        await this.accounts.setPassword(userId, password);
      } catch (err) {
        if (!(err instanceof AccountError)) throw err;
        return { kind: 'refused', error: err } as const;
      }
      await tx.update(signupRequests).set({ usedAt: new Date() }).where(eq(signupRequests.id, id));
      return { kind: 'done', email } as const;
    });
    if (outcome.kind === 'refused') refused(outcome.error);
    return { email: outcome.email };
  }
}

/**
 * The provider's own id of an account that signs in with a password ("auth0|abc" from
 * "<issuer>|auth0|abc"); null for any other kind. In dev mode every account counts as one.
 */
export function providerUserId(authSubject: string, mode: Env['AUTH_MODE']): string | null {
  const id = authSubject.slice(authSubject.indexOf('|') + 1);
  return mode === 'dev' || signInMethod(authSubject) === 'password' ? id : null;
}

function refused(error: AccountError): never {
  if (error.reason === 'password') throw new BadRequestException({ statusCode: HttpStatus.BAD_REQUEST, code: 'password', message: error.message });
  throw new ServiceUnavailableException(error.message);
}

/** A link of the right kind that still works: a reset link can't create an account, nor the other way round. */
function usable(row: typeof signupRequests.$inferSelect | undefined, purpose: LinkPurpose) {
  if (!row || row.purpose !== purpose) throw linkProblem(purpose, 'invalid');
  if (row.usedAt) throw linkProblem(purpose, 'used');
  if (row.expiresAt <= new Date()) throw linkProblem(purpose, 'expired', row.email);
  return row;
}
