/**
 * Authentication (CD-114). Signing in happens on Pultly's own pages; no provider page is shown.
 *
 * - VITE_AUTH_MODE=dev  → passwordless login against the backend's /api/auth/dev-login
 *                          (only works while the backend runs with AUTH_MODE=dev).
 * - VITE_AUTH_MODE=oidc → the backend checks the password (or runs "Continue with Google") with
 *                          the identity provider and keeps the refresh token in an httpOnly
 *                          cookie. This tab holds only the short-lived access token, in memory,
 *                          and gets a new one from /api/auth/refresh when it runs out.
 */
const MODE = (import.meta.env.VITE_AUTH_MODE as string | undefined) ?? 'dev';
const DEV_TOKEN_KEY = 'crm.devToken';

export const authMode = MODE;

/** What signing in returns: the access token and for how many seconds it works. */
export interface SignedIn {
  accessToken: string;
  expiresIn: number;
}

/** Why signing in didn't work. `message` is written for the person signing in. */
export class SignInError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let access: { token: string; expiresAt: number } | null = null;

/** Takes a fresh access token into use: in memory (oidc), or in localStorage (dev). */
export function adoptSession({ accessToken, expiresIn }: SignedIn) {
  if (MODE === 'oidc') access = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  else localStorage.setItem(DEV_TOKEN_KEY, accessToken);
}

async function post<T>(path: string, json: unknown = {}): Promise<T> {
  const res = await fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(json),
  });
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string | string[] } | null;
  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
    throw new SignInError(body?.code ?? String(res.status), res.status === 429 && !body?.code ? 'Too many attempts. Wait a minute, then try again.' : (message ?? `Sign-in failed (${res.status})`), res.status);
  }
  return body as T;
}

export async function getAccessToken(): Promise<string | null> {
  if (MODE !== 'oidc') return localStorage.getItem(DEV_TOKEN_KEY);
  // A little before it runs out, so a request doesn't leave with a token that expires on the way.
  if (access && access.expiresAt > Date.now() + 30_000) return access.token;
  return (await renewSession()) ? (access?.token ?? null) : null;
}

/**
 * Gets a new access token for the session in the cookie, without leaving the page. False when
 * there is none or it ended (revoked, expired): then the user has to sign in again. Concurrent
 * callers share one renewal, and tabs take turns (the provider rotates the refresh token).
 */
let renewing: Promise<boolean> | null = null;
export function renewSession(): Promise<boolean> {
  if (MODE !== 'oidc') return Promise.resolve(false);
  const renew = async () => {
    try {
      adoptSession(await post<SignedIn>('/refresh'));
      return true;
    } catch {
      access = null;
      return false;
    }
  };
  renewing ??= (navigator.locks ? navigator.locks.request('crm.renew-session', renew) : renew()).finally(() => {
    renewing = null;
  });
  return renewing;
}

/** Signs in with an email and password. Throws SignInError with a message to show. */
export async function passwordSignIn(email: string, password: string): Promise<void> {
  adoptSession(await post<SignedIn>('/login', { email, password }));
}

/** "Continue with Google": the whole page goes to Google's account picker and comes back to /auth/callback. */
export function googleSignIn() {
  window.location.assign('/api/auth/google');
}

/**
 * "Continue with Google" in a popup, so the page and its unsaved edits stay (CD-88). Resolves
 * when /auth/callback reports back, or rejects when the window is closed or blocked.
 */
function googlePopup(): Promise<void> {
  const popup = window.open('/api/auth/google?popup=1', 'crm-google-sign-in', 'width=480,height=640');
  if (!popup) return Promise.reject(new SignInError('popup', 'The sign-in window was blocked. Allow pop-ups for this site and try again.', 0));
  return new Promise((resolve, reject) => {
    const done = (fn: () => void) => {
      window.removeEventListener('message', onMessage);
      clearInterval(closed);
      fn();
    };
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; result?: string } | null;
      if (e.origin !== window.location.origin || data?.type !== POPUP_MESSAGE) return;
      done(() => (data.result === 'ok' ? resolve() : reject(new SignInError(data.result ?? 'failed', signInProblemText(data.result), 0))));
    };
    const closed = setInterval(() => {
      if (popup.closed) done(() => reject(new SignInError('cancelled', 'The sign-in window was closed before signing in.', 0)));
    }, 500);
    window.addEventListener('message', onMessage);
  });
}

/** How /auth/callback, opened in the popup, tells this page how signing in went. */
export const POPUP_MESSAGE = 'crm.google-sign-in';

/** The email in an access token, to check that signing in again kept the same person. */
function tokenEmail(token: string | null): string | null {
  try {
    const payload = JSON.parse(atob(token!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { email?: unknown };
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

/**
 * Signs in again without leaving the page: with the password, or Google in a popup (dev mode
 * signs in as the same email). Returns the email now signed in, so the caller can check it's
 * still the same person.
 */
export async function signInAgain(how: { email: string; name: string; password?: string; google?: boolean }): Promise<string | null> {
  if (MODE !== 'oidc') {
    await devLogin(how.email, how.name);
    return how.email;
  }
  if (how.google) {
    await googlePopup();
    if (!(await renewSession())) throw new SignInError('failed', signInProblemText('failed'), 0);
  } else {
    await passwordSignIn(how.email, how.password ?? '');
  }
  return tokenEmail(access?.token ?? null);
}

export async function devLogin(email: string, name: string): Promise<void> {
  const res = await fetch('/api/auth/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) throw new Error(`Dev login failed (${res.status})`);
  const { accessToken } = (await res.json()) as { accessToken: string };
  localStorage.setItem(DEV_TOKEN_KEY, accessToken);
}

/** What the sign-in page says after "Continue with Google" didn't finish (/auth/callback?result=…). */
export function signInProblemText(result: string | null | undefined): string {
  if (result === 'cancelled') return 'Sign-in with Google was cancelled. Choose a way to sign in when you are ready.';
  if (result === 'unavailable') return "Signing in with Google isn't available here. Sign in with your email and password.";
  return "Sign-in with Google didn't finish. Try again, or sign in with your email and password.";
}

/**
 * Why the last sign-in didn't finish, for the sign-in page: kept for this tab until it has been
 * shown.
 */
const PROBLEM_KEY = 'crm.signInProblem';
export function rememberSignInProblem(result: string | null) {
  sessionStorage.setItem(PROBLEM_KEY, signInProblemText(result));
}
export function takeSignInProblem(): string {
  const message = sessionStorage.getItem(PROBLEM_KEY) ?? '';
  sessionStorage.removeItem(PROBLEM_KEY);
  return message;
}

export async function signOut(): Promise<void> {
  if (MODE === 'oidc') {
    access = null;
    await post('/logout').catch(() => {});
  } else localStorage.removeItem(DEV_TOKEN_KEY);
}
