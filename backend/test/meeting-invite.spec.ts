import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  escapeIcsText,
  foldIcsLine,
  type IcsEvent,
  icsTime,
  type InviteEmailInput,
  meetingDateAndTime,
  meetingInviteEmail,
  meetingUid,
  senderAddress,
} from '../src/modules/crm/meetings/meeting-invite';

/** The .ics with folded lines joined again, split into content lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');
const prop = (ics: string, name: string) => unfold(ics).find((l) => l.startsWith(name + ':') || l.startsWith(name + ';'));

const event: IcsEvent = {
  uid: meetingUid('3f2a'),
  sequence: 0,
  method: 'REQUEST',
  start: new Date('2026-10-06T08:00:00Z'),
  end: new Date('2026-10-06T09:00:00Z'),
  stamp: new Date('2026-10-05T12:34:56.789Z'),
  summary: 'Quarterly review',
  location: 'Bulevar 1, Belgrade',
  description: 'Company: Acme\nOpen in Pultly: https://app.example.com/meetings/3f2a',
  url: 'https://app.example.com/meetings/3f2a',
  organizer: { name: 'Ana Petrović', email: 'no-reply@pultly.com' },
  attendee: { name: 'Bo Tester', email: 'bo@example.com' },
};

describe('the .ics (RFC 5545)', () => {
  it('is one VEVENT in UTC with a stable UID, CRLF line ends and the request method', () => {
    const ics = buildIcs(event);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n|\r/);
    const lines = unfold(ics);
    expect(lines).toContain('METHOD:REQUEST');
    expect(lines).toContain('UID:meeting-3f2a@pultly.com');
    expect(lines).toContain('SEQUENCE:0');
    expect(lines).toContain('DTSTAMP:20261005T123456Z');
    expect(lines).toContain('DTSTART:20261006T080000Z');
    expect(lines).toContain('DTEND:20261006T090000Z');
    expect(lines).toContain('STATUS:CONFIRMED');
    expect(lines).toContain('LOCATION:Bulevar 1\\, Belgrade');
    expect(prop(ics, 'ORGANIZER')).toBe('ORGANIZER;CN="Ana Petrović":mailto:no-reply@pultly.com');
    expect(prop(ics, 'ATTENDEE')).toBe('ATTENDEE;CN="Bo Tester";CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:bo@example.com');
    expect(prop(ics, 'DESCRIPTION')).toBe('DESCRIPTION:Company: Acme\\nOpen in Pultly: https://app.example.com/meetings/3f2a');
  });

  it('cancels the same event with METHOD:CANCEL, STATUS:CANCELLED and a higher sequence', () => {
    const ics = buildIcs({ ...event, method: 'CANCEL', sequence: 3 });
    const lines = unfold(ics);
    expect(lines).toContain('METHOD:CANCEL');
    expect(lines).toContain('STATUS:CANCELLED');
    expect(lines).toContain('SEQUENCE:3');
    expect(lines).toContain('UID:meeting-3f2a@pultly.com');
  });

  it('leaves out an empty location', () => {
    expect(prop(buildIcs({ ...event, location: null }), 'LOCATION')).toBeUndefined();
  });

  it('escapes text values and keeps quotes out of parameters', () => {
    expect(escapeIcsText('a\\b; c, d\r\ne\nf')).toBe('a\\\\b\\; c\\, d\\ne\\nf');
    expect(escapeIcsText('bell\u0007')).toBe('bell');
    const ics = buildIcs({ ...event, summary: 'Price; terms, next', organizer: { name: 'Ana "the boss": Petrović', email: 'x@y.z' } });
    expect(prop(ics, 'SUMMARY')).toBe('SUMMARY:Price\\; terms\\, next');
    expect(prop(ics, 'ORGANIZER')).toBe('ORGANIZER;CN="Ana the boss: Petrović":mailto:x@y.z');
  });

  it('folds lines at 75 octets without splitting a character', () => {
    expect(foldIcsLine('SHORT:line')).toBe('SHORT:line');
    const long = 'SUMMARY:' + 'ž'.repeat(100); // 2 bytes each
    const folded = foldIcsLine(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(2);
    expect(Buffer.byteLength(parts[0]!, 'utf8')).toBeLessThanOrEqual(75);
    for (const p of parts.slice(1)) {
      expect(p.startsWith(' ')).toBe(true);
      expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(folded).not.toContain('�');
    const ics = buildIcs({ ...event, description: 'x'.repeat(500) });
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  });

  it('writes times in UTC', () => {
    expect(icsTime(new Date('2026-03-29T00:30:00.000Z'))).toBe('20260329T003000Z');
  });

  it('takes the address out of MAIL_FROM', () => {
    expect(senderAddress('Pultly <no-reply@pultly.com>')).toBe('no-reply@pultly.com');
    expect(senderAddress(' no-reply@pultly.com ')).toBe('no-reply@pultly.com');
  });
});

describe('the meeting emails to internal participants', () => {
  const input: InviteEmailInput = {
    kind: 'added',
    to: 'bo@example.com',
    recipientName: 'Bo Tester',
    actorName: 'Ana Petrović',
    workspaceName: 'Acme <Studio>',
    timeZone: 'Europe/Belgrade',
    appUrl: 'https://app.example.com/',
    mailFrom: 'Pultly <no-reply@pultly.com>',
    now: new Date('2026-10-05T12:00:00Z'),
    meeting: {
      id: 'm-1',
      title: 'Quarterly review',
      startsAt: new Date('2026-10-06T08:00:00Z'),
      endsAt: new Date('2026-10-06T09:00:00Z'),
      location: 'Acme HQ',
      companyName: 'Acme d.o.o.',
      dealTitle: 'Acme renewal',
      organizerName: 'Ana Petrović',
      icsSequence: 0,
    },
  };

  it('"You were added": date, time in the workspace zone, location, company and link, with a request .ics', () => {
    const mail = meetingInviteEmail(input);
    expect(mail.to).toBe('bo@example.com');
    expect(mail.subject).toBe('You were added to a meeting: Quarterly review');
    expect(mail.text).toContain('Ana Petrović added you to Quarterly review with Acme d.o.o. in Acme <Studio>.');
    expect(mail.text).toContain('Date: Tue 6 Oct 2026');
    expect(mail.text).toContain('Time: 10:00–11:00 (Europe/Belgrade)');
    expect(mail.text).toContain('Location: Acme HQ');
    expect(mail.text).toContain('Company: Acme d.o.o.');
    expect(mail.text).toContain('Deal: Acme renewal');
    expect(mail.text).toContain('https://app.example.com/meetings/m-1');
    expect(mail.text).toContain('"Meeting invitations"');
    expect(mail.html).toContain('href="https://app.example.com/meetings/m-1"');
    expect(mail.html).toContain('Acme &lt;Studio&gt;');
    expect(mail.attachments).toHaveLength(1);
    const [ics] = mail.attachments!;
    expect(ics!.filename).toBe('meeting.ics');
    expect(ics!.contentType).toBe('text/calendar; charset=utf-8; method=REQUEST');
    const lines = unfold(ics!.content);
    expect(lines).toContain('METHOD:REQUEST');
    expect(lines).toContain('UID:meeting-m-1@pultly.com');
    expect(lines).toContain('DTSTART:20261006T080000Z');
    expect(lines).toContain('ORGANIZER;CN="Ana Petrović":mailto:no-reply@pultly.com');
    expect(prop(ics!.content, 'ATTENDEE')).toContain('mailto:bo@example.com');
    expect(prop(ics!.content, 'DESCRIPTION')).toBe('DESCRIPTION:Company: Acme d.o.o.\\nDeal: Acme renewal\\nOpen in Pultly: https://app.example.com/meetings/m-1');
  });

  it('an update carries the new sequence; a cancellation cancels the event', () => {
    const updated = meetingInviteEmail({ ...input, kind: 'updated', meeting: { ...input.meeting, icsSequence: 2 } });
    expect(updated.subject).toBe('Meeting changed: Quarterly review');
    expect(unfold(updated.attachments![0]!.content)).toContain('SEQUENCE:2');

    const cancelled = meetingInviteEmail({ ...input, kind: 'cancelled', meeting: { ...input.meeting, icsSequence: 3 } });
    expect(cancelled.subject).toBe('Meeting cancelled: Quarterly review');
    expect(cancelled.text).toContain('Ana Petrović cancelled Quarterly review');
    expect(cancelled.attachments![0]!.contentType).toBe('text/calendar; charset=utf-8; method=CANCEL');
    const lines = unfold(cancelled.attachments![0]!.content);
    expect(lines).toEqual(expect.arrayContaining(['METHOD:CANCEL', 'STATUS:CANCELLED', 'SEQUENCE:3', 'UID:meeting-m-1@pultly.com']));
  });

  it('says when the organizer left, and leaves out a missing deal and location', () => {
    const mail = meetingInviteEmail({ ...input, meeting: { ...input.meeting, organizerName: null, dealTitle: null, location: null } });
    expect(mail.text).toContain('Organizer: left the workspace');
    expect(mail.text).not.toContain('Deal:');
    expect(mail.text).not.toContain('Location:');
    expect(prop(mail.attachments![0]!.content, 'ORGANIZER')).toBe('ORGANIZER;CN="Acme <Studio>":mailto:no-reply@pultly.com');
  });

  it('shows times on the workspace clock across a daylight saving change', () => {
    // Belgrade: CEST (UTC+2) until 25 Oct 2026 03:00, CET (UTC+1) after.
    expect(meetingDateAndTime(new Date('2026-10-24T08:00:00Z'), new Date('2026-10-24T09:00:00Z'), 'Europe/Belgrade')).toEqual({ date: 'Sat 24 Oct 2026', time: '10:00–11:00 (Europe/Belgrade)' });
    expect(meetingDateAndTime(new Date('2026-10-26T08:00:00Z'), new Date('2026-10-26T09:00:00Z'), 'Europe/Belgrade')).toEqual({ date: 'Mon 26 Oct 2026', time: '09:00–10:00 (Europe/Belgrade)' });
    // Across midnight, and the night the clocks go back.
    expect(meetingDateAndTime(new Date('2026-10-24T21:00:00Z'), new Date('2026-10-25T02:00:00Z'), 'Europe/Belgrade')).toEqual({ date: 'Sat 24 Oct 2026', time: '23:00 – Sun 25 Oct, 03:00 (Europe/Belgrade)' });
    // The .ics stays in UTC whatever the zone.
    const mail = meetingInviteEmail({ ...input, timeZone: 'America/New_York' });
    expect(mail.text).toContain('Time: 04:00–05:00 (America/New_York)');
    expect(unfold(mail.attachments![0]!.content)).toContain('DTSTART:20261006T080000Z');
  });
});
