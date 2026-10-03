import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';
import { SecretBox } from '../../infrastructure/crypto/secret-box';
import type { Env } from '../../infrastructure/config/config.module';

/**
 * Encrypts invite tokens at rest (invitations.token_sealed), so the worker can email the link and
 * admins can resend or copy it. Null when there is no secret (only possible outside production
 * with AUTH_MODE=oidc and no APP_SECRET): invitations then work as before CD-7, link shown once.
 */
export function inviteLinkBox(env: Env): SecretBox | null {
  const secret = env.APP_SECRET ?? env.DEV_JWT_SECRET;
  return secret ? new SecretBox(secret, 'invite-link') : null;
}

export const inviteLink = (appUrl: string, token: string) => `${appUrl.replace(/\/+$/, '')}/invite/${token}`;

export interface InvitationEmailInput {
  to: string;
  workspaceName: string;
  inviterName: string | null;
  inviterEmail: string | null;
  role: 'admin' | 'member';
  link: string;
  expiresAt: Date;
  timeZone: string;
}

function dateLabel(d: Date, timeZone: string): string {
  try {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone });
  } catch {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
}

/** The invitation email: who invited them to which workspace, and the accept link. */
export function invitationEmail(input: InvitationEmailInput): MailMessage {
  const inviter = input.inviterName || input.inviterEmail || 'A teammate';
  const inviterFull = input.inviterName && input.inviterEmail && input.inviterName !== input.inviterEmail ? `${input.inviterName} (${input.inviterEmail})` : inviter;
  const role = input.role === 'admin' ? 'an admin' : 'a member';
  const until = dateLabel(input.expiresAt, input.timeZone);
  const subject = `${inviter} invited you to ${input.workspaceName} on Pultly`;
  const text = [
    'Hi,',
    '',
    `${inviterFull} invited you to join ${input.workspaceName} on Pultly as ${role}. Pultly is where the team keeps its deals, companies and contacts.`,
    '',
    'Accept the invitation:',
    input.link,
    '',
    `The link works once, until ${until}. Sign in with this email address (${input.to}) to accept it.`,
    '',
    "If you weren't expecting this invitation, you can ignore this email.",
  ].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">Hi,</p>`,
      `<p style="margin:0 0 12px"><strong>${escapeHtml(inviterFull)}</strong> invited you to join <strong>${escapeHtml(input.workspaceName)}</strong> on Pultly as ${role}. Pultly is where the team keeps its deals, companies and contacts.</p>`,
      buttonHtml('Accept the invitation', input.link),
      `<p style="margin:0 0 12px">The link works once, until ${escapeHtml(until)}. Sign in with this email address (${escapeHtml(input.to)}) to accept it.</p>`,
      `<p style="margin:0 0 12px;color:#475750;font-size:12.5px">If the button doesn't work, paste this link into your browser:<br><a href="${escapeHtml(input.link)}" style="color:#14503C;word-break:break-all">${escapeHtml(input.link)}</a></p>`,
    ].join('\n'),
    "If you weren't expecting this invitation, you can ignore this email.",
  );
  return { to: input.to, subject, text, html };
}
