/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_MODE?: 'dev' | 'oidc';
  /** The frontend project's Sentry DSN (CD-8); unset = no error tracking. */
  readonly VITE_SENTRY_DSN?: string;
  /** production or staging: which deployment the errors come from (CD-105). */
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** The deployed commit, sent with each error as its release. */
  readonly VITE_APP_VERSION?: string;
}
