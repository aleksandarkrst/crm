import { Logger } from '@nestjs/common';
import type { Env } from '../../infrastructure/config/config.module';
import { allRules, type ConnectionOptions, DEFAULT_PASSWORD_POLICY, type PasswordPolicy, passwordProblem, policyFromConnection } from './password-policy';

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
  /** The rules the provider checks a new password against. Never throws. */
  abstract passwordPolicy(): Promise<PasswordPolicy>;
}

/** AUTH_MODE=dev: there are no passwords, dev sign-in accepts any email. */
export class DevAccounts extends AccountDirectory {
  readonly available = true;
  async createPasswordUser(): Promise<void> {}
  async setPassword(): Promise<void> {}
  async passwordPolicy(): Promise<PasswordPolicy> {
    return DEFAULT_PASSWORD_POLICY;
  }
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
  async passwordPolicy(): Promise<PasswordPolicy> {
    return DEFAULT_PASSWORD_POLICY;
  }
}

/** The sign-up request's row stays locked while Auth0 answers, so don't wait long. */
const TIMEOUT_MS = 15_000;
const UNAVAILABLE = "That didn't work just now: our sign-in service didn't answer. Try again in a few minutes.";
/** How long the connection's password rules are kept, and how soon to try again when reading them failed. */
const POLICY_TTL_MS = 10 * 60_000;
const POLICY_RETRY_MS = 60_000;

/**
 * Auth0's Management API, with a machine-to-machine app that may `create:users`,
 * `update:users` and `read:connections` (AUTH0_MANAGEMENT_*). The domain is the tenant's own (…auth0.com), not a custom domain.
 */
export class Auth0Accounts extends AccountDirectory {
  readonly available = true;
  private readonly logger = new Logger('Auth0Accounts');
  private token: { value: string; expires: number } | null = null;
  private policy: { value: PasswordPolicy; expires: number } | null = null;

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
    await this.refused(res, 'create a user', password);
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const res = await this.call('PATCH', `/users/${encodeURIComponent(userId)}`, { connection: this.connection, password });
    if (res.ok) return;
    await this.refused(res, 'set a password', password);
  }

  /**
   * The rules of AUTH0_DB_CONNECTION, read with `read:connections` and kept for a while. Without
   * that scope (or while Auth0 is away) the default length rule, and Auth0 still has the last word.
   */
  async passwordPolicy(): Promise<PasswordPolicy> {
    if (this.policy && this.policy.expires > Date.now()) return this.policy.value;
    let value = DEFAULT_PASSWORD_POLICY;
    let ttl = POLICY_RETRY_MS;
    try {
      const res = await this.call('GET', `/connections?strategy=auth0&name=${encodeURIComponent(this.connection)}&fields=options&include_fields=true`);
      const [connection] = res.ok ? ((await res.json()) as { options?: ConnectionOptions }[]) : [];
      if (connection) {
        value = policyFromConnection(connection.options ?? {});
        ttl = POLICY_TTL_MS;
      } else {
        if (res.status === 401) this.token = null;
        this.logger.warn(`Couldn't read the password rules of ${this.connection} (${res.ok ? 'no such connection' : res.status}); does the Management API app have read:connections?`);
      }
    } catch (err) {
      // Auth0 unreachable is logged already; anything else (a reply that isn't JSON) is new.
      if (!(err instanceof AccountError)) this.logger.warn(`Couldn't read the password rules of ${this.connection}: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.policy = { value, expires: Date.now() + ttl };
    return value;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`https://${this.domain}/api/v2${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await this.managementToken()}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: unknown) => {
      this.logger.error(`Auth0 unreachable: ${err instanceof Error ? err.message : String(err)}`);
      throw new AccountError('unavailable', UNAVAILABLE);
    });
  }

  private async refused(res: Response, what: string, password: string): Promise<never> {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    const detail = body?.message ?? '';
    // Auth0 checks the password against the connection's policy: "PasswordStrengthError: Password is too weak".
    if (res.status === 400 && /password/i.test(detail)) {
      this.logger.warn(`Auth0 refused the password: ${detail}`);
      throw new AccountError('password', await this.passwordRefusal(detail, password));
    }
    if (res.status === 401) this.token = null;
    this.logger.error(`Auth0 refused to ${what}: ${res.status} ${detail}`);
    throw new AccountError('unavailable', UNAVAILABLE);
  }

  /** "Too weak" names no rule: say which ones the password misses, or else list them all. */
  private async passwordRefusal(detail: string, password: string): Promise<string> {
    const known = knownRefusal(detail);
    if (known) return known;
    const policy = await this.passwordPolicy();
    return passwordProblem(password, policy) ?? `That password is too weak. The rules: ${allRules(policy)}.`;
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
function knownRefusal(detail: string): string | null {
  if (/dictionary|common/i.test(detail)) return 'That password is too common. Choose a less predictable one.';
  if (/user ?info|personal|profile/i.test(detail)) return "The password can't contain your name or email address.";
  if (/history/i.test(detail)) return 'Choose a password you have not used before.';
  return null;
}

export function createAccountDirectory(env: Env): AccountDirectory {
  if (env.AUTH_MODE === 'dev') return new DevAccounts();
  if (!env.AUTH0_MANAGEMENT_DOMAIN || !env.AUTH0_MANAGEMENT_CLIENT_ID || !env.AUTH0_MANAGEMENT_CLIENT_SECRET) return new NoAccounts();
  return new Auth0Accounts(env.AUTH0_MANAGEMENT_DOMAIN, env.AUTH0_MANAGEMENT_CLIENT_ID, env.AUTH0_MANAGEMENT_CLIENT_SECRET, env.AUTH0_DB_CONNECTION);
}
