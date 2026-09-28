import { BadRequestException, ConflictException, GoneException, HttpStatus, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { and, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import type { SecretBox } from '../../infrastructure/crypto/secret-box';
import { DatabaseService, type Tx } from '../../shared/database/database.service';
import { signupRequests, users } from '../../shared/database/schema';
import { JobsService } from '../../shared/events/jobs.service';
import { AccountDirectory, AccountError } from './accounts';
import { signupLinkBox } from './signup-email';

export const SIGNUP_TTL_HOURS = 24;
/** A new email for the same address at most this often; asking sooner keeps the last one. */
const RESEND_AFTER_MS = 60_000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Why a confirmation link doesn't work. The page explains it and offers a new email. */
export type LinkProblem = 'invalid' | 'expired' | 'used';
const LINK_PROBLEMS: Record<LinkProblem, string> = {
  invalid: "This link doesn't work. It may be incomplete, or a newer email replaced it. Use the newest email, or ask for a new one.",
  expired: `This link has expired: it works for ${SIGNUP_TTL_HOURS} hours. Ask for a new email.`,
  used: 'This link was already used, so the account exists. Sign in with your email and password.',
};
const linkProblem = (code: LinkProblem, email?: string) =>
  new GoneException({ statusCode: HttpStatus.GONE, code, message: LINK_PROBLEMS[code], ...(code === 'expired' && email ? { email } : {}) });

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

  async start(email: string): Promise<void> {
    if (!this.options().email || !this.box) throw new ServiceUnavailableException("Creating an account with email isn't available here.");
    const box = this.box;
    await this.database.db.transaction(async (tx) => {
      // One request at a time per address, so two quick clicks don't send two emails.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`signup:${email}`}))`);
      const [recent] = await tx
        .select({ id: signupRequests.id })
        .from(signupRequests)
        .where(and(eq(signupRequests.email, email), isNull(signupRequests.usedAt), gt(signupRequests.createdAt, new Date(Date.now() - RESEND_AFTER_MS))))
        .limit(1);
      if (recent) return;
      // A new email replaces the older links, and requests long gone are cleaned up on the way.
      await tx
        .delete(signupRequests)
        .where(or(and(eq(signupRequests.email, email), isNull(signupRequests.usedAt)), lt(signupRequests.expiresAt, sql`now() - interval '7 days'`)));
      const token = randomBytes(32).toString('base64url');
      const [row] = await tx
        .insert(signupRequests)
        .values({ email, tokenHash: hashToken(token), tokenSealed: box.seal(token), expiresAt: new Date(Date.now() + SIGNUP_TTL_HOURS * 3_600_000) })
        .returning({ id: signupRequests.id });
      await this.jobs.send('identity.signup-email', { requestId: row!.id }, tx);
    });
  }

  /** The address a working link confirms, for the "choose a password" page. Doesn't use the link up. */
  async check(token: string): Promise<{ email: string }> {
    const [row] = await this.database.db.select().from(signupRequests).where(eq(signupRequests.tokenHash, hashToken(token)));
    return { email: usable(row).email };
  }

  /**
   * Uses the link up and creates the account with the chosen password. The row stays locked while
   * the provider answers, so the same link can't create two accounts.
   */
  async complete(token: string, password: string): Promise<{ email: string }> {
    const outcome = await this.database.db.transaction(async (tx) => {
      const [row] = await tx.select().from(signupRequests).where(eq(signupRequests.tokenHash, hashToken(token))).for('update');
      const { id, email } = usable(row);
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
    if (outcome.kind === 'refused') {
      if (outcome.error.reason === 'password') throw new BadRequestException({ statusCode: HttpStatus.BAD_REQUEST, code: 'password', message: outcome.error.message });
      throw new ServiceUnavailableException(outcome.error.message);
    }
    if (outcome.kind === 'exists') throw new ConflictException({ statusCode: HttpStatus.CONFLICT, code: 'exists', message: 'This email already has an account. Sign in instead.', email: outcome.email });
    return { email: outcome.email };
  }
}

function usable(row: typeof signupRequests.$inferSelect | undefined) {
  if (!row) throw linkProblem('invalid');
  if (row.usedAt) throw linkProblem('used');
  if (row.expiresAt <= new Date()) throw linkProblem('expired', row.email);
  return row;
}
