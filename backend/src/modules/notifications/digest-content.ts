import { buttonHtml, escapeHtml, layoutHtml } from '../../infrastructure/mail/html';
import type { MailMessage } from '../../infrastructure/mail/mailer';

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

export interface Digest {
  date: string;
  overdue: DigestTaskRow[];
  dueToday: DigestTaskRow[];
  noNextStep: DigestDealRow[];
}

/**
 * Sorts a member's open tasks (due today or earlier) into overdue and due today, and lists their
 * open deals without a next step, as the Today screen and the Pipeline flags do.
 */
export function buildDigest(today: string, tasks: DigestTaskRow[], dealsWithoutNextStep: DigestDealRow[]): Digest {
  const byDue = (a: DigestTaskRow, b: DigestTaskRow) => a.dueDate.localeCompare(b.dueDate) || a.dealTitle.localeCompare(b.dealTitle) || a.title.localeCompare(b.title);
  return {
    date: today,
    overdue: tasks.filter((t) => t.dueDate < today).sort(byDue),
    dueToday: tasks.filter((t) => t.dueDate === today).sort(byDue),
    noNextStep: [...dealsWithoutNextStep].sort((a, b) => a.title.localeCompare(b.title)),
  };
}

export const digestItemCount = (d: Digest): number => d.overdue.length + d.dueToday.length + d.noNextStep.length;
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

/** The digest email: a short summary line, then up to three sections with links to the deals. */
export function digestEmail({ to, memberName, workspaceName, appUrl, digest }: DigestEmailInput): MailMessage {
  const base = appUrl.replace(/\/+$/, '');
  const dealUrl = (id: string) => `${base}/deals/${id}`;
  const counts = [
    digest.overdue.length ? `${digest.overdue.length} overdue` : null,
    digest.dueToday.length ? `${digest.dueToday.length} due today` : null,
    digest.noNextStep.length ? plural(digest.noNextStep.length, 'deal') + ' without a next step' : null,
  ].filter(Boolean);
  const subject = `Your day in ${workspaceName}: ${counts.join(', ')}`;

  interface Line {
    text: string;
    href: string;
  }
  const sections: { title: string; lines: Line[] }[] = [
    { title: 'Overdue tasks', lines: digest.overdue.map((t) => ({ text: `${t.title} (was due ${shortDay(t.dueDate)}) · ${onDeal(t.dealTitle, t.company)}`, href: dealUrl(t.dealId) })) },
    { title: 'Due today', lines: digest.dueToday.map((t) => ({ text: `${t.title} · ${onDeal(t.dealTitle, t.company)}`, href: dealUrl(t.dealId) })) },
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
