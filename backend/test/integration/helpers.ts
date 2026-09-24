import { randomBytes } from 'node:crypto';
import { expect, inject } from 'vitest';

/** Unique per test run, so the suite can run against a shared dev database. */
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;

export interface Session {
  token: string;
  email: string;
  userId: string;
  name: string;
}

export interface Call {
  token?: string;
  tenant?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

// Response bodies are loosely typed on purpose: the tests assert on their shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface Reply<T = Json> {
  status: number;
  body: T;
}

/** One HTTP call to the API. Never throws on 4xx/5xx; assert on `status`. */
export async function call<T = Json>(method: string, path: string, opts: Call = {}): Promise<Reply<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.tenant) headers['x-tenant-id'] = opts.tenant;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${inject('apiUrl')}/api${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  return { status: res.status, body: body as T };
}

/** Calls the API and fails the test unless the status matches; returns the body. */
export async function ok<T = Json>(method: string, path: string, opts: Call = {}, status?: number): Promise<T> {
  const res = await call<T>(method, path, opts);
  const expected = status ?? (method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200);
  expect(res.status, `${method} ${path} → ${JSON.stringify(res.body)}`).toBe(expected);
  return res.body;
}

/** Signs in through the dev login with a unique email for this run. */
export async function signIn(label: string): Promise<Session> {
  const email = `${label}-${RUN}@example.test`;
  const name = `${label[0]!.toUpperCase()}${label.slice(1)} Tester`;
  const { accessToken } = await ok<{ accessToken: string }>('POST', '/auth/dev-login', { body: { email, name } }, 200);
  const me = await ok<{ user: { id: string } }>('GET', '/me', { token: accessToken });
  return { token: accessToken, email, userId: me.user.id, name };
}

/** Creates a tenant owned by `owner` (with the default funnels) and returns its id. */
export async function createTenant(owner: Session, name: string): Promise<string> {
  const tenant = await ok<{ id: string }>('POST', '/tenants', { token: owner.token, body: { name: `${name} ${RUN}` } });
  return tenant.id;
}

/** Invites `invitee` into the tenant and has them accept, so they join with `role`. */
export async function addMember(admin: Session, tenant: string, invitee: Session, role: 'admin' | 'member') {
  const { token } = await ok<{ token: string }>('POST', '/team/invitations', { token: admin.token, tenant, body: { email: invitee.email, role } });
  await ok('POST', `/invitations/${token}/accept`, { token: invitee.token }, 200);
}

export interface Stage {
  id: string;
  key: string;
  name: string;
  position: number;
  isWon: boolean;
  checklist: string[];
  checklistItems: { id: string; label: string }[];
}

export interface Funnel {
  id: string;
  key: string;
  label: string;
  note: string | null;
  stages: Stage[];
}

export interface Mail {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  sentAt: string;
}

/** Emails the log mail driver "sent" to `to`, newest first (GET /api/dev/mail, dev auth only). */
export async function mailTo(s: Session, to: string): Promise<Mail[]> {
  return ok<Mail[]>('GET', `/dev/mail?to=${encodeURIComponent(to)}`, { token: s.token });
}

/** Polls until `check` returns a value (the worker works asynchronously). */
export async function eventually<T>(check: () => Promise<T | null | undefined | false>, what: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Waits until at least `count` emails went to `to` and returns the newest. */
export async function waitForMail(s: Session, to: string, count = 1): Promise<Mail> {
  return eventually(async () => {
    const mails = await mailTo(s, to);
    return mails.length >= count ? mails[0] : null;
  }, `email #${count} to ${to}`);
}

export async function firstFunnel(s: Session, tenant: string): Promise<Funnel> {
  const funnels = await ok<Funnel[]>('GET', '/crm/funnels', { token: s.token, tenant });
  expect(funnels.length).toBeGreaterThan(0);
  return funnels[0]!;
}
