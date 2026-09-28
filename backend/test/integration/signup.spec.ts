/**
 * Creating an account with email (CD-114): the confirmation email carries a link that works once
 * and expires; the password can only be set through it; an address that already has an account
 * gets a "sign in instead" email, and the API answers the same either way. A new sign-in whose
 * email already belongs to an account that signs in another way is refused, not duplicated.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { call, mailTo, ok, type Session, signIn, waitForMail } from './helpers';

const RUN = Date.now().toString(36);
let reader: Session; // reads the dev outbox, which needs a signed-in user
let db: Client;

beforeAll(async () => {
  reader = await signIn('signup-reader');
  db = new Client({ connectionString: inject('databaseUrl') });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

/** Asks for the confirmation email and returns the token from its link. */
async function requestLink(email: string, count = 1): Promise<string> {
  expect(await ok('POST', '/auth/signup', { body: { email } }, 202)).toEqual({ sent: true });
  const mail = await waitForMail(reader, email, count);
  expect(mail.subject).toBe('Confirm your email to create your Cadence account');
  const token = /\/signup\/verify#([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  expect(token, mail.text).toBeTruthy();
  expect(mail.html).toContain(`href="http://app.example.test/signup/verify#${token}"`);
  return token!;
}

describe('create account with email', () => {
  it('offers email (dev mode has no Google)', async () => {
    expect(await ok('GET', '/auth/signup/options')).toEqual({ email: true, google: null });
  });

  it('confirms the address, then sets the password once', async () => {
    const email = `signup-new-${RUN}@example.test`;
    const token = await requestLink(email.toUpperCase().replace('@EXAMPLE.TEST', '@example.test'));
    expect(await ok('POST', '/auth/signup/check', { body: { token } }, 200)).toEqual({ email });

    const weak = await call('POST', '/auth/signup/complete', { body: { token, password: 'short' } });
    expect(weak.status).toBe(400);
    // A refused password doesn't use the link up.
    expect(await ok('POST', '/auth/signup/check', { body: { token } }, 200)).toEqual({ email });

    expect(await ok('POST', '/auth/signup/complete', { body: { token, password: 'a long enough password' } }, 200)).toEqual({ email });
    const again = await call('POST', '/auth/signup/complete', { body: { token, password: 'a long enough password' } });
    expect(again.status).toBe(410);
    expect(again.body).toMatchObject({ code: 'used' });
    expect((await call('POST', '/auth/signup/check', { body: { token } })).body).toMatchObject({ code: 'used' });
  });

  it('explains an unknown and an expired link, and a new email replaces the old link', async () => {
    const unknown = await call('POST', '/auth/signup/check', { body: { token: 'x'.repeat(43) } });
    expect(unknown.status).toBe(410);
    expect(unknown.body).toMatchObject({ code: 'invalid' });

    const email = `signup-expired-${RUN}@example.test`;
    const token = await requestLink(email);
    await db.query(`update signup_requests set expires_at = now() - interval '1 minute', created_at = now() - interval '1 hour' where email = $1`, [email]);
    const expired = await call('POST', '/auth/signup/complete', { body: { token, password: 'a long enough password' } });
    expect(expired.status).toBe(410);
    expect(expired.body).toMatchObject({ code: 'expired', email });

    const fresh = await requestLink(email, 2);
    expect(fresh).not.toBe(token);
    expect((await call('POST', '/auth/signup/check', { body: { token } })).body).toMatchObject({ code: 'invalid' });
    expect(await ok('POST', '/auth/signup/check', { body: { token: fresh } }, 200)).toEqual({ email });
  });

  it('asking again within a minute keeps the link and sends no second email', async () => {
    const email = `signup-twice-${RUN}@example.test`;
    const token = await requestLink(email);
    await ok('POST', '/auth/signup', { body: { email } }, 202);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await mailTo(reader, email)).toHaveLength(1);
    expect(await ok('POST', '/auth/signup/check', { body: { token } }, 200)).toEqual({ email });
  });

  it('answers the same for an existing account, whose owner is emailed to sign in instead', async () => {
    const existing = await signIn('signup-existing');
    expect(await ok('POST', '/auth/signup', { body: { email: existing.email } }, 202)).toEqual({ sent: true });
    const mail = await waitForMail(reader, existing.email);
    expect(mail.subject).toBe('You already have a Cadence account');
    expect(mail.text).toContain('http://app.example.test/login');
    expect(mail.text).not.toContain('/signup/verify');
  });

  it('refuses a link for an address that got an account in the meantime', async () => {
    const email = `signup-late-${RUN}@example.test`;
    const token = await requestLink(email);
    await ok('POST', '/auth/dev-login', { body: { email, name: 'Late Tester' } }, 200).then(({ accessToken }) => ok('GET', '/me', { token: accessToken }));
    const res = await call('POST', '/auth/signup/complete', { body: { token, password: 'a long enough password' } });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'exists' });
  });

  it('validates the email and the token', async () => {
    expect((await call('POST', '/auth/signup', { body: { email: 'not an email' } })).status).toBe(400);
    expect((await call('POST', '/auth/signup/check', { body: { token: 'short' } })).status).toBe(400);
  });
});

describe('an email that already signs in another way', () => {
  it('is refused instead of creating a second account', async () => {
    const email = `signup-google-${RUN}@example.test`;
    // The account was made with Google; now the same address signs in with a password.
    await db.query(`insert into users (auth_subject, email, display_name) values ($1, $2, 'Gina Google')`, [`https://idp.example.test/|google-oauth2|${RUN}`, email]);
    const { accessToken } = await ok<{ accessToken: string }>('POST', '/auth/dev-login', { body: { email: email.toUpperCase(), name: 'Gina Again' } }, 200);
    const me = await call('GET', '/me', { token: accessToken });
    expect(me.status).toBe(409);
    expect(me.body).toMatchObject({ code: 'account_exists', method: 'google' });
    expect(me.body.message).toContain('with Google');
    const { rows } = await db.query('select count(*)::int as n from users where lower(email) = $1', [email]);
    expect(rows[0].n).toBe(1);
  });
});
