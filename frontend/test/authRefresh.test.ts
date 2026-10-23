// /api/auth/refresh (CD-445): one refused refresh shows sign-in and is not asked again.
// A valid cookie on a cold load (reload, deep link) is asked once and then kept.
// The address is left alone, so signing in returns to the deep link that was opened.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { pathAfterSignIn } from '../src/lib/pathAfterSignIn.ts';
import { watchSession } from '../src/lib/session.ts';

// VITE_AUTH_MODE is read when auth.ts loads. Set oidc before that import so production
// code does not carry a test-only mode switch.
const authUrl = new URL('../src/lib/auth.ts', import.meta.url).href;
const authHooks = registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (url !== authUrl) return loaded;
    const raw = loaded.source;
    const source = typeof raw === 'string' ? raw : raw ? Buffer.from(raw).toString('utf8') : '';
    const next = source.replace(
      /const MODE = \(import\.meta\.env(?:\?)?\.VITE_AUTH_MODE(?: as string \| undefined)?\) \?\? 'dev';/,
      "const MODE = 'oidc';",
    );
    if (next === source) throw new Error(`Could not set the auth mode before loading ${url}`);
    return { format: loaded.format, source: next };
  },
});

const { adoptSession, authMode, getAccessToken, onSessionEnded, passwordSignIn, renewSession, resetAuthForTests } = await import('../src/lib/auth.ts');
authHooks.deregister();

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
      if (url.startsWith('/')) pathname = url;
    },
  } as Location;
  resetAuthForTests();
  assert.equal(authMode, 'oidc');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetAuthForTests();
});

describe('a refused refresh (CD-445)', () => {
  it('asks once and shows sign-in once, without leaving the page', async () => {
    install((url) => (url === '/api/auth/refresh' ? refused() : json(401, { message: 'Missing bearer token' })));
    let shown = 0;
    onSessionEnded(() => shown++);

    assert.equal(await getAccessToken(), null);
    assert.equal(shown, 1);
    assert.equal(pathname, '/pipeline');
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
    assert.equal(shown, 1);
    assert.equal(pathname, '/pipeline');
    assert.deepEqual(assigns, []);
  });

  it('shares one attempt when several callers renew together', async () => {
    install(() => refused());
    let shown = 0;
    onSessionEnded(() => shown++);

    const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
    assert.deepEqual(tokens, [null, null, null]);
    assert.equal(refreshCalls().length, 1);
    assert.equal(shown, 1);
    assert.equal(pathname, '/pipeline');

    await Promise.all([getAccessToken(), renewSession()]);
    assert.equal(refreshCalls().length, 1);
    assert.equal(shown, 1);
  });

  it('opens the sign-in dialog once while the app is open, without leaving the page', async () => {
    install(() => refused());
    let shown = 0;
    const stopRedirect = onSessionEnded(() => shown++);
    let dialog = false;
    const stopWatch = watchSession((open) => {
      dialog = open;
    });
    try {
      assert.equal(await getAccessToken(), null);
      assert.equal(dialog, true);
      assert.equal(shown, 0);
      assert.deepEqual(assigns, []);
      await getAccessToken();
      await renewSession();
      assert.equal(refreshCalls().length, 1);
      assert.equal(pathname, '/pipeline');
    } finally {
      stopWatch();
      stopRedirect();
    }
  });

  it('stays on the sign-up page when there is no session', async () => {
    pathname = '/signup';
    install(() => refused());
    let shown = 0;
    onSessionEnded(() => shown++);

    assert.equal(await getAccessToken(), null);
    await getAccessToken();
    await renewSession();

    assert.equal(refreshCalls().length, 1);
    assert.equal(shown, 0);
    assert.equal(pathname, '/signup');
    assert.deepEqual(assigns, []);
  });

  it('a signed-out deep link lands on its original path after sign-in', async () => {
    pathname = '/pipeline';
    install((url) => (url === '/api/auth/refresh' ? refused() : json(200, { accessToken: 'signed-in', expiresIn: 3600 })));
    let phase = 'loading';
    onSessionEnded(() => {
      phase = 'signed-out';
    });

    assert.equal(await getAccessToken(), null);
    assert.equal(phase, 'signed-out');
    assert.equal(refreshCalls().length, 1);
    // Sign-in is shown on the page that was opened. The URL is not replaced with /login.
    assert.equal(pathname, '/pipeline');
    assert.deepEqual(assigns, []);
    assert.equal(pathAfterSignIn(pathname), '/pipeline');
    assert.equal(pathAfterSignIn('/companies/abc'), '/companies/abc');

    await passwordSignIn('ada@example.com', 'secret');
    assert.equal(await getAccessToken(), 'signed-in');
    assert.equal(refreshCalls().length, 1);
    assert.equal(pathAfterSignIn(pathname), '/pipeline');
    // The sign-in page itself has nowhere to return to.
    assert.equal(pathAfterSignIn('/login'), '/');
  });

  it('tries again after a network failure, and signs in clears a refused session', async () => {
    let down = true;
    install((url) => {
      if (url === '/api/auth/refresh' && down) throw new TypeError('network down');
      if (url === '/api/auth/refresh') return json(200, { accessToken: 'fresh', expiresIn: 3600 });
      return json(200, {});
    });
    let shown = 0;
    onSessionEnded(() => shown++);

    assert.equal(await getAccessToken(), null);
    assert.equal(shown, 0);
    down = false;
    assert.equal(await getAccessToken(), 'fresh');
    assert.equal(refreshCalls().length, 2);

    down = true;
    // Force the token to look due, then refuse it, then sign in with a new one.
    adoptSession({ accessToken: 'stale', expiresIn: 0 });
    install(() => refused());
    assert.equal(await getAccessToken(), null);
    assert.equal(shown, 1);
    assert.equal(pathname, '/pipeline');
    const refusedCount = refreshCalls().length;
    adoptSession({ accessToken: 'signed-in', expiresIn: 3600 });
    assert.equal(await getAccessToken(), 'signed-in');
    assert.equal(refreshCalls().length, refusedCount);
  });
});

describe('a valid session on load (CD-445)', () => {
  // The browser sends crm_session only with credentials, and stores a new one only from Set-Cookie.
  // A refresh that omits that header leaves the used token in place, so the next load is refused.
  it('stays signed in across a reload when the refresh response replaces the cookie', async () => {
    let cookie = 'seed';
    const live = new Set(['seed']);
    let n = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      calls.push({ url, method: init?.method, credentials: init?.credentials, authorization: headers.get('authorization') });
      if (url !== '/api/auth/refresh') return json(200, { ok: true });
      const sent = init?.credentials === 'same-origin' || init?.credentials === 'include' ? cookie : '';
      if (!live.has(sent)) return refused();
      live.delete(sent);
      n += 1;
      const next = `rt-${n}`;
      live.add(next);
      const res = new Response(JSON.stringify({ accessToken: `access-${n}`, expiresIn: 3600 }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': `crm_session=${next}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=2592000`,
        },
      });
      const line = res.headers.getSetCookie().find((value) => value.startsWith('crm_session='));
      if (line) cookie = decodeURIComponent(line.slice('crm_session='.length).split(';')[0]!.trim());
      return res;
    }) as typeof fetch;

    assert.equal(await getAccessToken(), 'access-1');
    assert.equal(refreshCalls().length, 1);
    assert.equal(refreshCalls()[0]!.credentials, 'same-origin');
    assert.equal(await getAccessToken(), 'access-1');
    assert.equal(refreshCalls().length, 1);

    // A reload drops the in-memory access token. The cookie jar is what the browser still has.
    resetAuthForTests();
    let shown = 0;
    onSessionEnded(() => shown++);
    assert.equal(await getAccessToken(), 'access-2');
    assert.equal(shown, 0);
    assert.equal(refreshCalls().length, 2);
    await Promise.all([getAccessToken(), getAccessToken()]);
    assert.equal(await getAccessToken(), 'access-2');
    assert.equal(refreshCalls().length, 2);
    assert.deepEqual(assigns, []);
  });

  it('refreshes once for a deep link and reuses the access token while moving between screens', async () => {
    pathname = '/pipeline';
    install((url) => (url === '/api/auth/refresh' ? json(200, { accessToken: 'access-1', expiresIn: 3600 }) : json(200, { ok: true })));
    let shown = 0;
    onSessionEnded(() => shown++);

    assert.equal(await getAccessToken(), 'access-1');
    assert.equal(refreshCalls().length, 1);

    pathname = '/companies';
    assert.equal(await getAccessToken(), 'access-1');
    pathname = '/';
    assert.equal(await getAccessToken(), 'access-1');
    await Promise.all([getAccessToken(), getAccessToken()]);

    assert.equal(refreshCalls().length, 1);
    assert.equal(shown, 0);
    assert.deepEqual(assigns, []);
    assert.equal(calls.some((c) => c.url.includes('app.pultly.com')), false);
  });
});
