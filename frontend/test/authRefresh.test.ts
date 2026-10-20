// /api/auth/refresh (CD-445): one refused refresh sends the person to sign in and is not asked again.
// A valid cookie on a cold load (reload, deep link) is asked once and then kept.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { adoptSession, getAccessToken, onSessionEnded, renewSession, resetAuthForTests, setAuthModeForTests } from '../src/lib/auth.ts';
import { watchSession } from '../src/lib/session.ts';

interface Call {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  authorization: string | null;
}

const calls: Call[] = [];
const assigns: string[] = [];
let pathname = '/pipeline';
const originalFetch = globalThis.fetch;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function install(handler: (url: string) => Response): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: init?.method, credentials: init?.credentials, authorization: headers.get('authorization') });
    return handler(url);
  }) as typeof fetch;
}

const refreshCalls = () => calls.filter((c) => c.url === '/api/auth/refresh');

const refused = () => json(401, { code: 'expired', message: 'Sign in to continue.' });

beforeEach(() => {
  calls.length = 0;
  assigns.length = 0;
  pathname = '/pipeline';
  globalThis.location = {
    get pathname() {
      return pathname;
    },
    assign(url: string) {
      assigns.push(url);
    },
  } as Location;
  resetAuthForTests();
  setAuthModeForTests('oidc');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAuthForTests();
});

describe('a refused refresh (CD-445)', () => {
  it('asks once and redirects to sign-in once', async () => {
    install((url) => (url === '/api/auth/refresh' ? refused() : json(401, { message: 'Missing bearer token' })));
    const redirects: string[] = [];
    onSessionEnded(() => redirects.push('/login'));

    assert.equal(await getAccessToken(), null);
    assert.deepEqual(redirects, ['/login']);
    assert.equal(refreshCalls().length, 1);
    assert.equal(refreshCalls()[0]!.url, '/api/auth/refresh');
    assert.equal(refreshCalls()[0]!.method, 'POST');
    assert.equal(refreshCalls()[0]!.credentials, 'same-origin');
    assert.equal(calls.some((c) => c.url.includes('app.pultly.com')), false);

    // authorizedFetch retries through renewSession(); a later screen does the same via getAccessToken().
    await getAccessToken();
    await renewSession();
    await Promise.all([getAccessToken(), renewSession(), getAccessToken()]);

    assert.equal(refreshCalls().length, 1);
    assert.deepEqual(redirects, ['/login']);
    assert.deepEqual(assigns, []);
  });

  it('shares one attempt when several callers renew together', async () => {
    install(() => refused());
    const redirects: string[] = [];
    onSessionEnded(() => redirects.push('/login'));

    const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    assert.deepEqual(tokens, [null, null, null]);
    assert.equal(refreshCalls().length, 1);
    assert.deepEqual(redirects, ['/login']);

    await Promise.all([getAccessToken(), renewSession()]);
    assert.equal(refreshCalls().length, 1);
    assert.deepEqual(redirects, ['/login']);
  });

  it('opens the sign-in dialog once while the app is open, without leaving the page', async () => {
    install(() => refused());
    const redirects: string[] = [];
    const stopRedirect = onSessionEnded(() => redirects.push('/login'));
    let shown = false;
    const stopWatch = watchSession((open) => {
      shown = open;
    });
    try {
      assert.equal(await getAccessToken(), null);
      assert.equal(shown, true);
      assert.deepEqual(redirects, []);
      assert.deepEqual(assigns, []);
      await getAccessToken();
      await renewSession();
      assert.equal(refreshCalls().length, 1);
    } finally {
      stopWatch();
      stopRedirect();
    }
  });

  it('stays on the sign-up page when there is no session', async () => {
    pathname = '/signup';
    install(() => refused());
    const redirects: string[] = [];
    onSessionEnded(() => redirects.push('/login'));

    assert.equal(await getAccessToken(), null);
    await getAccessToken();
    await renewSession();

    assert.equal(refreshCalls().length, 1);
    assert.deepEqual(redirects, []);
    assert.deepEqual(assigns, []);
  });

  it('assigns /login once when the page has no listener of its own', async () => {
    install(() => refused());
    assert.equal(await getAccessToken(), null);
    await getAccessToken();
    await renewSession();
    assert.equal(refreshCalls().length, 1);
    assert.deepEqual(assigns, ['/login']);
  });

  it('tries again after a network failure, and signs in clears a refused session', async () => {
    let down = true;
    install((url) => {
      if (url === '/api/auth/refresh' && down) throw new TypeError('network down');
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'fresh', expiresIn: 3600 });
      return json(200, {});
    });
    const redirects: string[] = [];
    onSessionEnded(() => redirects.push('/login'));

    assert.equal(await getAccessToken(), null);
    assert.deepEqual(redirects, []);
    down = false;
    assert.equal(await getAccessToken(), 'fresh');
    assert.equal(refreshCalls().length, 2);

    down = true;
    // Force the token to look due, then refuse it, then sign in with a new one.
    adoptSession({ accessToken: 'stale', expiresIn: 0 });
    install(() => refused());
    assert.equal(await getAccessToken(), null);
    assert.deepEqual(redirects, ['/login']);
    const refusedCount = refreshCalls().length;
    adoptSession({ accessToken: 'signed-in', expiresIn: 3600 });
    assert.equal(await getAccessToken(), 'signed-in');
    assert.equal(refreshCalls().length, refusedCount);
  });
});

describe('a valid session on load (CD-445)', () => {
  it('refreshes once for a deep link and reuses the access token while moving between screens', async () => {
    pathname = '/pipeline';
    install((url) => (url === '/api/auth/refresh' ? json(200, { accessToken: 'access-1', expiresIn: 3600 }) : json(200, { ok: true })));
    const redirects: string[] = [];
    onSessionEnded(() => redirects.push('/login'));

    assert.equal(await getAccessToken(), 'access-1');
    assert.equal(refreshCalls().length, 1);

    pathname = '/companies';
    assert.equal(await getAccessToken(), 'access-1');
    pathname = '/';
    assert.equal(await getAccessToken(), 'access-1');
    await Promise.all([getAccessToken(), getAccessToken()]);

    assert.equal(refreshCalls().length, 1);
    assert.deepEqual(redirects, []);
    assert.deepEqual(assigns, []);
    assert.equal(calls.some((c) => c.url.includes('app.pultly.com')), false);
  });
});
