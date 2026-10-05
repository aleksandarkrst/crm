import { buttonHtml, escapeHtml, layoutHtml } from '../../../infrastructure/mail/html';
import type { MailAttachment, MailMessage } from '../../../infrastructure/mail/mailer';
import { zonedParts } from '../../../shared/time/zoned-time';

/**
 * The emails internal participants get about a meeting (CD-131, spec 5.1), with the .ics that puts
 * it in (or takes it out of) their own calendar, as pure functions so they are unit-tested:
 * - "added": someone else added them (also on create, to everyone but the creator);
 * - "updated": a planned meeting's time or place changed (or it was restored);
 * - "cancelled": it was cancelled; the .ics cancels the event.
 * Customers never get these (decision on CD-131); only the external minutes go to them.
 */

export type InviteKind = 'added' | 'updated' | 'cancelled';

/** One UID per meeting, so every update and the cancellation replace the same calendar event. */
export const meetingUid = (meetingId: string): string => `meeting-${meetingId}@pultly.com`;

export interface IcsEvent {
  uid: string;
  /** Raised with every update; calendars ignore anything older than what they have. */
  sequence: number;
  method: 'REQUEST' | 'CANCEL';
  start: Date;
  end: Date;
  /** When this version was made (DTSTAMP). */
  stamp: Date;
  summary: string;
  location: string | null;
  description: string;
  url: string;
  /** The meeting's organizer by name, with the platform's sending address (replies aren't read). */
  organizer: { name: string; email: string };
  /** The person the file is for. Outlook shows a meeting request only when they are on it. */
  attendee: { name: string | null; email: string };
}

/** UTC as iCalendar writes it: 20261006T080000Z. */
export function icsTime(at: Date): string {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** A TEXT value (RFC 5545 3.3.11): backslash, semicolon and comma escaped, line breaks as \n. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .split('')
    .filter((ch) => !isControl(ch) || ch === '\t')
    .join('');
}

const isControl = (ch: string) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f;

/** A parameter value such as CN: always quoted; quotes and control characters can't appear in it. */
const paramValue = (value: string): string =>
  `"${value
    .split('')
    .filter((ch) => ch !== '"' && !isControl(ch))
    .join('')
    .trim()}"`;

/**
 * Folds a content line at 75 octets (RFC 5545 3.1): continuation lines start with one space. It
 * counts UTF-8 bytes and never splits a character.
 */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74; // a continuation's leading space counts too
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** The .ics: one VEVENT in UTC, lines folded and ended with CRLF. */
export function buildIcs(e: IcsEvent): string {
  const cancel = e.method === 'CANCEL';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pultly//Meetings//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${icsTime(e.stamp)}`,
    `DTSTART:${icsTime(e.start)}`,
    `DTEND:${icsTime(e.end)}`,
    `SUMMARY:${escapeIcsText(e.summary)}`,
    ...(e.location ? [`LOCATION:${escapeIcsText(e.location)}`] : []),
    `DESCRIPTION:${escapeIcsText(e.description)}`,
    `URL:${e.url}`,
    `ORGANIZER;CN=${paramValue(e.organizer.name)}:mailto:${e.organizer.email}`,
    `ATTENDEE;CN=${paramValue(e.attendee.name || e.attendee.email)};CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${e.attendee.email}`,
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** The address part of MAIL_FROM ("Pultly <no-reply@pultly.com>" → "no-reply@pultly.com"). */
export function senderAddress(from: string): string {
  const angle = /<([^>]+)>/.exec(from);
  return (angle ? angle[1]! : from).trim();
}

export interface InviteMeeting {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  companyName: string;
  dealTitle: string | null;
  /** null: the organizer left the workspace. */
  organizerName: string | null;
  icsSequence: number;
}

export interface InviteEmailInput {
  kind: InviteKind;
  to: string;
  recipientName: string | null;
  actorName: string;
  workspaceName: string;
  timeZone: string;
  appUrl: string;
  /** MAIL_FROM: its address is the ORGANIZER's in the .ics. */
  mailFrom: string;
  meeting: InviteMeeting;
  now?: Date;
}

/** "Tue 6 Oct 2026" and "10:00–11:00 (Europe/Belgrade)", or with the end's day when it ends on another one. */
export function meetingDateAndTime(start: Date, end: Date, timeZone: string): { date: string; time: string } {
  const s = zonedParts(start, timeZone);
  const e = zonedParts(end, timeZone);
  const endLabel = s.date === e.date ? e.time : `${e.weekday} ${e.day} ${e.month}, ${e.time}`;
  return { date: `${s.weekday} ${s.day} ${s.month} ${s.year}`, time: `${s.time}${s.date === e.date ? '–' : ' – '}${endLabel} (${timeZone})` };
}

const SUBJECT: Record<InviteKind, string> = {
  added: 'You were added to a meeting',
  updated: 'Meeting changed',
  cancelled: 'Meeting cancelled',
};

/** The email to one internal participant, with its .ics attached. */
export function meetingInviteEmail(input: InviteEmailInput): MailMessage {
  const { kind, meeting: m, timeZone, workspaceName, actorName } = input;
  const link = `${input.appUrl.replace(/\/+$/, '')}/meetings/${m.id}`;
  const { date, time } = meetingDateAndTime(m.startsAt, m.endsAt, timeZone);
  const subject = `${SUBJECT[kind]}: ${m.title}`;
  const intro =
    kind === 'added'
      ? `${actorName} added you to ${m.title} with ${m.companyName} in ${workspaceName}.`
      : kind === 'updated'
        ? `${actorName} changed ${m.title} with ${m.companyName}. Here is the meeting as it is now.`
        : `${actorName} cancelled ${m.title} with ${m.companyName}.`;
  const facts = [
    `Date: ${date}`,
    `Time: ${time}`,
    m.location ? `Location: ${m.location}` : null,
    `Company: ${m.companyName}`,
    m.dealTitle ? `Deal: ${m.dealTitle}` : null,
    `Organizer: ${m.organizerName ?? 'left the workspace'}`,
  ].filter((f): f is string => !!f);
  const calendarNote = kind === 'cancelled' ? 'The attached meeting.ics removes it from your calendar.' : 'Open the attached meeting.ics to add it to your calendar, or update it there.';
  const greeting = input.recipientName ? `Hi ${input.recipientName.split(' ')[0]},` : 'Hi,';
  const footer = `You get this email because "Meeting invitations" is on in Settings → Notifications for ${workspaceName}.`;

  const description = [`Company: ${m.companyName}`, m.dealTitle ? `Deal: ${m.dealTitle}` : null, `Open in Pultly: ${link}`].filter(Boolean).join('\n');
  const method = kind === 'cancelled' ? 'CANCEL' : 'REQUEST';
  const ics = buildIcs({
    uid: meetingUid(m.id),
    sequence: m.icsSequence,
    method,
    start: m.startsAt,
    end: m.endsAt,
    stamp: input.now ?? new Date(),
    summary: m.title,
    location: m.location,
    description,
    url: link,
    organizer: { name: m.organizerName ?? workspaceName, email: senderAddress(input.mailFrom) },
    attendee: { name: input.recipientName, email: input.to },
  });
  const attachment: MailAttachment = { filename: 'meeting.ics', contentType: `text/calendar; charset=utf-8; method=${method}`, content: ics };

  const text = [greeting, '', intro, '', ...facts, '', `Open the meeting: ${link}`, '', calendarNote, '', footer].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`,
      `<p style="margin:0 0 12px;color:#475750">${facts.map(escapeHtml).join('<br>')}</p>`,
      buttonHtml('Open the meeting', link),
      `<p style="margin:0;color:#475750">${escapeHtml(calendarNote)}</p>`,
    ].join('\n'),
    footer,
    input.appUrl,
  );
  return { to: input.to, subject, text, html, attachments: [attachment] };
}
