import { describe, expect, it } from 'vitest';
import {
  defaultReminders,
  dueAt,
  meetingReminderEmail,
  minutesOf,
  REMINDER_INPUT,
  reminderLabel,
  reminderOf,
  remindersError,
  type ReminderEmailInput,
} from '../src/modules/crm/meetings/meeting-reminders';

describe('meeting reminders (CD-376)', () => {
  it('start at 1 hour before, and 1 day before too for a customer visit', () => {
    expect(defaultReminders('online')).toEqual([{ amount: 1, unit: 'hours' }]);
    expect(defaultReminders('office')).toEqual([{ amount: 1, unit: 'hours' }]);
    expect(defaultReminders('phone')).toEqual([{ amount: 1, unit: 'hours' }]);
    expect(defaultReminders('visit')).toEqual([
      { amount: 1, unit: 'days' },
      { amount: 1, unit: 'hours' },
    ]);
  });

  it('count in minutes and back in the unit they were entered in', () => {
    expect(minutesOf({ amount: 30, unit: 'minutes' })).toBe(30);
    expect(minutesOf({ amount: 2, unit: 'hours' })).toBe(120);
    expect(minutesOf({ amount: 1, unit: 'days' })).toBe(1440);
    expect(reminderOf(120, 'hours')).toEqual({ amount: 2, unit: 'hours' });
    expect(reminderOf(120, 'minutes')).toEqual({ amount: 120, unit: 'minutes' });
    expect(dueAt(new Date('2026-11-10T09:00:00Z'), 90)).toEqual(new Date('2026-11-10T07:30:00Z'));
  });

  it('are at most 5, at most 4 weeks before, and never two at the same time', () => {
    const hour = { amount: 1, unit: 'hours' } as const;
    expect(remindersError([])).toBeNull();
    expect(remindersError([hour, { amount: 0, unit: 'minutes' }, { amount: 4, unit: 'days' }])).toBeNull();
    expect(remindersError([1, 2, 3, 4, 5].map((amount) => ({ amount, unit: 'hours' as const })))).toBeNull();
    expect(remindersError([1, 2, 3, 4, 5, 6].map((amount) => ({ amount, unit: 'hours' as const })))).toBe('You can have at most 5 reminders on a meeting.');
    expect(remindersError([{ amount: 28, unit: 'days' }])).toBeNull();
    expect(remindersError([{ amount: 29, unit: 'days' }])).toBe('A reminder can be at most 4 weeks before the meeting.');
    expect(remindersError([hour, { amount: 60, unit: 'minutes' }])).toBe('Two of these reminders are at the same time.');
  });

  it('accept whole, non-negative amounts of minutes, hours or days', () => {
    expect(REMINDER_INPUT.safeParse({ amount: 30, unit: 'minutes' }).success).toBe(true);
    expect(REMINDER_INPUT.safeParse({ amount: 1.5, unit: 'hours' }).success).toBe(false);
    expect(REMINDER_INPUT.safeParse({ amount: -1, unit: 'hours' }).success).toBe(false);
    expect(REMINDER_INPUT.safeParse({ amount: 1, unit: 'weeks' }).success).toBe(false);
  });

  it('read as "30 minutes", "1 hour", "2 days"', () => {
    expect(reminderLabel({ amount: 30, unit: 'minutes' })).toBe('30 minutes');
    expect(reminderLabel({ amount: 1, unit: 'hours' })).toBe('1 hour');
    expect(reminderLabel({ amount: 2, unit: 'days' })).toBe('2 days');
    expect(reminderLabel({ amount: 1, unit: 'minutes' })).toBe('1 minute');
  });
});

describe('the reminder email', () => {
  const input: ReminderEmailInput = {
    to: 'bo@example.com',
    recipientName: 'Bo Tester',
    workspaceName: 'Acme <Studio>',
    timeZone: 'Europe/Belgrade',
    appUrl: 'https://app.example.com/',
    reminder: { amount: 1, unit: 'hours' },
    now: new Date('2026-11-10T08:00:00Z'),
    meeting: {
      id: 'm-1',
      title: 'Quarterly review',
      startsAt: new Date('2026-11-10T09:00:00Z'),
      endsAt: new Date('2026-11-10T10:00:00Z'),
      location: 'Bulevar 1, Beograd',
      agenda: 'Pricing\n<Roadmap>',
      companyName: 'Acme d.o.o.',
    },
  };

  it('has the title, the time in the workspace zone, the location with a map, the agenda and the link', () => {
    const mail = meetingReminderEmail(input);
    expect(mail.to).toBe('bo@example.com');
    expect(mail.subject).toBe('Reminder: Quarterly review @ Tue 10 Nov 2026, 10:00');
    expect(mail.text).toContain('Hi Bo,');
    expect(mail.text).toContain('Quarterly review with Acme d.o.o. starts today at 10:00. This is your reminder 1 hour before.');
    expect(mail.text).toContain('Time: 10:00–11:00 (Europe/Belgrade)');
    expect(mail.text).toContain('Location: Bulevar 1, Beograd');
    expect(mail.text).toContain('Map: https://www.google.com/maps/search/?api=1&query=Bulevar%201%2C%20Beograd');
    expect(mail.text).toContain('Agenda:\nPricing\n<Roadmap>');
    expect(mail.text).toContain('Open the meeting: https://app.example.com/meetings/m-1');
    expect(mail.html).toContain('&lt;Roadmap&gt;');
    expect(mail.html).not.toContain('<Roadmap>');
    expect(mail.attachments).toBeUndefined();
  });

  it('names the day when the meeting is not today, and a join link as a link', () => {
    const mail = meetingReminderEmail({
      ...input,
      reminder: { amount: 1, unit: 'days' },
      now: new Date('2026-11-09T09:00:00Z'),
      meeting: { ...input.meeting, location: 'https://meet.example.com/abc', agenda: null },
    });
    expect(mail.text).toContain('starts on Tue 10 Nov 2026 at 10:00. This is your reminder 1 day before.');
    expect(mail.text).toContain('Join: https://meet.example.com/abc');
    expect(mail.text).not.toContain('Map:');
    expect(mail.text).not.toContain('Agenda');
  });

  it('says "at the start" for a reminder of 0 minutes', () => {
    expect(meetingReminderEmail({ ...input, reminder: { amount: 0, unit: 'minutes' } }).text).toContain('This is your reminder at the start.');
  });
});
