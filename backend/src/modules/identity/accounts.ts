import { Logger } from '@nestjs/common';
import type { Env } from '../../infrastructure/config/config.module';

/** Why the provider did not create an account. `message` is safe to show the person. */
export class AccountError extends Error {
  constructor(
    readonly reason: 'exists' | 'password' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Where email-and-password accounts live (CD-114). Pultly never stores passwords: once it has
 * confirmed the email address, it asks the identity provider to create the user with the password
 * the person chose. After that they sign in with the provider as usual.
 */
export abstract class AccountDirectory {
  /** False when email-and-password sign-up can't work here (no provider credentials). */
  abstract readonly available: boolean;
  /** Creates a password user whose email address counts as verified. Throws AccountError. */
  abstract createPasswordUser(email: string, password: string): Promise<void>;
  /** Sets a new password for the provider's user `userId` (e.g. "auth0|abc"). Throws AccountError. */
  abstract setPassword(userId: string, password: string): Promise<void>;
}

/** AUTH_MODE=dev: there are no passwords, dev sign-in accepts any email. */
export class DevAccounts extends AccountDirectory {
  readonly available = true;
  async createPasswordUser(): Promise<void> {}
  async setPassword(): Promise<void> {}
}

/** oidc mode without Management API credentials: "Continue with email" is hidden. */
export class NoAccounts extends AccountDirectory {
  readonly available = false;
  createPasswordUser(): Promise<void> {
    return Promise.reject(new AccountError('unavailable', "Creating an account with email isn't available. Continue with Google instead."));
  }
  setPassword(): Promise<void> {
    return Promise.reject(new AccountError('unavailable', "Resetting a password isn't available here yet."));
  }
}

/** The sign-up request's row stays locked while Auth0 answers, so don't wait long. */
const TIMEOUT_MS = 15_000;
const UNAVAILABLE = "That didn't work just now: our sign-in service didn't answer. Try again in a few minutes.";

/**
 * Auth0's Management API, with a machine-to-machine app that may `create:users` and
 * `update:users` (AUTH0_MANAGEMENT_*). The domain is the tenant's own (…auth0.com), not a custom domain.
 */
export class Auth0Accounts extends AccountDirectory {
  readonly available = true;
  private readonly logger = new Logger('Auth0Accounts');
  private token: { value: string; expires: number } | null = null;

  constructor(
    private readonly domain: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly connection: string,
  ) {
    super();
  }

  async createPasswordUser(email: string, password: string): Promise<void> {
    const res = await this.call('POST', '/users', { connection: this.connection, email, password, email_verified: true, verify_email: false });
    if (res.ok) return;
    if (res.status === 409) throw new AccountError('exists', 'This email already has an account. Sign in instead.');
    await this.refused(res, 'create a user');
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const res = await this.call('PATCH', `/users/${encodeURIComponent(userId)}`, { connection: this.connection, password });
    if (res.ok) return;
    await this.refused(res, 'set a password');
  }

  private async call(method: string, path: string, body: unknown): Promise<Response> {
    return fetch(`https://${this.domain}/api/v2${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await this.managementToken()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: unknown) => {
      this.logger.error(`Auth0 unreachable: ${err instanceof Error ? err.message : String(err)}`);
      throw new AccountError('unavailable', UNAVAILABLE);
    });
  }

  private async refused(res: Response, what: string): Promise<never> {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const detail = body?.message ?? '';
    // Auth0 checks the password against the connection's policy: "PasswordStrengthError: Password is too weak".
    if (res.status === 400 && /password/i.test(detail)) throw new AccountError('password', passwordProblem(detail));
    if (res.status === 401) this.token = null;
    this.logger.error(`Auth0 refused to ${what}: ${res.status} ${detail}`);
    throw new AccountError('unavailable', UNAVAILABLE);
  }

  private async managementToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    const res = await fetch(`https://${this.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret, audience: `https://${this.domain}/api/v2/` }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (!res?.ok) {
      this.logger.error(`Auth0 Management API token refused: ${res?.status ?? 'unreachable'}`);
      throw new AccountError('unavailable', UNAVAILABLE);
    }
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    // Renew a minute early, so a token never runs out between here and the request.
    this.token = { value: access_token, expires: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }
}

/** Auth0's password errors, in words a person can act on. */
function passwordProblem(detail: string): string {
  if (/dictionary/i.test(detail)) return 'That password is too common. Choose a less predictable one.';
  if (/user ?info/i.test(detail)) return "The password can't contain your email address.";
  if (/history/i.test(detail)) return 'Choose a password you have not used before.';
  return 'That password is too weak. Use at least 8 characters, mixing letters, numbers and symbols.';
}

export function createAccountDirectory(env: Env): AccountDirectory {
  if (env.AUTH_MODE === 'dev') return new DevAccounts();
  if (!env.AUTH0_MANAGEMENT_DOMAIN || !env.AUTH0_MANAGEMENT_CLIENT_ID || !env.AUTH0_MANAGEMENT_CLIENT_SECRET) return new NoAccounts();
  return new Auth0Accounts(env.AUTH0_MANAGEMENT_DOMAIN, env.AUTH0_MANAGEMENT_CLIENT_ID, env.AUTH0_MANAGEMENT_CLIENT_SECRET, env.AUTH0_DB_CONNECTION);
}
