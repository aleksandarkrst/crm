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
/** "Forgot password?": the page that chooses a new password. */
export const resetLink = (appUrl: string, token: string) => `${base(appUrl)}/reset-password#${token}`;

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
  const subject = 'Confirm your email to create your Pultly account';
  const text = [
    'Hi,',
    '',
    `To finish creating your Pultly account for ${input.to}, confirm your email address and choose a password:`,
    input.link,
    '',
    `The link works once, for ${input.hours} hours.`,
    '',
    IGNORE,
  ].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">Hi,</p>`,
      `<p style="margin:0 0 12px">To finish creating your Pultly account for <strong>${escapeHtml(input.to)}</strong>, confirm your email address and choose a password.</p>`,
      buttonHtml('Confirm email address', input.link),
      `<p style="margin:0 0 12px">The link works once, for ${input.hours} hours.</p>`,
      `<p style="margin:0 0 12px;color:#475750;font-size:12.5px">If the button doesn't work, paste this link into your browser:<br><a href="${escapeHtml(input.link)}" style="color:#14503C;word-break:break-all">${escapeHtml(input.link)}</a></p>`,
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
  const subject = 'You already have a Pultly account';
  const text = ['Hi,', '', `Someone asked to create a Pultly account for ${input.to}, but this address already has one. ${how}`, '', input.link, '', IGNORE].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">Hi,</p>`,
      `<p style="margin:0 0 12px">Someone asked to create a Pultly account for <strong>${escapeHtml(input.to)}</strong>, but this address already has one. ${escapeHtml(how)}</p>`,
      buttonHtml('Sign in to Pultly', input.link),
    ].join('\n'),
    IGNORE,
  );
  return { to: input.to, subject, text, html };
}

/** "Forgot password?" for an account that signs in with a password: the link to choose a new one. */
export function passwordResetEmail(input: { to: string; link: string; hours: number }): MailMessage {
  const subject = 'Reset your Pultly password';
  const ignore = "If you didn't ask for this, you can ignore this email. Your password stays the same until the link is opened.";
  const valid = `The link works once, for ${input.hours === 1 ? 'one hour' : `${input.hours} hours`}.`;
  const text = ['Hi,', '', `To choose a new password for your Pultly account ${input.to}, open this link:`, input.link, '', valid, '', ignore].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">Hi,</p>`,
      `<p style="margin:0 0 12px">To choose a new password for your Pultly account <strong>${escapeHtml(input.to)}</strong>, use the button below.</p>`,
      buttonHtml('Choose a new password', input.link),
      `<p style="margin:0 0 12px">${valid}</p>`,
      `<p style="margin:0 0 12px;color:#475750;font-size:12.5px">If the button doesn't work, paste this link into your browser:<br><a href="${escapeHtml(input.link)}" style="color:#14503C;word-break:break-all">${escapeHtml(input.link)}</a></p>`,
    ].join('\n'),
    ignore,
  );
  return { to: input.to, subject, text, html };
}

/** "Forgot password?" for an account that has no password (it signs in with Google): how to sign in instead. */
export function noPasswordEmail(input: { to: string; link: string }): MailMessage {
  const subject = 'Signing in to Pultly';
  const how = `Your Pultly account ${input.to} signs in with Google, so it has no password to reset. Choose "Continue with Google" on the sign-in page.`;
  const text = ['Hi,', '', how, '', input.link, '', IGNORE].join('\n');
  const html = layoutHtml(
    [`<p style="margin:0 0 12px">Hi,</p>`, `<p style="margin:0 0 12px">${escapeHtml(how)}</p>`, buttonHtml('Sign in to Pultly', input.link)].join('\n'),
    IGNORE,
  );
  return { to: input.to, subject, text, html };
}
