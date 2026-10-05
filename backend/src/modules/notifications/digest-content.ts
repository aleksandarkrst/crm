import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';
import { zonedParts } from '../../shared/time/zoned-time';

/**
 * The daily digest (CD-16), as pure functions so they can be unit-tested: which items go in, and
 * the email. DigestService loads the rows; the worker decides when to send.
 */

/** The digest goes out from this hour (workspace time) until DIGEST_LAST_HOUR, once a day. */
export const DIGEST_HOUR = 8;
/** A worker that was down at 8:00 still catches up until 11:59, but doesn't send a "morning" email later. */
export const DIGEST_LAST_HOUR = 11;
/** Items per section; the rest is counted ("and 3 more"). */
export const DIGEST_SECTION_LIMIT = 20;

export interface DigestTaskRow {
  id: string;
  title: string;
  dueDate: string; // yyyy-mm-dd
  dealId: string;
  dealTitle: string;
  company: string | null;
}

export interface DigestDealRow {
  id: string;
  title: string;
  company: string | null;
  stage: string;
}

/** A meeting (CD-130) the member organizes or takes part in. Times are ISO instants. */
export interface DigestMeetingRow {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  company: string;
  status: 'planned' | 'held' | 'cancelled';
}

export interface Digest {
  date: string;
  /** The workspace time zone the dates and meeting times are in. */
  timeZone: string;
  meetingsToday: DigestMeetingRow[];
  overdue: DigestTaskRow[];
  dueToday: DigestTaskRow[];
  /** Meetings they organize that are still planned more than 24 hours after their end. */
  notClosed: DigestMeetingRow[];
  /** Meetings they organize, held in the last 7 days, whose internal minutes have no summary yet (CD-132). */
  minutesMissing: DigestMeetingRow[];
  noNextStep: DigestDealRow[];
}

/** A planned meeting is "Not closed" this long after its end (as in the CRM's meeting rules). */
export const NOT_CLOSED_AFTER_MS = 24 * 60 * 60 * 1000;
/** A held meeting without a summary is listed as "Minutes missing" for this long after its start (spec 6.2). */
export const MINUTES_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

export interface DigestMeetings {
  /** Meetings starting today or so; only the planned and held ones starting today count. */
  today?: DigestMeetingRow[];
  /** Candidates for "Not closed"; only planned ones that ended over 24 hours before `now` count. */
  notClosed?: DigestMeetingRow[];
  /** Candidates for "Minutes missing" (held, no summary); only those that started in the 7 days before `now` count. */
  minutesMissing?: DigestMeetingRow[];
  timeZone?: string;
  now?: Date;
}

/**
 * Sorts a member's open tasks (due today or earlier) into overdue and due today, and lists their
 * open deals without a next step, as the Today screen and the Pipeline flags do. Meetings: the
 * ones starting today (workspace date), their planned meetings that were never closed, and their
 * held meetings of the last 7 days still without minutes.
 */
export function buildDigest(today: string, tasks: DigestTaskRow[], dealsWithoutNextStep: DigestDealRow[], meetings: DigestMeetings = {}): Digest {
  const timeZone = meetings.timeZone ?? 'UTC';
  const now = meetings.now ?? new Date();
  const byDue = (a: DigestTaskRow, b: DigestTaskRow) => a.dueDate.localeCompare(b.dueDate) || a.dealTitle.localeCompare(b.dealTitle) || a.title.localeCompare(b.title);
  const byStart = (a: DigestMeetingRow, b: DigestMeetingRow) => a.startsAt.localeCompare(b.startsAt) || a.title.localeCompare(b.title);
  return {
    date: today,
    timeZone,
    meetingsToday: (meetings.today ?? []).filter((m) => m.status !== 'cancelled' && zonedParts(new Date(m.startsAt), timeZone).date === today).sort(byStart),
    overdue: tasks.filter((t) => t.dueDate < today).sort(byDue),
    dueToday: tasks.filter((t) => t.dueDate === today).sort(byDue),
    notClosed: (meetings.notClosed ?? []).filter((m) => m.status === 'planned' && new Date(m.endsAt).getTime() < now.getTime() - NOT_CLOSED_AFTER_MS).sort(byStart),
    minutesMissing: (meetings.minutesMissing ?? [])
      .filter((m) => {
        const start = new Date(m.startsAt).getTime();
        return m.status === 'held' && start <= now.getTime() && start >= now.getTime() - MINUTES_REMINDER_MS;
      })
      .sort(byStart),
    noNextStep: [...dealsWithoutNextStep].sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export const digestItemCount = (d: Digest): number =>
  d.meetingsToday.length + d.overdue.length + d.dueToday.length + d.notClosed.length + d.minutesMissing.length + d.noNextStep.length;
export const isEmptyDigest = (d: Digest): boolean => digestItemCount(d) === 0;

/** The current date and time on the clock of an IANA time zone. */
export function zonedNow(timeZone: string, now: Date = new Date()): { date: string; hour: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    return zonedNow('UTC', now);
  }
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) % 24, minute: Number(part('minute')) };
}

/** Whether a workspace's morning digest window is open at this local hour. */
export const isDigestHour = (hour: number): boolean => hour >= DIGEST_HOUR && hour <= DIGEST_LAST_HOUR;

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dayLabel = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const shortDay = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const onDeal = (dealTitle: string, company: string | null) => (company ? `${dealTitle} · ${company}` : dealTitle);

export interface DigestEmailInput {
  to: string;
  memberName: string | null;
  workspaceName: string;
  appUrl: string;
  digest: Digest;
}

/** The digest email: a short summary line, then up to six sections with links to the deals and meetings. */
export function digestEmail({ to, memberName, workspaceName, appUrl, digest }: DigestEmailInput): MailMessage {
  const base = appUrl.replace(/\/+$/, '');
  const dealUrl = (id: string) => `${base}/deals/${id}`;
  const meetingUrl = (id: string) => `${base}/meetings/${id}`;
  const clock = (iso: string) => zonedParts(new Date(iso), digest.timeZone);
  const counts = [
    digest.meetingsToday.length ? plural(digest.meetingsToday.length, 'meeting') + ' today' : null,
    digest.overdue.length ? `${digest.overdue.length} overdue` : null,
    digest.dueToday.length ? `${digest.dueToday.length} due today` : null,
    digest.notClosed.length ? plural(digest.notClosed.length, 'meeting') + ' not closed' : null,
    digest.minutesMissing.length ? plural(digest.minutesMissing.length, 'meeting') + ' without minutes' : null,
    digest.noNextStep.length ? plural(digest.noNextStep.length, 'deal') + ' without a next step' : null,
  ].filter(Boolean);
  const subject = `Your day in ${workspaceName}: ${counts.join(', ')}`;

  interface Line {
    text: string;
    href: string;
  }
  const sections: { title: string; lines: Line[] }[] = [
    {
      title: 'Meetings today',
      lines: digest.meetingsToday.map((m) => {
        const start = clock(m.startsAt);
        const end = clock(m.endsAt);
        const time = end.date === start.date ? `${start.time}–${end.time}` : `from ${start.time}`;
        return { text: `${time} ${m.title} · ${m.company}${m.status === 'held' ? ' (held)' : ''}`, href: meetingUrl(m.id) };
      }),
    },
    { title: 'Overdue tasks', lines: digest.overdue.map((t) => ({ text: `${t.title} (was due ${shortDay(t.dueDate)}) · ${onDeal(t.dealTitle, t.company)}`, href: dealUrl(t.dealId) })) },
    { title: 'Due today', lines: digest.dueToday.map((t) => ({ text: `${t.title} · ${onDeal(t.dealTitle, t.company)}`, href: dealUrl(t.dealId) })) },
    {
      title: 'Not closed meetings',
      lines: digest.notClosed.map((m) => ({ text: `${m.title} · ${m.company} (${shortDay(clock(m.startsAt).date)})`, href: meetingUrl(m.id) })),
    },
    {
      title: 'Minutes missing',
      lines: digest.minutesMissing.map((m) => ({ text: `${m.title} · ${m.company} (held ${shortDay(clock(m.startsAt).date)})`, href: meetingUrl(m.id) })),
    },
    { title: 'Deals with no next step', lines: digest.noNextStep.map((d) => ({ text: `${onDeal(d.title, d.company)} · ${d.stage}`, href: dealUrl(d.id) })) },
  ].filter((s) => s.lines.length);

  const greeting = memberName ? `Good morning, ${memberName.split(' ')[0]}.` : 'Good morning.';
  const intro = `Here is what needs you in ${workspaceName} on ${dayLabel(digest.date)}.`;
  const footer = `You get this email because the daily digest is on for you in ${workspaceName}. Turn it off in Settings → Notifications (${base}/settings/notifications).`;

  const text: string[] = [greeting, '', intro];
  for (const s of sections) {
    text.push('', `${s.title} (${s.lines.length})`);
    for (const l of s.lines.slice(0, DIGEST_SECTION_LIMIT)) text.push(`- ${l.text}`, `  ${l.href}`);
    if (s.lines.length > DIGEST_SECTION_LIMIT) text.push(`- and ${s.lines.length - DIGEST_SECTION_LIMIT} more`);
  }
  text.push('', `Open Today: ${base}/today`, '', footer);

  const html: string[] = [`<p style="margin:0 0 6px;font-size:16px;font-weight:600">${escapeHtml(greeting)}</p>`, `<p style="margin:0 0 8px;color:#475750">${escapeHtml(intro)}</p>`];
  for (const s of sections) {
    html.push(`<h3 style="margin:22px 0 8px;font-size:14px">${escapeHtml(s.title)} <span style="color:#6B7B73;font-weight:400">(${s.lines.length})</span></h3>`);
    html.push('<ul style="margin:0;padding-left:18px">');
    for (const l of s.lines.slice(0, DIGEST_SECTION_LIMIT)) html.push(`<li style="margin:0 0 6px"><a href="${escapeHtml(l.href)}" style="color:#14503C">${escapeHtml(l.text)}</a></li>`);
    if (s.lines.length > DIGEST_SECTION_LIMIT) html.push(`<li style="margin:0 0 6px;color:#6B7B73">and ${s.lines.length - DIGEST_SECTION_LIMIT} more</li>`);
    html.push('</ul>');
  }
  html.push(buttonHtml('Open Today', `${base}/today`));

  return { to, subject, text: text.join('\n'), html: layoutHtml(html.join('\n'), footer, appUrl) };
}

export interface DealAssignedEmailInput {
  to: string;
  assigneeName: string | null;
  actorName: string;
  workspaceName: string;
  appUrl: string;
  deal: { id: string; title: string; company: string | null; stage: string; amount: string; currency: string; closeDate: string | null };
}

function moneyLabel(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

/** "X made you the owner of a deal". */
export function dealAssignedEmail({ to, assigneeName, actorName, workspaceName, appUrl, deal }: DealAssignedEmailInput): MailMessage {
  const link = `${appUrl.replace(/\/+$/, '')}/deals/${deal.id}`;
  const subject = `${actorName} assigned you ${deal.title}`;
  const facts = [
    deal.company ? `Company: ${deal.company}` : null,
    `Stage: ${deal.stage}`,
    Number(deal.amount) > 0 ? `Value: ${moneyLabel(deal.amount, deal.currency)}` : null,
    deal.closeDate ? `Expected close: ${shortDay(deal.closeDate)}` : null,
  ].filter((f): f is string => !!f);
  const greeting = assigneeName ? `Hi ${assigneeName.split(' ')[0]},` : 'Hi,';
  const intro = `${actorName} made you the owner of ${deal.title} in ${workspaceName}.`;
  const footer = `You get this email because "Deal assigned to you" is on in Settings → Notifications for ${workspaceName}.`;
  const text = [greeting, '', intro, '', ...facts, '', `Open the deal: ${link}`, '', footer].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`,
      `<p style="margin:0 0 12px;color:#475750">${facts.map(escapeHtml).join('<br>')}</p>`,
      buttonHtml('Open the deal', link),
    ].join('\n'),
    footer,
    appUrl,
  );
  return { to, subject, text, html };
}
