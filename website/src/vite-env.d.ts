/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the app runs; sign in and sign up link there. Defaults to https://app.pultly.com. */
  readonly VITE_APP_URL?: string;
  /** The MailerLite account and embedded form newsletter signups go to; unset = not stored. */
  readonly VITE_MAILERLITE_ACCOUNT_ID?: string;
  readonly VITE_MAILERLITE_FORM_ID?: string;
}
