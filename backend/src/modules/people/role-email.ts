import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';
import type { AssignedRole } from '../../shared/database/schema';

export const ROLE_LABELS: Record<AssignedRole, string> = { administration: 'Administration', payroll: 'Payroll' };

export interface RoleEmailInput {
  to: string;
  employeeName: string;
  /** "Administration" or "Payroll". */
  roleLabel: string;
  kind: 'granted' | 'removed';
  /** The Admin who changed it, or null when they are no longer a member. */
  actorName: string | null;
  workspaceName: string;
  appUrl: string;
}

const WHAT: Record<string, string> = {
  Administration: 'You can now manage employees, departments, teams and reporting lines, and see their employment and personal details.',
  Payroll: 'You can now see what payroll needs, such as approved hours, as those modules go live.',
};

/**
 * "Role granted" / "Role removed" (spec 10.2): to the employee when an Admin assigns or removes
 * Administration or Payroll. Can't be turned off. Names the role, the workspace and who changed it;
 * never personal details. Pure, so it is unit-tested.
 */
export function roleChangedEmail(input: RoleEmailInput): MailMessage {
  const link = `${input.appUrl.replace(/\/+$/, '')}/settings/roles`;
  const who = input.actorName ?? 'An Admin';
  const granted = input.kind === 'granted';
  const subject = granted ? `You now have the ${input.roleLabel} role in ${input.workspaceName}` : `Your ${input.roleLabel} role in ${input.workspaceName} was removed`;
  const greeting = `Hi ${input.employeeName.split(' ')[0]},`;
  const intro = granted ? `${who} gave you the ${input.roleLabel} role in ${input.workspaceName}.` : `${who} removed your ${input.roleLabel} role in ${input.workspaceName}.`;
  const detail = granted ? (WHAT[input.roleLabel] ?? '') : 'You keep your other roles. What you can see and do changes the next time you open Pultly.';
  const footer = 'You get this email whenever an Admin changes your roles. It cannot be turned off.';
  const text = [greeting, '', intro, ...(detail ? [detail] : []), '', `See what each role may do: ${link}`, '', footer].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`,
      detail ? `<p style="margin:0 0 12px">${escapeHtml(detail)}</p>` : '',
      buttonHtml('See roles and permissions', link),
    ].join('\n'),
    footer,
    input.appUrl,
  );
  return { to: input.to, subject, text, html };
}
