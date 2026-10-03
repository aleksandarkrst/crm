import { afterEach, describe, expect, it, vi } from 'vitest';
import { Auth0Accounts } from '../src/modules/identity/accounts';
import { readCookie } from '../src/modules/identity/session.controller';
import { Auth0Sessions, createSessionProvider, DevSessions, NoSessions, pkce, type SessionError } from '../src/modules/identity/sessions';
import { noPasswordEmail, passwordResetEmail, resetLink } from '../src/modules/identity/signup-email';
import { providerUserId } from '../src/modules/identity/signup.service';
import type { Env } from '../src/infrastructure/config/config.module';
import type { Request } from 'express';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const auth0 = () => new Auth0Sessions('https://login.example.test/', 'web-app', 'web-secret', 'https://api.example.test', 'Username-Password-Authentication');

describe('signing in with Auth0 behind Pultly\'s own pages (CD-114)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('checks the password with the password-realm grant, passing on the person\'s address', async () => {
    const fetchMock = vi.fn(async () => json(200, { access_token: 'at', refresh_token: 'rt', expires_in: 600 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await auth0().passwordLogin('ana@example.test', 'secret password', '203.0.113.7')).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 600 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://login.example.test/oauth/token');
    expect((init.headers as Record<string, string>)['auth0-forwarded-for']).toBe('203.0.113.7');
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: 'http://auth0.com/oauth/grant-type/password-realm',
      realm: 'Username-Password-Authentication',
      username: 'ana@example.test',
      password: 'secret password',
      audience: 'https://api.example.test',
      scope: 'openid profile email offline_access',
      client_id: 'web-app',
      client_secret: 'web-secret',
    });
  });

  it('explains a refusal without saying whether the account exists', async () => {
    const reply = { status: 403, body: { error: 'invalid_grant', error_description: 'Wrong email or password.' } as unknown };
    vi.stubGlobal('fetch', vi.fn(async () => json(reply.status, reply.body)));
    const reason = () => auth0().passwordLogin('ana@example.test', 'x', '').then(() => null, (err: SessionError) => err.reason);

    expect(await reason()).toBe('credentials');
    Object.assign(reply, { status: 429, body: { error: 'too_many_attempts', error_description: 'Your account has been blocked after multiple consecutive login attempts.' } });
    expect(await reason()).toBe('too-many');
    Object.assign(reply, { status: 401, body: { error: 'unauthorized', error_description: 'user is blocked' } });
    expect(await reason()).toBe('blocked');
    Object.assign(reply, { status: 403, body: { error: 'password_leaked', error_description: 'This login attempt has been blocked because the password you are using was previously disclosed through a data breach (not in this application).' } });
    expect(await reason()).toBe('reset');
    Object.assign(reply, { status: 500, body: { error: 'server_error' } });
    expect(await reason()).toBe('unavailable');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))));
    expect(await reason()).toBe('unavailable');
  });

  it('ends a session whose refresh token is no longer valid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, { error: 'invalid_grant' })));
    await expect(auth0().refresh('old')).rejects.toMatchObject({ reason: 'expired' });
  });

  it('sends Google sign-in straight to Google, with PKCE', () => {
    const { verifier, challenge } = pkce();
    expect(verifier).not.toBe(challenge);
    const url = new URL(auth0().authorizeUrl({ connection: 'google-oauth2', redirectUri: 'https://app.example.test/api/auth/callback', state: 's', challenge }));
    expect(url.origin + url.pathname).toBe('https://login.example.test/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: 'code',
      connection: 'google-oauth2',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
      audience: 'https://api.example.test',
    });
  });

  it('is picked by the environment', () => {
    const env = (over: Partial<Env>) => ({ AUTH_MODE: 'oidc', AUTH0_DB_CONNECTION: 'Username-Password-Authentication', ...over }) as Env;
    const issue = async () => 'dev';
    expect(createSessionProvider(env({ AUTH_MODE: 'dev', DEV_JWT_SECRET: 'x'.repeat(32) }), issue)).toBeInstanceOf(DevSessions);
    expect(createSessionProvider(env({ OIDC_ISSUER: 'https://i', OIDC_AUDIENCE: 'a' }), issue)).toBeInstanceOf(NoSessions);
    expect(
      createSessionProvider(env({ OIDC_ISSUER: 'https://i', OIDC_AUDIENCE: 'a', AUTH0_LOGIN_CLIENT_ID: 'c', AUTH0_LOGIN_CLIENT_SECRET: 's' }), issue),
    ).toBeInstanceOf(Auth0Sessions);
  });

  it('reads the session cookie among others', () => {
    const req = (cookie?: string) => ({ headers: { cookie } }) as Request;
    expect(readCookie(req('a=1; crm_session=abc%3D; b=2'), 'crm_session')).toBe('abc=');
    expect(readCookie(req('crm_sessionx=1'), 'crm_session')).toBeNull();
    expect(readCookie(req(), 'crm_session')).toBeNull();
  });
});

describe('forgot password (CD-114)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sets the new password through the Management API', async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).endsWith('/oauth/token') ? json(200, { access_token: 'mgmt', expires_in: 86_400 }) : json(200, {})));
    vi.stubGlobal('fetch', fetchMock);
    await new Auth0Accounts('tenant.eu.auth0.com', 'client', 'secret', 'Username-Password-Authentication').setPassword('auth0|abc', 'a brand new password');
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://tenant.eu.auth0.com/api/v2/users/auth0%7Cabc');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ connection: 'Username-Password-Authentication', password: 'a brand new password' });
  });

  it('only resets accounts that sign in with a password', () => {
    expect(providerUserId('https://t.eu.auth0.com/|auth0|abc', 'oidc')).toBe('auth0|abc');
    expect(providerUserId('https://t.eu.auth0.com/|google-oauth2|123', 'oidc')).toBeNull();
    expect(providerUserId('crm-dev|ana@example.test', 'dev')).toBe('ana@example.test');
  });

  it('emails a link that works for an hour, or how to sign in with Google', () => {
    const link = resetLink('https://app.example.test/', 'tok');
    expect(link).toBe('https://app.example.test/reset-password#tok');
    const mail = passwordResetEmail({ to: 'ana@example.test', link, hours: 1 });
    expect(mail.text).toContain(link);
    expect(mail.text).toContain('for one hour');
    const google = noPasswordEmail({ to: 'ana@example.test', link: 'https://app.example.test/login' });
    expect(google.text).toContain('Continue with Google');
    expect(google.text).not.toContain('reset-password');
  });
});
