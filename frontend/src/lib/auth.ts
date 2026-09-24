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
        post_logout_redirect_uri: window.location.origin,
        response_type: 'code',
        scope: 'openid profile email',
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
    return user && !user.expired ? user.access_token : null;
  }
  return localStorage.getItem(DEV_TOKEN_KEY);
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
export const completeSignIn = async () => (await oidc()).signinRedirectCallback();

export async function signOut(): Promise<void> {
  if (MODE === 'oidc') await (await oidc()).signoutRedirect();
  else localStorage.removeItem(DEV_TOKEN_KEY);
}
