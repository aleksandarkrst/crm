import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';
import { formatMinutes, type TimesheetSettings } from './timesheet-rules';

/**
 * The timesheet emails (CD-154, design `Timesheet.dc.html#cd-154`) as pure functions, unit-tested
 * without a database: the reminder before the deadline, "late" and "submitted automatically" after
 * it, and the approver's summary of late people.
 */

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
/** "Fri 9 Oct". */
const dayLabel = (date: string) => `${DAY_SHORT[weekday(date)]} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
/** "Friday" for one day, "Wed, Thu, Fri" for several. */
export const missingText = (dates: string[]) => (dates.length === 1 ? DAY_LONG[weekday(dates[0]!)]! : dates.map((d) => DAY_SHORT[weekday(d)]).join(', '));
/** "31.5 h" or "31:30 h", without trailing zeros in decimal. */
const hours = (minutes: number, format: TimesheetSettings['timeFormat']) => `${format === 'decimal' ? String(Math.round((minutes / 60) * 100) / 100) : formatMinutes(minutes, 'clock')} h`;
/** "5 to 11 Oct" or "28 Sep to 4 Oct". */
const range = (monday: string) => {
  const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  const m = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];
  return m(monday) === m(sunday) ? `${Number(monday.slice(8))} to ${Number(sunday.slice(8))} ${m(sunday)}` : `${Number(monday.slice(8))} ${m(monday)} to ${Number(sunday.slice(8))} ${m(sunday)}`;
};

export interface WeekFacts {
  weekStart: string;
  weekNumber: number;
  deadline: { date: string; time: string };
  enteredMinutes: number;
  expectedMinutes: number;
  /** The days still without hours (and Rejected days, for the reminder); empty: only the submitting is left. */
  missing: string[];
}

interface Common {
  to: string;
  recipientName: string | null;
  workspaceName: string;
  appUrl: string;
  timeFormat: TimesheetSettings['timeFormat'];
}

const greeting = (name: string | null) => (name ? `Hi ${name.split(' ')[0]},` : 'Hi,');
const base = (appUrl: string) => appUrl.replace(/\/+$/, '');

/** A message with a greeting, paragraphs, a list of label · value lines and a button. */
function message(c: Common, subject: string, paragraphs: string[], lines: [string, string][], button: { label: string; href: string }, footer: string): MailMessage {
  const text = [greeting(c.recipientName), '', ...paragraphs.flatMap((p) => [p, '']), ...lines.map(([a, b]) => `${a}: ${b}`), '', `${button.label}: ${button.href}`, '', footer].join('\n');
  const list = lines.length
    ? `<table style="width:100%;border-collapse:collapse;background:#F5F7F6;border-radius:8px;margin:0 0 12px">${lines
        .map(([a, b]) => `<tr><td style="padding:6px 12px">${escapeHtml(a)}</td><td style="padding:6px 12px;text-align:right;font-weight:500">${escapeHtml(b)}</td></tr>`)
        .join('')}</table>`
    : '';
  const html = layoutHtml(
    [`<p style="margin:0 0 12px">${escapeHtml(greeting(c.recipientName))}</p>`, ...paragraphs.map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`), list, buttonHtml(button.label, button.href)].join('\n'),
    footer,
    c.appUrl,
  );
  return { to: c.to, subject, text, html };
}

const timesheetLink = (c: Common, w: WeekFacts) => ({ label: 'Open timesheet', href: `${base(c.appUrl)}/timesheet?week=${w.weekStart}` });
/** "Missing · Friday", or "Still to do · Submit the week" when every day has hours. */
const missingLine = (w: WeekFacts): [string, string] => (w.missing.length ? ['Missing', missingText(w.missing)] : ['Still to do', 'Submit the week']);
const entered = (c: Common, w: WeekFacts): [string, string] => ['Entered so far', `${hours(w.enteredMinutes, c.timeFormat).replace(' h', '')} of ${hours(w.expectedMinutes, c.timeFormat)}`];

/** "Reminder: submit your timesheet for week 41 by Fri 17:00" (spec 7.1). */
export function reminderEmail(c: Common, w: WeekFacts): MailMessage {
  const due = `${DAY_SHORT[weekday(w.deadline.date)]} ${w.deadline.time}`;
  return message(
    c,
    `Reminder: submit your timesheet for week ${w.weekNumber} by ${due}`,
    [`Your timesheet for week ${w.weekNumber} (${range(w.weekStart)}) is due ${dayLabel(w.deadline.date)} at ${w.deadline.time}.`],
    [entered(c, w), missingLine(w)],
    timesheetLink(c, w),
    `You get this reminder because ${c.workspaceName} sends one before each timesheet deadline (Settings → Workforce → Approvals).`,
  );
}

/** "Your timesheet for week 41 is late" (spec 7.2): submission is still possible, marked late. */
export function lateEmail(c: Common, w: WeekFacts): MailMessage {
  return message(
    c,
    `Your timesheet for week ${w.weekNumber} is late`,
    [`The deadline passed on ${dayLabel(w.deadline.date)} at ${w.deadline.time}. You can still submit, but the week will be marked as submitted late.`],
    [entered(c, w), missingLine(w)],
    timesheetLink(c, w),
    `You get this email because ${c.workspaceName} sends a notice when a timesheet deadline passes (Settings → Workforce → Approvals).`,
  );
}

/** "Your timesheet for week 41 was submitted automatically" (spec 7.2, auto submit on). */
export function autoSubmittedEmail(c: Common, w: WeekFacts): MailMessage {
  return message(
    c,
    `Your timesheet for week ${w.weekNumber} was submitted automatically`,
    [
      `The deadline passed on ${dayLabel(w.deadline.date)} at ${w.deadline.time}, so your timesheet for week ${w.weekNumber} (${range(w.weekStart)}) was submitted for you with the hours entered. It is marked as submitted late.`,
    ],
    [entered(c, w)],
    timesheetLink(c, w),
    `You get this email because ${c.workspaceName} submits timesheets automatically at the deadline (Settings → Workforce → Approvals).`,
  );
}

export interface LatePerson {
  name: string;
  enteredMinutes: number;
  autoSubmitted: boolean;
}

/** "Late timesheets for week 41" (spec 7.2): one per approver, their late people. */
export function lateSummaryEmail(c: Common, w: Pick<WeekFacts, 'weekStart' | 'weekNumber'>, people: LatePerson[]): MailMessage {
  return message(
    c,
    `Late timesheets for week ${w.weekNumber}`,
    [`${people.length === 1 ? 'This person' : 'These people'} you approve for missed the deadline for week ${w.weekNumber} (${range(w.weekStart)}).`],
    people.map((p) => [p.name, p.autoSubmitted ? 'auto-submitted (late)' : `not submitted · ${hours(p.enteredMinutes, c.timeFormat)}`]),
    { label: 'Open Workforce', href: `${base(c.appUrl)}/org` },
    `You get this email because you approve timesheets in ${c.workspaceName} and its after-deadline emails are on (Settings → Workforce → Approvals).`,
  );
}
