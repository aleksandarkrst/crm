/**
 * Authentication, provider-agnostic.
 *
 * - VITE_AUTH_MODE=dev  → passwordless login against the backend's /api/auth/dev-login
 *                          (only works while the backend runs with AUTH_MODE=dev).
 * - VITE_AUTH_MODE=oidc → any OpenID Connect provider (Auth0, Zitadel, Keycloak, Entra ID,
 *                          Clerk, ...) via the authorization-code + PKCE flow.
 */
import type { UserManager } from 'oidc-client-ts';

const MODE = (import.meta.env.VITE_AUTH_MODE as string | undefined) ?? 'dev';
const DEV_TOKEN_KEY = 'crm.devToken';

/** The OIDC client is loaded only in oidc mode (CD-24): dev sign-in never downloads it. */
let manager: Promise<UserManager> | null = null;
function oidc(): Promise<UserManager> {
  manager ??= import('oidc-client-ts').then(
    ({ UserManager, WebStorageStateStore }) =>
      new UserManager({
        authority: import.meta.env.VITE_OIDC_AUTHORITY as string,
        client_id: import.meta.env.VITE_OIDC_CLIENT_ID as string,
        redirect_uri: `${window.location.origin}/auth/callback`,
        // Signing in again after the session ended opens a popup, so the page and its unsaved
        // edits stay (CD-88). /auth/callback handles both (completeSignIn).
        popup_redirect_uri: `${window.location.origin}/auth/callback`,
        post_logout_redirect_uri: window.location.origin,
        response_type: 'code',
        // offline_access: a refresh token, so the access token (2 h) is renewed without a
        // redirect, shortly before it expires and whenever it has expired anyway (CD-88).
        scope: 'openid profile email offline_access',
        automaticSilentRenew: true,
        extraQueryParams: import.meta.env.VITE_OIDC_AUDIENCE ? { audience: import.meta.env.VITE_OIDC_AUDIENCE as string } : undefined,
        userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      }),
  );
  return manager;
}

export const authMode = MODE;

export async function getAccessToken(): Promise<string | null> {
  if (MODE === 'oidc') {
    const user = await (await oidc()).getUser();
    if (user && !user.expired) return user.access_token;
    // Expired, e.g. after the laptop slept past the automatic renewal: renew now.
    if (user?.refresh_token && (await renewSession())) return (await (await oidc()).getUser())?.access_token ?? null;
    return null;
  }
  return localStorage.getItem(DEV_TOKEN_KEY);
}

/**
 * Gets a new access token with the refresh token, without leaving the page. False when there is
 * none or the provider refuses it (revoked, expired): then the user has to sign in again.
 * Concurrent callers share one renewal.
 */
let renewing: Promise<boolean> | null = null;
export function renewSession(): Promise<boolean> {
  if (MODE !== 'oidc') return Promise.resolve(false);
  renewing ??= (async () => {
    try {
      const mgr = await oidc();
      if (!(await mgr.getUser())?.refresh_token) return false;
      return !!(await mgr.signinSilent());
    } catch {
      return false;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

/**
 * Signs in again without leaving the page (a popup; dev mode signs in as the same email). Returns
 * the email now signed in, so the caller can check it's still the same person.
 */
export async function signInAgain(dev: { email: string; name: string }): Promise<string | null> {
  if (MODE === 'oidc') {
    const user = await (await oidc()).signinPopup();
    return (user.profile.email as string | undefined) ?? null;
  }
  await devLogin(dev.email, dev.name);
  return dev.email;
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

export const signIn = async () => (await oidc()).signinRedirect();
/** Finishes a sign-in at /auth/callback: a redirect, or the popup of signInAgain (which it closes). */
export const completeSignIn = async () => (await oidc()).signinCallback();

export async function signOut(): Promise<void> {
  if (MODE === 'oidc') await (await oidc()).signoutRedirect();
  else localStorage.removeItem(DEV_TOKEN_KEY);
}
