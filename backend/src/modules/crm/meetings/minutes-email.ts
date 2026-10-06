import { escapeHtml } from '../../../infrastructure/mail/html';
import { fromHeader, type MailMessage } from '../../../infrastructure/mail/mailer';
import type { CustomerEmailLanguage, ExternalPrefill } from '../../../shared/database/schema';
import { formatTimeRange, zonedParts } from '../../../shared/time/zoned-time';

/**
 * The external minutes (CD-133) as pure functions, so they are unit-tested:
 * - `minutesEmail`: the email to the customer. It takes the external text (subject and body) and
 *   facts about the sender and the workspace, and nothing else: the internal minutes can't reach
 *   it (spec 6.2, AC 7.3.4). Its fixed text (the "chrome") is in the workspace's customer email
 *   language (CD-208); the minutes are whatever the user wrote.
 * - `minutesTemplate`: the text the external minutes start from (spec 7.1) and "Copy from internal
 *   minutes": the meeting's facts, the agreements and the next steps without their owners.
 * - `renderMinutesHtml` / `renderMinutesText`: the formatting subset (milestone 12 decision 8):
 *   `**bold**`, lines starting with "- " or "* " as bullets, `[label](https://…)` and bare http(s)
 *   links. Every piece of text is escaped; only these become markup.
 */

export interface MinutesPerson {
  name: string;
  email: string;
}

export interface MinutesEmailInput {
  language: CustomerEmailLanguage;
  /** The external minutes, as the user wrote them. */
  subject: string;
  body: string;
  workspaceName: string;
  /** The member sending them: their name is the From name, their address the Reply-To. */
  sender: MinutesPerson;
  /** MAIL_FROM: its address is the From address (the platform's). */
  mailFrom: string;
  to: MinutesPerson[];
  cc: MinutesPerson[];
}

/** The email exactly as it goes out (the preview shows this). */
export interface MinutesEmail {
  from: string;
  replyTo: string;
  to: MinutesPerson[];
  cc: MinutesPerson[];
  subject: string;
  text: string;
  html: string;
}

interface Chrome {
  heading: string;
  sentBy: (sender: string, workspace: string) => string;
  reply: (sender: string, email: string) => string;
  footer: (workspace: string) => string;
}

/** The fixed text of the email, per customer email language. */
export const CHROME: Record<CustomerEmailLanguage, Chrome> = {
  en: {
    heading: 'Meeting minutes',
    sentBy: (sender, workspace) => `Sent by ${sender}, ${workspace}.`,
    reply: (sender, email) => `Reply to this email to reach ${sender} directly (${email}).`,
    footer: (workspace) => `${workspace} sent you these minutes with Pultly.`,
  },
  sr: {
    heading: 'Zapisnik sa sastanka',
    sentBy: (sender, workspace) => `Poslao/la: ${sender}, ${workspace}.`,
    reply: (_sender, email) => `Odgovorite na ovu poruku da biste direktno kontaktirali pošiljaoca (${email}).`,
    footer: (workspace) => `Ovaj zapisnik vam je poslala kompanija ${workspace} putem aplikacije Pultly.`,
  },
};

const LINK = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g;
const BULLET = /^\s*[-*]\s+(.*)$/;

/** Bold and links inside a line: each piece escaped, then wrapped. */
function inlineHtml(line: string): string {
  let out = '';
  let last = 0;
  for (const m of line.matchAll(LINK)) {
    out += escapeHtml(line.slice(last, m.index));
    if (m[1] !== undefined) out += `<strong>${escapeHtml(m[1])}</strong>`;
    else if (m[2] !== undefined) out += `<a href="${escapeHtml(m[3]!)}" style="color:#14503C">${escapeHtml(m[2])}</a>`;
    else out += `<a href="${escapeHtml(m[4]!)}" style="color:#14503C">${escapeHtml(m[4]!)}</a>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(line.slice(last));
}

/** Paragraphs (lines kept with <br>) and bullet lists, as the app's RichText shows them. */
export function renderMinutesHtml(text: string): string {
  const blocks: string[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(`<p style="margin:0 0 12px">${para.map(inlineHtml).join('<br>')}</p>`);
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length) blocks.push(`<ul style="margin:0 0 12px;padding-left:22px">${bullets.map((b) => `<li>${inlineHtml(b)}</li>`).join('')}</ul>`);
    bullets = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushPara();
      bullets.push(bullet[1]!);
    } else if (!line.trim()) {
      flushPara();
      flushBullets();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return blocks.join('\n');
}

/** The plain-text version: bold markers dropped, links as "label (address)", bullets as "• ". */
export function renderMinutesText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const bullet = BULLET.exec(line);
      const inner = (bullet ? bullet[1]! : line).replace(LINK, (whole, b?: string, label?: string, url?: string) => (b !== undefined ? b : label !== undefined ? `${label} (${url})` : whole));
      return bullet ? `• ${inner}` : inner;
    })
    .join('\n')
    .trim();
}

/** The email to the customer. Only the external text and these facts go in. */
export function minutesEmail(input: MinutesEmailInput): MinutesEmail {
  const chrome = CHROME[input.language] ?? CHROME.en;
  const { workspaceName, sender } = input;
  const sentBy = chrome.sentBy(sender.name, workspaceName);
  const reply = chrome.reply(sender.name, sender.email);
  const footer = chrome.footer(workspaceName);
  const subject = input.subject.replace(/[\r\n]+/g, ' ').trim();

  const text = [chrome.heading, '', renderMinutesText(input.body), '', '--', sentBy, reply, '', footer].join('\n');
  const html = [
    '<!doctype html>',
    `<html><body style="margin:0;padding:24px;background:#F5F7F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F1B16;font-size:14px;line-height:1.55">`,
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E2E8E4;border-radius:10px;padding:28px">',
    `<p style="margin:0 0 4px;color:#6B7B73;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase">${escapeHtml(workspaceName)}</p>`,
    `<h1 style="margin:0 0 20px;font-size:18px;font-weight:600">${escapeHtml(chrome.heading)}</h1>`,
    renderMinutesHtml(input.body),
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #E2E8E4;color:#475750">${escapeHtml(sentBy)}<br>${escapeHtml(reply)}</p>`,
    `<p style="margin:20px 0 0;color:#6B7B73;font-size:12px">${escapeHtml(footer)}</p>`,
    '</div></body></html>',
  ].join('\n');

  return {
    from: fromHeader({ fromName: sender.name }, input.mailFrom),
    replyTo: sender.email,
    to: input.to,
    cc: input.cc,
    subject,
    text,
    html,
  };
}

/** What the mailer sends for it: the To and Cc addresses, the sender's name and reply address. */
export function minutesMailMessage(email: MinutesEmail, sender: MinutesPerson): MailMessage {
  return {
    to: email.to.map((p) => p.email),
    cc: email.cc.map((p) => p.email),
    replyTo: email.replyTo,
    fromName: sender.name,
    subject: email.subject,
    text: email.text,
    html: email.html,
  };
}

// ---------------------------------------------------------------- the template (spec 7.1)

interface TemplateWords {
  subject: (title: string, date: string) => string;
  date: string;
  location: string;
  participants: string;
  agreements: string;
  nextSteps: string;
  due: (date: string) => string;
}

const WORDS: Record<CustomerEmailLanguage, TemplateWords> = {
  en: {
    subject: (title, date) => `Minutes: ${title}, ${date}`,
    date: 'Date',
    location: 'Location',
    participants: 'Participants',
    agreements: 'Agreements',
    nextSteps: 'Next steps',
    due: (date) => `by ${date}`,
  },
  sr: {
    subject: (title, date) => `Zapisnik: ${title}, ${date}`,
    date: 'Datum',
    location: 'Mesto',
    participants: 'Učesnici',
    agreements: 'Dogovori',
    nextSteps: 'Sledeći koraci',
    due: (date) => `rok ${date}`,
  },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A calendar date (yyyy-mm-dd): "6 Oct 2026", or "6. 10. 2026." in Serbian. */
export function dayLabel(date: string, language: CustomerEmailLanguage): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return language === 'sr' ? `${d}. ${m}. ${y}.` : `${d} ${MONTHS[m - 1]} ${y}`;
}

/** When the meeting was, in the workspace's time zone: the app's English format, or "6. 10. 2026. 10:00–11:00". */
export function meetingWhen(start: Date, end: Date, timeZone: string, language: CustomerEmailLanguage): string {
  if (language === 'en') return formatTimeRange(start, end, timeZone);
  const s = zonedParts(start, timeZone);
  const e = zonedParts(end, timeZone);
  if (s.date === e.date) return `${dayLabel(s.date, 'sr')} ${s.time}–${e.time}`;
  return `${dayLabel(s.date, 'sr')} ${s.time} – ${dayLabel(e.date, 'sr')} ${e.time}`;
}

export interface MinutesTemplateInput {
  language: CustomerEmailLanguage;
  timeZone: string;
  workspaceName: string;
  meeting: { title: string; startsAt: Date; endsAt: Date; location: string | null; companyName: string };
  /** Names of the people on each side. */
  internalNames: string[];
  externalNames: string[];
  agreements: string;
  /** The next steps' text and due date: the owners are internal and never part of the template. */
  nextSteps: { text: string; dueDate: string | null }[];
}

/** The default subject and body of the external minutes. */
export function minutesTemplate(input: MinutesTemplateInput): { subject: string; body: string } {
  const w = WORDS[input.language] ?? WORDS.en;
  const m = input.meeting;
  const date = dayLabel(zonedParts(m.startsAt, input.timeZone).date, input.language);
  const lines = [`**${m.title}**`, `${w.date}: ${meetingWhen(m.startsAt, m.endsAt, input.timeZone, input.language)}`];
  if (m.location?.trim()) lines.push(`${w.location}: ${m.location.trim()}`);
  const sides = [
    input.internalNames.length ? `- ${input.workspaceName}: ${input.internalNames.join(', ')}` : null,
    input.externalNames.length ? `- ${m.companyName}: ${input.externalNames.join(', ')}` : null,
  ].filter((s): s is string => !!s);
  if (sides.length) lines.push(`${w.participants}:`, ...sides);
  const agreements = input.agreements.trim();
  if (agreements) lines.push('', `**${w.agreements}**`, agreements);
  const steps = input.nextSteps.filter((s) => s.text.trim());
  if (steps.length) {
    lines.push('', `**${w.nextSteps}**`);
    for (const s of steps) lines.push(`- ${s.text.trim()}${s.dueDate ? ` (${w.due(dayLabel(s.dueDate, input.language))})` : ''}`);
  }
  return { subject: w.subject(m.title, date), body: lines.join('\n') };
}

/**
 * External minutes filled from the template, against the template as the meeting is now (CD-222):
 * - 'current': the meeting's time, place and people are what the text was made from;
 * - 'refill': the meeting changed and nobody changed the text since: fill it in again;
 * - 'stale': the meeting changed, but someone changed the text (or it was sent): keep it, and say so.
 * Text filled before the basis was kept (`basis` null) is filled in again only while nobody changed
 * it (`untouched`) and nothing was sent; otherwise there is nothing to compare with.
 */
export function prefillCheck(
  text: { subject: string; body: string },
  basis: ExternalPrefill | null,
  now: ExternalPrefill,
  opts: { sent: boolean; untouched: boolean },
): 'current' | 'refill' | 'stale' {
  if (!basis) return opts.untouched && !opts.sent && (text.subject !== now.subject || text.body !== now.body) ? 'refill' : 'current';
  if (basis.headSubject === now.headSubject && basis.headBody === now.headBody) return 'current';
  return !opts.sent && text.subject === basis.subject && text.body === basis.body ? 'refill' : 'stale';
}

/**
 * "Update from meeting" (CD-222): the date, place and participants at the top of the text as the
 * meeting is now, keeping what was written below them. When those lines were changed (or the text
 * predates the basis), the whole text is the template again. A subject someone changed stays.
 */
export function updateFromMeeting(text: { subject: string; body: string }, basis: ExternalPrefill | null, now: ExternalPrefill): { subject: string; body: string } {
  const subject = basis && text.subject !== basis.subject ? text.subject : now.subject;
  const body = basis && text.body.startsWith(basis.headBody) ? now.headBody + text.body.slice(basis.headBody.length) : now.body;
  return { subject, body };
}
