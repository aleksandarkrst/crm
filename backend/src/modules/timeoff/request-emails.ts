import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';

/**
 * The request emails of milestone 16 (spec 15.2), pure and unit-tested
 * (test/timeoff-request-emails.spec.ts): approved and rejected (to the employee), withdrawn (to an
 * approver), cancelled or shortened (to the employee and the approvers), the approver's daily
 * "Request waiting" summary and the Admins' "Manager absent" notice.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const link = (appUrl: string, path: string) => `${appUrl.replace(/\/+$/, '')}${path}`;
const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const periodLabel = (startDate: string, endDate: string) => (startDate === endDate ? dateLabel(startDate) : `${dateLabel(startDate)} to ${dateLabel(endDate)}`);
const first = (name: string) => name.split(' ')[0];

const mail = (to: string, subject: string, greeting: string, paragraphs: string[], rows: string[], button: { label: string; url: string }, footer: string, appUrl: string): MailMessage => {
  const text = [greeting, '', ...paragraphs.flatMap((p) => [p, '']), ...(rows.length ? [...rows.map((r) => `- ${r}`), ''] : []), `${button.label}: ${button.url}`, '', footer].join('\n');
  const html = layoutHtml(
    [`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`, ...paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`), ...(rows.length ? [`<ul style="margin:0 0 12px;padding-left:20px">${rows.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`] : []), buttonHtml(button.label, button.url)].join('\n'),
    footer,
    appUrl,
  );
  return { to, subject, text, html };
};

export interface DecidedEmailInput {
  to: string;
  employeeName: string;
  deciderName: string;
  workspaceName: string;
  appUrl: string;
  decision: 'approved' | 'rejected';
  what: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  comment: string | null;
  /** Vacation: days left after approval. */
  remaining: number | null;
}

/** "Time off approved" / "Time off rejected (with comment)" to the employee (spec 15.2). Can't be turned off. */
export function decidedEmail(i: DecidedEmailInput): MailMessage {
  const period = periodLabel(i.startDate, i.endDate);
  const subject = `Time off ${i.decision}: ${period} (${plural(i.workingDays, 'working day')})`;
  const intro = i.decision === 'approved' ? `${i.deciderName} approved your ${i.what} in ${i.workspaceName}: ${period}, ${plural(i.workingDays, 'working day')}.` : `${i.deciderName} rejected your ${i.what} in ${i.workspaceName}: ${period}, ${plural(i.workingDays, 'working day')}. The days are back in your balance.`;
  const rows = [...(i.comment ? [`Comment: ${i.comment}`] : []), ...(i.decision === 'approved' && i.remaining !== null ? [`Vacation days left: ${i.remaining}`] : [])];
  return mail(i.to, subject, `Hi ${first(i.employeeName)},`, [intro], rows, { label: 'Open My time off', url: link(i.appUrl, '/timeoff') }, 'You get this email about every decision on your time off. It cannot be turned off.', i.appUrl);
}

export interface WithdrawnEmailInput {
  to: string;
  approverName: string;
  employeeName: string;
  workspaceName: string;
  appUrl: string;
  what: string;
  startDate: string;
  endDate: string;
}

/** "Request withdrawn" to an approver who had been notified (spec 9.4, 15.2; toggle "Approval reminders"). */
export function withdrawnEmail(i: WithdrawnEmailInput): MailMessage {
  const period = periodLabel(i.startDate, i.endDate);
  return mail(i.to, `Request withdrawn: ${i.employeeName}, ${period}`, `Hi ${first(i.approverName)},`, [`${i.employeeName} withdrew the ${i.what} request for ${period} in ${i.workspaceName}. Nothing to decide any more.`], [], { label: 'Open Approvals', url: link(i.appUrl, '/timeoff?tab=approvals') }, APPROVER_FOOTER, i.appUrl);
}

const APPROVER_FOOTER = 'You get this email because of the "Approval reminders" setting in your profile. Turn it off there if you don\'t want it.';

export interface ChangedEmailInput {
  to: string;
  recipientName: string;
  /** The recipient is the employee themselves. */
  self: boolean;
  employeeName: string;
  actorName: string;
  workspaceName: string;
  appUrl: string;
  change: 'cancelled' | 'shortened';
  what: string;
  startDate: string;
  endDate: string;
  /** Shortened: the new last day. */
  newEndDate: string | null;
  returnedDays: number;
  comment: string | null;
}

/** "Approved time off cancelled or shortened" (spec 15.2): to the employee and the approvers, the actor left out. Can't be turned off. */
export function changedEmail(i: ChangedEmailInput): MailMessage {
  const whose = i.self ? 'your' : `${i.employeeName}'s`;
  const period = periodLabel(i.startDate, i.endDate);
  const subject = i.change === 'cancelled' ? `Time off cancelled: ${i.self ? period : `${i.employeeName}, ${period}`}` : `Time off shortened: ${i.self ? period : `${i.employeeName}, ${period}`}`;
  const intro = i.change === 'cancelled' ? `${i.actorName} cancelled ${whose} ${i.what} for ${period} in ${i.workspaceName}. ${plural(i.returnedDays, 'working day')} went back to the balance.` : `${i.actorName} shortened ${whose} ${i.what} in ${i.workspaceName}: it now ends on ${dateLabel(i.newEndDate ?? i.endDate)} instead of ${dateLabel(i.endDate)}. ${plural(i.returnedDays, 'working day')} went back to the balance.`;
  return mail(i.to, subject, `Hi ${first(i.recipientName)},`, [intro], i.comment ? [`Comment: ${i.comment}`] : [], { label: 'Open Time off', url: link(i.appUrl, '/timeoff') }, 'You get this email about every change to approved time off you are part of. It cannot be turned off.', i.appUrl);
}

export interface WaitingRequest {
  employeeName: string;
  what: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  submittedAt: string;
}

/** The approver's daily "Request waiting" summary (spec 15.2): at most once a day, one email. */
export function approvalReminderEmail(i: { to: string; approverName: string; workspaceName: string; appUrl: string; requests: WaitingRequest[] }): MailMessage {
  const rows = i.requests.map((r) => `${r.employeeName}: ${r.what}, ${periodLabel(r.startDate, r.endDate)} (${plural(r.workingDays, 'working day')}), submitted ${dateLabel(r.submittedAt.slice(0, 10))}`);
  return mail(i.to, `${plural(i.requests.length, 'time off request')} waiting for you`, `Hi ${first(i.approverName)},`, [`These requests in ${i.workspaceName} are waiting for your decision (pending for two working days, or starting within three):`], rows, { label: 'Open Approvals', url: link(i.appUrl, '/timeoff?tab=approvals') }, APPROVER_FOOTER, i.appUrl);
}

/** "Manager absent, requests waiting" to the Admins (spec 9.1, 15.2). Can't be turned off. */
export function managerAbsentEmail(i: { to: string; adminName: string; workspaceName: string; appUrl: string; requests: (WaitingRequest & { managerName: string })[] }): MailMessage {
  const rows = i.requests.map((r) => `${r.employeeName}: ${r.what}, ${periodLabel(r.startDate, r.endDate)} (${plural(r.workingDays, 'working day')}); their manager ${r.managerName} is away`);
  return mail(i.to, `${plural(i.requests.length, 'time off request')} waiting while the manager is away`, `Hi ${first(i.adminName)},`, [`In ${i.workspaceName}, these requests go to the Admins while the manager is absent:`], rows, { label: 'Open Approvals', url: link(i.appUrl, '/timeoff?tab=approvals') }, 'You get this email as an Admin whenever a request waits while its manager is away. It cannot be turned off.', i.appUrl);
}
