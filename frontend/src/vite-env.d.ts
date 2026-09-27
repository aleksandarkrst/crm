/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MODE?: 'dev' | 'oidc';
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_OIDC_AUDIENCE?: string;
  /** The frontend project's Sentry DSN (CD-8); unset = no error tracking. */
  readonly VITE_SENTRY_DSN?: string;
  /** The deployed commit, sent with each error as its release. */
  readonly VITE_APP_VERSION?: string;
}
