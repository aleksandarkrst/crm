import type { AddressInfo } from 'node:net';
import { HttpException } from '@nestjs/common';
import express from 'express';
import { SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/infrastructure/config/config.module';
import { Auth0Accounts } from '../src/modules/identity/accounts';
import type { IdentityService } from '../src/modules/identity/identity.service';
import { readCookie, SessionController, SessionCookies, sessionProblem } from '../src/modules/identity/session.controller';
import { Auth0Sessions, createSessionProvider, DevSessions, NoSessions, pkce, type SessionError } from '../src/modules/identity/sessions';
import { noPasswordEmail, passwordResetEmail, resetLink } from '../src/modules/identity/signup-email';
import { providerUserId } from '../src/modules/identity/signup.service';
import { claim } from '../src/modules/identity/token.service';
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

  it('keeps what Auth0 answered as the cause of an "unavailable", for error tracking (CD-205)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(500, { error: 'server_error', error_description: 'Rate limit exceeded' })));
    const err = (await auth0().passwordLogin('ana@example.test', 'x', '').catch((e: unknown) => e)) as SessionError;
    expect(err.reason).toBe('unavailable');
    expect(String((err.cause as Error).message)).toBe('Auth0 refused a password sign-in: 500 server_error Rate limit exceeded');

    const http = sessionProblem(err);
    expect(http.getStatus()).toBe(503);
    expect(http.cause).toBe(err.cause);
    // The person still only sees the general message.
    expect(http.getResponse()).toEqual({ statusCode: 503, code: 'unavailable', message: err.message });
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

  it("takes the person's email and name from the ID token, which Auth0's access tokens lack (CD-222)", async () => {
    const idToken = (claims: Record<string, unknown>) =>
      new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuer('https://login.example.test/').setSubject('google-oauth2|123').sign(new TextEncoder().encode('k'.repeat(32)));
    const reply = { body: {} as Record<string, unknown> };
    vi.stubGlobal('fetch', vi.fn(async () => json(200, reply.body)));

    reply.body = { access_token: 'at', refresh_token: 'rt', expires_in: 600, id_token: await idToken({ email: 'gina@example.test', email_verified: true, name: 'Gina Google' }) };
    expect((await auth0().exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'https://app.example.test/api/auth/callback' })).identity).toEqual({
      subject: 'https://login.example.test/|google-oauth2|123',
      email: 'gina@example.test',
      name: 'Gina Google',
    });
    // A renewal brings it too, so people who signed in before get their address on the next one.
    expect((await auth0().refresh('rt')).identity?.email).toBe('gina@example.test');
    // An address the provider hasn't verified is left out; a reply without an ID token has no identity.
    reply.body = { access_token: 'at', id_token: await idToken({ email: 'gina@example.test', email_verified: false }) };
    expect((await auth0().refresh('rt')).identity).toEqual({ subject: 'https://login.example.test/|google-oauth2|123', email: null, name: null });
    reply.body = { access_token: 'at', id_token: 'not a jwt' };
    expect((await auth0().refresh('rt')).identity).toBeUndefined();
  });

  it('dev sessions name who signed in like the dev token does', async () => {
    const dev = new DevSessions('x'.repeat(32), async () => 'at');
    expect((await dev.passwordLogin('Ana@Example.test')).identity).toEqual({ subject: 'crm-dev|ana@example.test', email: 'Ana@Example.test', name: 'Ana' });
  });

  it('reads plain and namespaced claims of an access token', () => {
    expect(claim({ email: ' ana@example.test ' }, 'email')).toBe('ana@example.test');
    expect(claim({ 'https://pultly.com/email': 'ana@example.test' }, 'email')).toBe('ana@example.test');
    expect(claim({ 'https://pultly.com/email_verified': 'yes', other_email: 'x@example.test' }, 'email')).toBeNull();
    expect(claim({ email: '' }, 'email')).toBeNull();
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

/**
 * Auth0 rotation: a used refresh token is dead, and the answer includes the next one only when the
 * grant asks for the API audience and offline_access. Presenting the used token again inside the
 * replay window must not call Auth0 (that revokes the chain).
 */
function rotatingAuth0() {
  const live = new Set(['seed']);
  let n = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/oauth/revoke')) return json(200, {});
    const body = JSON.parse(String(init?.body)) as Record<string, string>;
    const used = body.refresh_token ?? '';
    if (!live.has(used)) return json(403, { error: 'invalid_grant' });
    live.delete(used);
    n += 1;
    const asked = (body.scope ?? '').includes('offline_access') && body.audience === 'https://api.example.test';
    const refresh = `${used}-n`;
    if (asked) live.add(refresh);
    return json(200, { access_token: `access-${n}`, expires_in: 3600, ...(asked ? { refresh_token: refresh } : {}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { sessions: auth0(), fetchMock };
}

describe('refresh token rotation (CD-445)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('asks for the rotated refresh token, which the next refresh accepts', async () => {
    const { sessions, fetchMock } = rotatingAuth0();
    const first = await sessions.refresh('seed');
    expect(first).toEqual({ accessToken: 'access-1', expiresIn: 3600, refreshToken: 'seed-n' });
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'seed',
      audience: 'https://api.example.test',
      scope: 'openid profile email offline_access',
      client_id: 'web-app',
      client_secret: 'web-secret',
    });
    expect(await sessions.refresh('seed-n')).toMatchObject({ accessToken: 'access-2', refreshToken: 'seed-n-n' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers a repeat of the token just used without asking Auth0 again', async () => {
    const { sessions, fetchMock } = rotatingAuth0();
    const first = await sessions.refresh('seed');
    expect(await sessions.refresh('seed')).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one Auth0 call when the same token is refreshed twice at once', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return json(200, { access_token: 'access-1', refresh_token: 'seed-n', expires_in: 3600 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const sessions = auth0();
    const first = sessions.refresh('seed');
    const second = sessions.refresh('seed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toEqual(await second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops replaying once the window has passed, and Auth0 then rejects the used token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T06:00:00Z'));
    const { sessions, fetchMock } = rotatingAuth0();
    await sessions.refresh('seed');
    vi.setSystemTime(new Date('2026-10-21T06:00:31Z'));
    await expect(sessions.refresh('seed')).rejects.toMatchObject({ reason: 'expired' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not replay a refresh Auth0 answered without a new token', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return json(200, { access_token: 'access-1', expires_in: 3600 });
        return json(403, { error: 'invalid_grant' });
      }),
    );
    const sessions = auth0();
    expect((await sessions.refresh('seed')).refreshToken).toBeUndefined();
    await expect(sessions.refresh('seed')).rejects.toMatchObject({ reason: 'expired' });
    expect(calls).toBe(2);
  });

  it('forgets the replay when the session is revoked', async () => {
    const { sessions, fetchMock } = rotatingAuth0();
    const first = await sessions.refresh('seed');
    expect(first.refreshToken).toBe('seed-n');
    await sessions.revoke(first.refreshToken ?? '');
    await expect(sessions.refresh('seed')).rejects.toMatchObject({ reason: 'expired' });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/oauth/revoke'))).toBe(true);
  });

  it('logout ends every earlier token in the rotation, not only the latest', async () => {
    const { sessions, fetchMock } = rotatingAuth0();
    const first = await sessions.refresh('seed');
    const second = await sessions.refresh(first.refreshToken ?? '');
    const calls = fetchMock.mock.calls.length;
    await sessions.revoke(second.refreshToken ?? '');
    await expect(sessions.refresh('seed')).rejects.toMatchObject({ reason: 'expired' });
    await expect(sessions.refresh(first.refreshToken ?? '')).rejects.toMatchObject({ reason: 'expired' });
    await expect(sessions.refresh(second.refreshToken ?? '')).rejects.toMatchObject({ reason: 'expired' });
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
  });

  it('revokes a refresh token that Auth0 issues after logout has started', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revoked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        if (String(url).endsWith('/oauth/revoke')) {
          revoked.push(body.token ?? '');
          return json(200, {});
        }
        await gate;
        return json(200, { access_token: 'access-1', refresh_token: 'seed-n', expires_in: 3600 });
      }),
    );
    const sessions = auth0();
    const pending = sessions.refresh('seed');
    await sessions.revoke('seed');
    release();
    expect((await pending).refreshToken).toBe('seed-n');
    await expect(sessions.refresh('seed')).rejects.toMatchObject({ reason: 'expired' });
    await expect(sessions.refresh('seed-n')).rejects.toMatchObject({ reason: 'expired' });
    expect(revoked).toEqual(['seed', 'seed-n']);
  });
});

describe('POST /api/auth/refresh keeps the rotated cookie (CD-445)', () => {
  let server: ReturnType<express.Express['listen']>;
  let base: string;
  const live = new Set(['seed']);
  let n = 0;

  beforeAll(async () => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (!String(url).endsWith('/oauth/token')) return realFetch(url, init);
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        const used = body.refresh_token ?? '';
        if (!live.has(used)) return json(403, { error: 'invalid_grant' });
        live.delete(used);
        n += 1;
        const refresh = `rt-${n}`;
        live.add(refresh);
        return json(200, { access_token: `access-${n}`, refresh_token: refresh, expires_in: 3600 });
      }),
    );
    const env = { NODE_ENV: 'test', APP_URL: 'https://staging.pultly.com', AUTH_MODE: 'oidc' } as Env;
    const sessions = auth0();
    const cookies = new SessionCookies(sessions, { rememberProfile: async () => undefined } as unknown as IdentityService, env);
    const controller = new SessionController(sessions, cookies, env);
    const app = express();
    app.use(express.json());
    app.post('/api/auth/refresh', (req, res, next) => {
      controller.refresh(req, res).then(
        (body) => res.json(body),
        (err: unknown) => (err instanceof HttpException ? res.status(err.getStatus()).json(err.getResponse()) : next(err)),
      );
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    vi.unstubAllGlobals();
  });

  const post = (cookie?: string) =>
    fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: '{}',
    });

  it('sets a cookie the next refresh accepts, and accepts the previous cookie again inside the window', async () => {
    const first = await post('crm_session=seed');
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ accessToken: 'access-1', expiresIn: 3600 });
    expect(first.headers.get('cache-control')).toBe('no-store');
    const set = first.headers.getSetCookie();
    const line = set.find((value) => value.startsWith('crm_session=')) ?? '';
    expect(line).toMatch(/^crm_session=rt-1;/);
    expect(line).toContain('Path=/api/auth');
    expect(line).toContain('HttpOnly');
    expect(line).toContain('SameSite=Strict');
    expect(line).toContain('Secure');
    expect(line).toContain('Max-Age=2592000');

    const second = await post('crm_session=rt-1');
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ accessToken: 'access-2', expiresIn: 3600 });
    expect(second.headers.getSetCookie().some((value) => value.startsWith('crm_session=rt-2;'))).toBe(true);

    const replay = await post('crm_session=seed');
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ accessToken: 'access-1', expiresIn: 3600 });
    expect(replay.headers.getSetCookie().some((value) => value.startsWith('crm_session=rt-1;'))).toBe(true);

    const rejected = await post('crm_session=never');
    expect(rejected.status).toBe(401);
    const cleared = rejected.headers.getSetCookie().find((value) => value.startsWith('crm_session=')) ?? '';
    expect(cleared).toContain('Path=/api/auth');
    expect(cleared).toMatch(/Max-Age=0|Expires=/);

    const missing = await post();
    expect(missing.status).toBe(401);
    expect(missing.headers.getSetCookie()).toEqual([]);
  });
});
