import { Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../../infrastructure/config/config.module';

/** A signed-in session: the access token for the API, and what renews it (kept in a cookie). */
export interface SessionTokens {
  accessToken: string;
  expiresIn: number; // seconds
  refreshToken?: string; // absent when the provider keeps the old one
}

/** Why signing in didn't work. `message` is safe to show, and never says whether an account exists. */
export class SessionError extends Error {
  constructor(
    readonly reason: 'credentials' | 'blocked' | 'too-many' | 'reset' | 'expired' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

const WRONG = "That email and password don't match. Check them and try again, or reset your password.";
const UNAVAILABLE = "We couldn't sign you in just now. Try again in a few minutes.";

/**
 * Signing in on Pultly's own pages (CD-114): the backend checks the password with the identity
 * provider and holds the refresh token in an httpOnly cookie; the browser only ever sees access
 * tokens. "Continue with Google" runs the authorization-code flow through the backend too, so no
 * page of the provider is shown, only Google's own.
 */
export abstract class SessionProvider {
  /** False when this server can't sign anyone in (oidc mode without the login app's credentials). */
  abstract readonly available: boolean;
  /** Checks an email and password. `ip` is the person's, for the provider's brute-force protection. */
  abstract passwordLogin(email: string, password: string, ip: string): Promise<SessionTokens>;
  /** A new access token for a refresh token. Throws SessionError('expired') when it is no longer valid. */
  abstract refresh(refreshToken: string): Promise<SessionTokens>;
  /** Ends the session at the provider. Never throws: signing out always works locally. */
  abstract revoke(refreshToken: string): Promise<void>;
  /** Where to send the browser to sign in with `connection` (Google). */
  abstract authorizeUrl(input: { connection: string; redirectUri: string; state: string; challenge: string }): string;
  /** Finishes a sign-in that came back to `redirectUri` with `code`. */
  abstract exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<SessionTokens>;
}

/** PKCE (RFC 7636): the verifier stays in a cookie, the provider only sees its hash. */
export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

const TIMEOUT_MS = 15_000;
const SCOPE = 'openid profile email offline_access';

interface TokenReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Auth0, with a Regular Web Application (AUTH0_LOGIN_CLIENT_*) that may use the Password,
 * Authorization Code and Refresh Token grants. Its tokens are the same the API already accepts:
 * issued by OIDC_ISSUER for OIDC_AUDIENCE.
 */
export class Auth0Sessions extends SessionProvider {
  readonly available = true;
  private readonly logger = new Logger('Auth0Sessions');
  private readonly base: string;

  constructor(
    issuer: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly audience: string,
    private readonly realm: string,
  ) {
    super();
    this.base = issuer.replace(/\/+$/, '');
  }

  async passwordLogin(email: string, password: string, ip: string): Promise<SessionTokens> {
    // auth0-forwarded-for: the person's address, so Auth0's brute-force protection blocks them and
    // not this server (needs "Trust Token Endpoint IP Header" on the app).
    const reply = await this.token(
      { grant_type: 'http://auth0.com/oauth/grant-type/password-realm', realm: this.realm, username: email, password, audience: this.audience, scope: SCOPE },
      { 'auth0-forwarded-for': ip },
    );
    if (reply.ok) return reply.tokens;
    const { status, body } = reply;
    const detail = `${body.error ?? ''} ${body.error_description ?? ''}`;
    if (status === 429 || body.error === 'too_many_attempts')
      throw new SessionError('too-many', 'Too many attempts. Sign-in is paused for this account: check your email for how to unblock it, or reset your password.');
    // Before "blocked": Auth0 says a leaked password's sign-in was blocked too.
    if (/leaked|breach|password.*expired|expired.*password|reset/i.test(detail))
      throw new SessionError('reset', 'For your security, choose a new password: use "Forgot password?" to get a link by email.');
    if (/blocked/i.test(detail)) throw new SessionError('blocked', 'This account is blocked. Contact us to have it unblocked.');
    if (body.error === 'invalid_grant' || body.error === 'invalid_user_password') throw new SessionError('credentials', WRONG);
    this.logger.error(`Auth0 refused a password sign-in: ${status} ${detail.trim()}`);
    throw new SessionError('unavailable', UNAVAILABLE);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const reply = await this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
    if (reply.ok) return reply.tokens;
    if (reply.body.error === 'invalid_grant') throw new SessionError('expired', 'Your session ended. Sign in again.');
    this.logger.error(`Auth0 refused a refresh: ${reply.status} ${reply.body.error ?? ''}`);
    throw new SessionError('unavailable', UNAVAILABLE);
  }

  async revoke(refreshToken: string): Promise<void> {
    await fetch(`${this.base}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, token: refreshToken }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then((res) => void (res.ok || this.logger.warn(`Auth0 refused to revoke a refresh token: ${res.status}`)))
      .catch((err: unknown) => this.logger.warn(`Auth0 unreachable while revoking: ${err instanceof Error ? err.message : String(err)}`));
  }

  authorizeUrl({ connection, redirectUri, state, challenge }: { connection: string; redirectUri: string; state: string; challenge: string }): string {
    const url = new URL(`${this.base}/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: SCOPE,
      audience: this.audience,
      connection,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // Straight to Google's account picker, even with an Auth0 session from before.
      prompt: 'login',
    }).toString();
    return url.toString();
  }

  async exchangeCode({ code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<SessionTokens> {
    const reply = await this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
    if (reply.ok) return reply.tokens;
    this.logger.error(`Auth0 refused a code exchange: ${reply.status} ${reply.body.error ?? ''} ${reply.body.error_description ?? ''}`);
    throw new SessionError('unavailable', UNAVAILABLE);
  }

  private async token(params: Record<string, string>, headers: Record<string, string> = {}) {
    const res = await fetch(`${this.base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ ...params, client_id: this.clientId, client_secret: this.clientSecret }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: unknown) => {
      this.logger.error(`Auth0 unreachable: ${err instanceof Error ? err.message : String(err)}`);
      throw new SessionError('unavailable', UNAVAILABLE);
    });
    const body = ((await res.json().catch(() => null)) ?? {}) as TokenReply;
    if (res.ok && body.access_token)
      return { ok: true, tokens: { accessToken: body.access_token, expiresIn: body.expires_in ?? 3600, refreshToken: body.refresh_token } } as const;
    return { ok: false, status: res.status, body } as const;
  }
}

/**
 * AUTH_MODE=dev: any email signs in, with any password (like /auth/dev-login). The "refresh token"
 * is a signed dev token too, so the cookie flow works the same as with Auth0.
 */
export class DevSessions extends SessionProvider {
  readonly available = true;
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly issueAccessToken: (email: string, name: string) => Promise<string>,
  ) {
    super();
    this.key = new TextEncoder().encode(secret);
  }

  async passwordLogin(email: string): Promise<SessionTokens> {
    return this.session(email, email.split('@')[0]!);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const { payload } = await jwtVerify(refreshToken, this.key, { issuer: 'crm-dev', audience: 'crm-dev-refresh' }).catch(() => {
      throw new SessionError('expired', 'Your session ended. Sign in again.');
    });
    return this.session(String(payload.sub), String(payload.name));
  }

  async revoke(): Promise<void> {}

  authorizeUrl(): string {
    throw new SessionError('unavailable', "Google sign-in isn't available in dev mode.");
  }

  exchangeCode(): Promise<SessionTokens> {
    return Promise.reject(new SessionError('unavailable', "Google sign-in isn't available in dev mode."));
  }

  private async session(email: string, name: string): Promise<SessionTokens> {
    const refreshToken = await new SignJWT({ name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(email)
      .setIssuer('crm-dev')
      .setAudience('crm-dev-refresh')
      .setIssuedAt()
      .setExpirationTime('30d')
      .sign(this.key);
    return { accessToken: await this.issueAccessToken(email, name), expiresIn: 12 * 3600, refreshToken };
  }
}

/** oidc mode without the login app's credentials: nobody can sign in. The config check prevents it in production. */
export class NoSessions extends SessionProvider {
  readonly available = false;
  private fail(): never {
    throw new SessionError('unavailable', "Signing in isn't set up on this server yet.");
  }
  passwordLogin = async (): Promise<SessionTokens> => this.fail();
  refresh = async (): Promise<SessionTokens> => this.fail();
  revoke = async (): Promise<void> => {};
  authorizeUrl = (): string => this.fail();
  exchangeCode = async (): Promise<SessionTokens> => this.fail();
}

export function createSessionProvider(env: Env, issueDevToken: (email: string, name: string) => Promise<string>): SessionProvider {
  if (env.AUTH_MODE === 'dev') return env.DEV_JWT_SECRET ? new DevSessions(env.DEV_JWT_SECRET, issueDevToken) : new NoSessions();
  if (!env.OIDC_ISSUER || !env.OIDC_AUDIENCE || !env.AUTH0_LOGIN_CLIENT_ID || !env.AUTH0_LOGIN_CLIENT_SECRET) {
    // Not a startup failure, so a deploy before the variables are set keeps the API up; sign-in answers 503.
    new Logger('Sessions').error('AUTH_MODE=oidc but OIDC_ISSUER, OIDC_AUDIENCE or AUTH0_LOGIN_CLIENT_ID/_SECRET is missing: nobody can sign in.');
    return new NoSessions();
  }
  return new Auth0Sessions(env.OIDC_ISSUER, env.AUTH0_LOGIN_CLIENT_ID, env.AUTH0_LOGIN_CLIENT_SECRET, env.OIDC_AUDIENCE, env.AUTH0_DB_CONNECTION);
}
