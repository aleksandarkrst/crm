import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';

export interface ReportingLineEmailInput {
  to: string;
  /** 'employee': "New manager" to the employee; 'manager': "New direct report" to the manager. */
  recipient: 'employee' | 'manager';
  employee: { id: string; fullName: string; jobTitle: string | null };
  manager: { id: string; fullName: string; jobTitle: string | null };
  /** Who changed it (a member's name), or null when nobody is known. */
  actorName: string | null;
  workspaceName: string;
  appUrl: string;
}

const withTitle = (p: { fullName: string; jobTitle: string | null }) => (p.jobTitle ? `${p.fullName} (${p.jobTitle})` : p.fullName);

/**
 * "New manager" (to the employee) and "New direct report" (to the new manager), spec 10.2: sent
 * when someone else changes a reporting line in the app. Directory facts only (names and job
 * titles), never personal details. Turned off by "Org changes" in the notification settings. Pure,
 * so it is unit-tested; the people worker loads the names and sends it (people-jobs.ts).
 */
export function reportingLineEmail(input: ReportingLineEmailInput): MailMessage {
  const base = input.appUrl.replace(/\/+$/, '');
  const who = input.actorName ?? 'An administrator';
  const toEmployee = input.recipient === 'employee';
  const reader = toEmployee ? input.employee : input.manager;
  const subject = toEmployee ? `Your new manager in ${input.workspaceName}: ${input.manager.fullName}` : `New direct report in ${input.workspaceName}: ${input.employee.fullName}`;
  const greeting = `Hi ${reader.fullName.split(' ')[0]},`;
  const intro = toEmployee
    ? `${who} changed who you report to in ${input.workspaceName}. Your manager is now ${withTitle(input.manager)}.`
    : `${who} made ${withTitle(input.employee)} your direct report in ${input.workspaceName}.`;
  const link = `${base}/people/${toEmployee ? input.manager.id : input.employee.id}`;
  const action = toEmployee ? `Open ${input.manager.fullName}'s card` : `Open ${input.employee.fullName}'s card`;
  const footer = `You get this email because "Org changes" is on in your notification settings for ${input.workspaceName}.`;
  const text = [greeting, '', intro, '', `${action}: ${link}`, '', footer].join('\n');
  const html = layoutHtml(
    [`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`, `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`, buttonHtml(action, link)].join('\n'),
    footer,
    input.appUrl,
  );
  return { to: input.to, subject, text, html };
}
