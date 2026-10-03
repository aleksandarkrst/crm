// Sign in and account creation live in the app, not on the website.
// VITE_APP_URL overrides the app's address, e.g. for staging or local development.
const APP_URL = (import.meta.env.VITE_APP_URL || 'https://app.pultly.com').replace(/\/$/, '');

export const SIGN_IN_URL = `${APP_URL}/login`;
export const SIGN_UP_URL = `${APP_URL}/signup`;
