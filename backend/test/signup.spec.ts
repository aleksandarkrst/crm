import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountError, Auth0Accounts, createAccountDirectory, DevAccounts, NoAccounts } from '../src/modules/identity/accounts';
import { existingAccountEmail, signInMethod, signupEmail, signupLink } from '../src/modules/identity/signup-email';
import type { Env } from '../src/infrastructure/config/config.module';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Auth0 accounts (CD-114)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const auth0 = () => new Auth0Accounts('tenant.eu.auth0.com', 'client', 'secret', 'Username-Password-Authentication');

  it('creates a verified password user with a Management API token, reusing the token', async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).endsWith('/oauth/token') ? json(200, { access_token: 'mgmt', expires_in: 86_400 }) : json(201, { user_id: 'auth0|1' })));
    vi.stubGlobal('fetch', fetchMock);
    const accounts = auth0();
    await accounts.createPasswordUser('ana@example.test', 'a long enough password');
    await accounts.createPasswordUser('bo@example.test', 'a long enough password');

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/oauth/token'))).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe('https://tenant.eu.auth0.com/api/v2/users');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mgmt');
    expect(JSON.parse(init.body as string)).toEqual({
      connection: 'Username-Password-Authentication',
      email: 'ana@example.test',
      password: 'a long enough password',
      email_verified: true,
      verify_email: false,
    });
  });

  it('tells an existing user, a weak password and an outage apart', async () => {
    const reply = { status: 409, body: { message: 'The user already exists.' } as unknown };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (String(url).endsWith('/oauth/token') ? json(200, { access_token: 'mgmt', expires_in: 86_400 }) : json(reply.status, reply.body))),
    );
    const accounts = auth0();
    const reason = () => accounts.createPasswordUser('ana@example.test', 'password1').then(() => null, (err: AccountError) => [err.reason, err.message]);

    expect(await reason()).toEqual(['exists', expect.stringContaining('Sign in')]);
    Object.assign(reply, { status: 400, body: { message: 'PasswordStrengthError: Password is too weak' } });
    expect(await reason()).toEqual(['password', expect.stringContaining('too weak')]);
    Object.assign(reply, { status: 400, body: { message: 'PasswordDictionaryError: Password is too common' } });
    expect(await reason()).toEqual(['password', expect.stringContaining('too common')]);
    Object.assign(reply, { status: 500, body: { message: 'boom' } });
    expect(await reason()).toEqual(['unavailable', expect.stringContaining('Try again')]);
  });

  it('is picked by the environment', () => {
    const env = (over: Partial<Env>) => ({ AUTH_MODE: 'oidc', AUTH0_DB_CONNECTION: 'Username-Password-Authentication', ...over }) as Env;
    expect(createAccountDirectory(env({ AUTH_MODE: 'dev' }))).toBeInstanceOf(DevAccounts);
    expect(createAccountDirectory(env({}))).toBeInstanceOf(NoAccounts);
    expect(createAccountDirectory(env({}))).toMatchObject({ available: false });
    expect(createAccountDirectory(env({ AUTH0_MANAGEMENT_DOMAIN: 'd', AUTH0_MANAGEMENT_CLIENT_ID: 'i', AUTH0_MANAGEMENT_CLIENT_SECRET: 's' }))).toBeInstanceOf(Auth0Accounts);
  });
});

describe('sign-up emails (CD-114)', () => {
  it('puts the token after # so it stays out of server logs', () => {
    expect(signupLink('https://app.example.test/', 'tok')).toBe('https://app.example.test/signup/verify#tok');
  });

  it('confirmation: the link and how long it works', () => {
    const mail = signupEmail({ to: 'ana@example.test', link: 'https://app.example.test/signup/verify#tok', hours: 24 });
    expect(mail.text).toContain('https://app.example.test/signup/verify#tok');
    expect(mail.text).toContain('for 24 hours');
    expect(mail.html).toContain('href="https://app.example.test/signup/verify#tok"');
  });

  it('existing account: says how that account signs in', () => {
    expect(signInMethod('https://t.eu.auth0.com/|google-oauth2|123')).toBe('google');
    expect(signInMethod('https://t.eu.auth0.com/|auth0|abc')).toBe('password');
    expect(signInMethod('crm-dev|ana@example.test')).toBe('other');
    const mail = existingAccountEmail({ to: 'ana@example.test', link: 'https://app.example.test/login', method: 'google' });
    expect(mail.text).toContain('Continue with Google');
    expect(mail.text).not.toContain('/signup/verify');
  });
});
