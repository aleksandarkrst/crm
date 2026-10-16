import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';
import type { AdjustmentKind } from '../../shared/database/schema';

/**
 * The balance emails of milestone 16 (spec 15.2), pure and unit-tested (test/timeoff-balance-emails.spec.ts):
 * "Balance adjusted" (to the employee when someone else adjusts their balance) and "Carry-over
 * expiring" (1 May and 1 June to everyone with unused carry-over). Both can be turned off with the
 * profile toggle "Time off balance"; employees without an account get them at their work email.
 */

export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = { correction: 'Correction', opening_balance: 'Opening balance', extra_days: 'Extra days granted' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${Math.abs(n) === 1 ? one : many}`;
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const link = (appUrl: string, path: string) => `${appUrl.replace(/\/+$/, '')}${path}`;
const FOOTER = 'You get this email because of the "Time off balance" setting in your profile. Turn it off there if you don\'t want it.';

export interface BalanceAdjustedEmailInput {
  to: string;
  employeeName: string;
  /** Who adjusted it (null: the system). */
  actorName: string | null;
  workspaceName: string;
  appUrl: string;
  poolYear: number;
  days: number;
  kind: AdjustmentKind;
  reason: string;
  /** The year's figures after the change. */
  remaining: number;
  available: number;
}

export function balanceAdjustedEmail(input: BalanceAdjustedEmailInput): MailMessage {
  const who = input.actorName ?? 'Pultly';
  const subject = `Your vacation balance for ${input.poolYear} was adjusted: ${signed(input.days)} ${Math.abs(input.days) === 1 ? 'day' : 'days'}`;
  const greeting = `Hi ${input.employeeName.split(' ')[0]},`;
  const intro = `${who} adjusted your vacation balance in ${input.workspaceName}.`;
  const rows = [`${ADJUSTMENT_LABEL[input.kind]}: ${signed(input.days)} ${Math.abs(input.days) === 1 ? 'day' : 'days'} on the ${input.poolYear} pool`, `Reason: ${input.reason}`, `Remaining now: ${plural(input.remaining, 'day')} (${plural(input.available, 'day')} available to request)`];
  const url = link(input.appUrl, '/timeoff');
  const text = [greeting, '', intro, '', ...rows.map((r) => `- ${r}`), '', `Open My time off: ${url}`, '', FOOTER].join('\n');
  const html = layoutHtml(
    [`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`, `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`, `<ul style="margin:0 0 12px;padding-left:20px">${rows.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`, buttonHtml('Open My time off', url)].join('\n'),
    FOOTER,
    input.appUrl,
  );
  return { to: input.to, subject, text, html };
}

export interface CarryOverExpiringEmailInput {
  to: string;
  employeeName: string;
  workspaceName: string;
  appUrl: string;
  year: number;
  /** Carry-over days still unused. */
  expiring: number;
}

export interface RequestedEmailInput {
  to: string;
  approverName: string;
  employeeName: string;
  workspaceName: string;
  appUrl: string;
  /** "vacation", "paid leave (Marriage)", "unpaid leave". */
  what: string;
  startDate: string;
  endDate: string;
  workingDays: number;
  note: string | null;
  /** Vacation: the balance after approval, from the preview. */
  balanceAfter: number | null;
  requestId: string;
}

const dateLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Time off requested" (spec 15.2): to each approver when a request is submitted. Can't be turned off. */
export function requestedEmail(input: RequestedEmailInput): MailMessage {
  const period = input.startDate === input.endDate ? dateLabel(input.startDate) : `${dateLabel(input.startDate)} to ${dateLabel(input.endDate)}`;
  const subject = `Time off requested: ${input.employeeName}, ${period} (${plural(input.workingDays, 'working day')})`;
  const greeting = `Hi ${input.approverName.split(' ')[0]},`;
  const intro = `${input.employeeName} requested ${input.what} in ${input.workspaceName}: ${period}, ${plural(input.workingDays, 'working day')}.`;
  const rows = [...(input.note ? [`Note: ${input.note}`] : []), ...(input.balanceAfter !== null ? [`Vacation days left after approval: ${input.balanceAfter}`] : [])];
  const url = link(input.appUrl, `/timeoff?tab=requests&request=${input.requestId}`);
  const footer = 'You get this email because you approve this person\'s time off. It cannot be turned off.';
  const text = [greeting, '', intro, ...(rows.length ? ['', ...rows.map((r) => `- ${r}`)] : []), '', `Open the request: ${url}`, '', footer].join('\n');
  const html = layoutHtml(
    [`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`, `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`, ...(rows.length ? [`<ul style="margin:0 0 12px;padding-left:20px">${rows.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`] : []), buttonHtml('Open the request', url)].join('\n'),
    footer,
    input.appUrl,
  );
  return { to: input.to, subject, text, html };
}

/** "Carry-over expiring" (spec 15.2): on 1 May and 1 June, to employees with unused carry-over. */
export function carryOverExpiringEmail(input: CarryOverExpiringEmailInput): MailMessage {
  const subject = `${plural(input.expiring, 'vacation day')} from ${input.year - 1} expire on 30 June`;
  const greeting = `Hi ${input.employeeName.split(' ')[0]},`;
  const intro = `You still have ${plural(input.expiring, 'day')} carried over from ${input.year - 1} in ${input.workspaceName}. They can be used until 30 June ${input.year}; after that they expire.`;
  const hint = 'Request the days now if you want to use them.';
  const url = link(input.appUrl, '/timeoff');
  const text = [greeting, '', intro, '', hint, '', `Open My time off: ${url}`, '', FOOTER].join('\n');
  const html = layoutHtml([`<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`, `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`, `<p style="margin:0 0 12px">${escapeHtml(hint)}</p>`, buttonHtml('Open My time off', url)].join('\n'), FOOTER, input.appUrl);
  return { to: input.to, subject, text, html };
}
