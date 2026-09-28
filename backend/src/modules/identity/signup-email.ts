import type { Env } from '../../infrastructure/config/config.module';
import { SecretBox } from '../../infrastructure/crypto/secret-box';
import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';

/** Encrypts sign-up tokens at rest (signup_requests.token_sealed), so the worker can email the link. */
export function signupLinkBox(env: Env): SecretBox | null {
  const secret = env.APP_SECRET ?? env.DEV_JWT_SECRET;
  return secret ? new SecretBox(secret, 'signup-link') : null;
}

const base = (appUrl: string) => appUrl.replace(/\/+$/, '');
/** The token goes after `#`, so it never reaches a server log. */
export const signupLink = (appUrl: string, token: string) => `${base(appUrl)}/signup/verify#${token}`;
export const loginLink = (appUrl: string) => `${base(appUrl)}/login`;

/** How an existing account signs in, from its subject ("<issuer>|<provider sub>"). */
export type SignInMethod = 'google' | 'password' | 'other';
export function signInMethod(authSubject: string): SignInMethod {
  const sub = authSubject.slice(authSubject.indexOf('|') + 1);
  if (sub.startsWith('google-oauth2|')) return 'google';
  if (sub.startsWith('auth0|')) return 'password';
  return 'other';
}

const IGNORE = "If you didn't ask for this, you can ignore this email. Nothing changes until the link is opened.";

/** The confirmation email of "Continue with email": the link that leads to choosing a password. */
export function signupEmail(input: { to: string; link: string; hours: number }): MailMessage {
  const subject = 'Confirm your email to create your Cadence account';
  const text = [
    'Hi,',
    '',
    `To finish creating your Cadence account for ${input.to}, confirm your email address and choose a password:`,
    input.link,
    '',
    `The link works once, for ${input.hours} hours.`,
    '',
    IGNORE,
  ].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">Hi,</p>`,
      `<p style="margin:0 0 12px">To finish creating your Cadence account for <strong>${escapeHtml(input.to)}</strong>, confirm your email address and choose a password.</p>`,
      buttonHtml('Confirm email address', input.link),
      `<p style="margin:0 0 12px">The link works once, for ${input.hours} hours.</p>`,
      `<p style="margin:0 0 12px;color:#475467;font-size:12.5px">If the button doesn't work, paste this link into your browser:<br><a href="${escapeHtml(input.link)}" style="color:#14503C;word-break:break-all">${escapeHtml(input.link)}</a></p>`,
    ].join('\n'),
    IGNORE,
  );
  return { to: input.to, subject, text, html };
}

/**
 * Sent instead of the confirmation when the address already has an account, so the sign-up page
 * never has to say so (anyone could type the address there).
 */
export function existingAccountEmail(input: { to: string; link: string; method: SignInMethod }): MailMessage {
  const how =
    input.method === 'google'
      ? 'You created it with Google, so choose "Continue with Google" to sign in.'
      : input.method === 'password'
        ? 'Sign in with your email address and password. If you forgot the password, choose "Forgot password?" on the sign-in page.'
        : 'Sign in the way you did before.';
  const subject = 'You already have a Cadence account';
  const text = ['Hi,', '', `Someone asked to create a Cadence account for ${input.to}, but this address already has one. ${how}`, '', input.link, '', IGNORE].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">Hi,</p>`,
      `<p style="margin:0 0 12px">Someone asked to create a Cadence account for <strong>${escapeHtml(input.to)}</strong>, but this address already has one. ${escapeHtml(how)}</p>`,
      buttonHtml('Sign in to Cadence', input.link),
    ].join('\n'),
    IGNORE,
  );
  return { to: input.to, subject, text, html };
}
