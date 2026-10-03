/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the app runs; sign in and sign up link there. Defaults to https://app.pultly.com. */
  readonly VITE_APP_URL?: string;
  /** Where newsletter signups are POSTed as { email, lang }; unset = not stored yet. */
  readonly VITE_NEWSLETTER_URL?: string;
}
