import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';
import { periodLabel } from './request-emails';

/**
 * The sick leave emails of CD-169 (spec 15.2), pure and unit-tested (test/sick-leave-emails.spec.ts).
 * None of them names the type of sick leave: managers don't see it (spec 13.6).
 */

const link = (appUrl: string, path: string) => `${appUrl.replace(/\/+$/, '')}${path}`;
const first = (name: string) => name.split(' ')[0];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const period = (start: string, end: string | null) => (end ? periodLabel(start, end) : `${periodLabel(start, start)}, until return`);
const TOGGLE = 'You get this email because of the "Sick leave notices" setting in your profile. Turn it off there if you don\'t want it.';

const mail = (to: string, subject: string, greeting: string, paragraphs: string[], button: { label: string; url: string }, footer: string, appUrl: string): MailMessage => {
  const text = [greeting, '', ...paragraphs.flatMap((p) => [p, '']), `${button.label}: ${button.url}`, '', footer].join('\n');
  const html = layoutHtml([`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`, ...paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`), buttonHtml(button.label, button.url)].join('\n'), footer, appUrl);
  return { to, subject, text, html };
};

interface Base {
  to: string;
  recipientName: string;
  workspaceName: string;
  appUrl: string;
}

/** "Sick leave reported" to the manager and the Admins. */
export function sickReportedEmail(i: Base & { employeeName: string; reporterName: string; startDate: string; endDate: string | null; admin: boolean }): MailMessage {
  const by = i.reporterName === i.employeeName ? `${i.employeeName} reported sick leave` : `${i.reporterName} reported sick leave for ${i.employeeName}`;
  return mail(
    i.to,
    `Sick leave reported: ${i.employeeName}, ${period(i.startDate, i.endDate)}`,
    `Hi ${first(i.recipientName)},`,
    [`${by} in ${i.workspaceName}: ${period(i.startDate, i.endDate)}.`, ...(i.admin ? ['Confirm it with its type once the sick note arrives.'] : [])],
    { label: 'Open Sick leave', url: link(i.appUrl, '/timeoff?tab=sick') },
    TOGGLE,
    i.appUrl,
  );
}

/** "Sick leave ended" to the manager: the end date was set. */
export function sickEndedEmail(i: Base & { employeeName: string; startDate: string; endDate: string; returnDate: string }): MailMessage {
  return mail(
    i.to,
    `Sick leave ended: ${i.employeeName}, back on ${periodLabel(i.returnDate, i.returnDate)}`,
    `Hi ${first(i.recipientName)},`,
    [`${i.employeeName}'s sick leave in ${i.workspaceName} ends on ${periodLabel(i.endDate, i.endDate)} (from ${periodLabel(i.startDate, i.startDate)}). They are back on ${periodLabel(i.returnDate, i.returnDate)}.`],
    { label: 'Open Sick leave', url: link(i.appUrl, '/timeoff?tab=sick') },
    TOGGLE,
    i.appUrl,
  );
}

/** "Time off interrupted by sick leave" to the employee, the approvers and the Admins (spec 13.4, A9). Can't be turned off. */
export function interruptedEmail(i: Base & { self: boolean; employeeName: string; what: string; dates: string[]; vacation: boolean }): MailMessage {
  const days = plural(i.dates.length, 'day');
  const list = i.dates.map((d) => periodLabel(d, d)).join(', ');
  const back = i.vacation ? ' The days are back in the vacation balance.' : '';
  const intro = i.self ? `Sick leave interrupted your ${i.what} in ${i.workspaceName}: ${days} (${list}).${back} Request them again for later dates.` : `Sick leave interrupted ${i.employeeName}'s ${i.what} in ${i.workspaceName}: ${days} (${list}).${back} The leave stays approved with fewer days.`;
  return mail(i.to, `Time off interrupted by sick leave: ${i.employeeName}, ${days}`, `Hi ${first(i.recipientName)},`, [intro], { label: 'Open Time off', url: link(i.appUrl, '/timeoff') }, 'You get this email whenever sick leave interrupts approved time off. It cannot be turned off.', i.appUrl);
}

/** Monday's "Weekly sick leave check" to the Admins: records still Reported or open for long. */
export function weeklyCheckEmail(i: Base & { records: { employeeName: string; startDate: string; endDate: string | null; status: string; stale: boolean }[] }): MailMessage {
  const lines = i.records.map((r) => `${r.employeeName}: ${period(r.startDate, r.endDate)}, ${r.status === 'reported' ? 'not confirmed yet' : 'still open: check the end date'}`);
  return mail(
    i.to,
    `Sick leave to check: ${plural(i.records.length, 'record')}`,
    `Hi ${first(i.recipientName)},`,
    [`In ${i.workspaceName}, these sick leave records need a look:`, ...lines],
    { label: 'Open Sick leave', url: link(i.appUrl, '/timeoff?tab=sick') },
    TOGGLE,
    i.appUrl,
  );
}
