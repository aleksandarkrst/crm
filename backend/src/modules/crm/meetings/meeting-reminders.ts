import { buttonHtml, escapeHtml, layoutHtml } from '../../../infrastructure/mail/html';
import type { MailMessage } from '../../../infrastructure/mail/mailer';
import { z } from 'zod';
import { type MeetingType, REMINDER_UNITS, type ReminderUnit } from '../../../shared/database/schema';
import { mapLink } from '../../../shared/text/maps';
import { zonedParts } from '../../../shared/time/zoned-time';
import { meetingDateAndTime } from './meeting-invite';

/**
 * Meeting reminders (CD-376), as in Google Calendar: each person on a meeting (organizer
 * included) has their own email reminders, a number of minutes, hours or days before the start,
 * at most 5. Pure rules and the email, so they are unit-tested on their own.
 */

export const MAX_REMINDERS = 5;
/** Four weeks, as in Google Calendar. */
export const MAX_MINUTES_BEFORE = 4 * 7 * 24 * 60;
export const UNIT_MINUTES: Record<ReminderUnit, number> = { minutes: 1, hours: 60, days: 1440 };

/** A reminder as the API reads and writes it: "30 minutes before" is { amount: 30, unit: 'minutes' }. */
export interface Reminder {
  amount: number;
  unit: ReminderUnit;
}

/** A reminder as the browser sends it; remindersError checks the list as a whole. */
export const REMINDER_INPUT = z.object({ amount: z.number().int().min(0).max(MAX_MINUTES_BEFORE), unit: z.enum(REMINDER_UNITS) });

export const minutesOf = (r: Reminder): number => r.amount * UNIT_MINUTES[r.unit];
export const reminderOf = (minutesBefore: number, unit: ReminderUnit): Reminder => ({ amount: minutesBefore / UNIT_MINUTES[unit], unit });

/** What a person added to a meeting starts with: 1 hour before, and 1 day before too for a customer visit. */
export const defaultReminders = (type: MeetingType): Reminder[] =>
  type === 'visit'
    ? [
        { amount: 1, unit: 'days' },
        { amount: 1, unit: 'hours' },
      ]
    : [{ amount: 1, unit: 'hours' }];

/** When the reminder is due for this start. */
export const dueAt = (startsAt: Date, minutesBefore: number): Date => new Date(startsAt.getTime() - minutesBefore * 60_000);

/** Why this list can't be saved (a 400), or null: at most 5, four weeks at most, no two at the same time. */
export function remindersError(list: readonly Reminder[]): string | null {
  if (list.length > MAX_REMINDERS) return `You can have at most ${MAX_REMINDERS} reminders on a meeting.`;
  if (list.some((r) => minutesOf(r) > MAX_MINUTES_BEFORE)) return 'A reminder can be at most 4 weeks before the meeting.';
  const minutes = list.map(minutesOf);
  if (new Set(minutes).size !== minutes.length) return 'Two of these reminders are at the same time.';
  return null;
}

/** "30 minutes", "1 hour", "2 days". */
export function reminderLabel(r: Reminder): string {
  const word = r.unit.slice(0, -1);
  return `${r.amount} ${r.amount === 1 ? word : r.unit}`;
}

export interface ReminderEmailInput {
  to: string;
  recipientName: string | null;
  workspaceName: string;
  timeZone: string;
  appUrl: string;
  reminder: Reminder;
  now?: Date;
  meeting: { id: string; title: string; startsAt: Date; endsAt: Date; location: string | null; agenda: string | null; companyName: string };
}

/** The reminder email to its owner: the title, the time in the workspace time zone, the location, the agenda and a link. */
export function meetingReminderEmail(input: ReminderEmailInput): MailMessage {
  const { meeting: m, timeZone, workspaceName } = input;
  const link = `${input.appUrl.replace(/\/+$/, '')}/meetings/${m.id}`;
  const { date, time } = meetingDateAndTime(m.startsAt, m.endsAt, timeZone);
  const start = zonedParts(m.startsAt, timeZone);
  const today = zonedParts(input.now ?? new Date(), timeZone).date === start.date;
  // The start in the subject, as Google Calendar does: a late send (the worker was down) never says "in 1 hour" wrongly.
  const subject = `Reminder: ${m.title} @ ${date}, ${start.time}`;
  const which = input.reminder.amount === 0 ? 'at the start' : `${reminderLabel(input.reminder)} before`;
  const intro = `${m.title} with ${m.companyName} starts ${today ? 'today' : `on ${date}`} at ${start.time}. This is your reminder ${which}.`;
  const where = mapLink(m.location);
  const fact = (text: string) => ({ text, html: escapeHtml(text) });
  const facts = [
    fact(`Date: ${date}`),
    fact(`Time: ${time}`),
    m.location ? fact(`Location: ${m.location}`) : null,
    where?.kind === 'map' ? { text: `Map: ${where.url}`, html: `Map: <a href="${escapeHtml(where.url)}" style="color:#14503C">Open in Google Maps</a>` } : null,
    where?.kind === 'join' ? { text: `Join: ${where.url}`, html: `Join: <a href="${escapeHtml(where.url)}" style="color:#14503C">${escapeHtml(where.url)}</a>` } : null,
    fact(`Company: ${m.companyName}`),
  ].filter((f) => !!f);
  const agenda = m.agenda?.trim() || null;
  const greeting = input.recipientName ? `Hi ${input.recipientName.split(' ')[0]},` : 'Hi,';
  const footer = `You get this email because you have a reminder on this meeting in ${workspaceName}. Change your reminders on the meeting page.`;

  const text = [greeting, '', intro, '', ...facts.map((f) => f.text), ...(agenda ? ['', 'Agenda:', agenda] : []), '', `Open the meeting: ${link}`, '', footer].join('\n');
  const html = layoutHtml(
    [
      `<p style="margin:0 0 12px">${escapeHtml(greeting)}</p>`,
      `<p style="margin:0 0 12px">${escapeHtml(intro)}</p>`,
      `<p style="margin:0 0 12px;color:#475750">${facts.map((f) => f.html).join('<br>')}</p>`,
      agenda ? `<p style="margin:0 0 4px;font-weight:600">Agenda</p><p style="margin:0 0 12px;color:#475750;white-space:pre-line">${escapeHtml(agenda)}</p>` : '',
      buttonHtml('Open the meeting', link),
    ]
      .filter(Boolean)
      .join('\n'),
    footer,
    input.appUrl,
  );
  return { to: input.to, subject, text, html };
}
