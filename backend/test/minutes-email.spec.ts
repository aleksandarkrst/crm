import { describe, expect, it } from 'vitest';
import { deliveryOf } from '../src/modules/crm/meetings/external-minutes.service';
import {
  CHROME,
  dayLabel,
  meetingWhen,
  type MinutesEmailInput,
  minutesEmail,
  minutesMailMessage,
  minutesTemplate,
  prefillCheck,
  renderMinutesHtml,
  renderMinutesText,
  updateFromMeeting,
} from '../src/modules/crm/meetings/minutes-email';
import { fromHeader, mailAddressOf } from '../src/infrastructure/mail/mailer';

const input: MinutesEmailInput = {
  language: 'en',
  subject: 'Minutes: Quarterly review, 6 Oct 2026',
  body: '**Quarterly review**\nWe agreed on:\n- a pilot in [Belgrade](https://example.com/pilot)\n- pricing by Friday\n\nDetails: https://example.com/doc.',
  workspaceName: 'Kestrel d.o.o.',
  sender: { name: 'Ana Petrović', email: 'ana@kestrel.example.com' },
  mailFrom: 'Pultly <no-reply@pultly.com>',
  to: [{ name: 'Jovan Jovanović', email: 'jovan@customer.example.com' }],
  cc: [{ name: 'Bo Tester', email: 'bo@kestrel.example.com' }],
};

describe('minutesEmail (CD-133)', () => {
  it('is from the sender by name at the platform address, replies to the sender, with the chosen people', () => {
    const email = minutesEmail(input);
    expect(email.from).toBe('"Ana Petrović" <no-reply@pultly.com>');
    expect(email.replyTo).toBe('ana@kestrel.example.com');
    expect(email.to).toEqual(input.to);
    expect(email.cc).toEqual(input.cc);
    expect(email.subject).toBe('Minutes: Quarterly review, 6 Oct 2026');
    const message = minutesMailMessage(email, input.sender);
    expect(message).toMatchObject({ to: ['jovan@customer.example.com'], cc: ['bo@kestrel.example.com'], replyTo: 'ana@kestrel.example.com', fromName: 'Ana Petrović' });
  });

  it('renders the formatting subset in HTML and a readable plain text', () => {
    const email = minutesEmail(input);
    expect(email.html).toContain('<strong>Quarterly review</strong>');
    expect(email.html).toContain('<ul style="margin:0 0 12px;padding-left:22px"><li>a pilot in <a href="https://example.com/pilot" style="color:#14503C">Belgrade</a></li><li>pricing by Friday</li></ul>');
    expect(email.html).toContain('<a href="https://example.com/doc" style="color:#14503C">https://example.com/doc</a>.');
    expect(email.text).toContain('Quarterly review\nWe agreed on:\n• a pilot in Belgrade (https://example.com/pilot)\n• pricing by Friday');
    expect(email.text).not.toContain('**');
  });

  it('writes the chrome in English', () => {
    const email = minutesEmail(input);
    for (const part of [email.text, email.html]) {
      expect(part).toContain('Meeting minutes');
      expect(part).toContain('Sent by Ana Petrović, Kestrel d.o.o.');
      expect(part).toContain('Reply to this email to reach Ana Petrović directly (ana@kestrel.example.com).');
      expect(part).toContain('Kestrel d.o.o. sent you these minutes with Pultly.');
    }
  });

  it('writes the chrome in Serbian (Latin) when the workspace chose it (CD-208)', () => {
    const email = minutesEmail({ ...input, language: 'sr' });
    for (const part of [email.text, email.html]) {
      expect(part).toContain('Zapisnik sa sastanka');
      expect(part).toContain('Poslao/la: Ana Petrović, Kestrel d.o.o.');
      expect(part).toContain('Odgovorite na ovu poruku da biste direktno kontaktirali pošiljaoca (ana@kestrel.example.com).');
      expect(part).toContain('Ovaj zapisnik vam je poslala kompanija Kestrel d.o.o. putem aplikacije Pultly.');
      expect(part).not.toContain('Meeting minutes');
      expect(part).not.toContain('Reply to this email');
    }
    // The minutes text is whatever the user wrote, in any language.
    expect(email.text).toContain('pricing by Friday');
    expect(Object.keys(CHROME).sort()).toEqual(['en', 'sr']);
  });

  it('escapes everything the user wrote: no HTML gets through, links are only http(s)', () => {
    const email = minutesEmail({
      ...input,
      subject: 'Hi\r\nBcc: evil@example.com',
      workspaceName: '<b>Acme</b>',
      sender: { name: 'Eve "<script>"', email: 'eve@example.com' },
      body: '<script>alert(1)</script>\n**<img src=x onerror=alert(1)>**\n[click](javascript:alert(1))\n[ok](https://x.example/?a=1&b="2")\n- <i>item</i>',
    });
    expect(email.subject).toBe('Hi Bcc: evil@example.com');
    expect(email.html).not.toMatch(/<script|<img|<i>|<b>Acme|javascript:alert\(1\)"|onerror=alert\(1\)>/);
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
    expect(email.html).toContain('[click](javascript:alert(1))');
    expect(email.html).toContain('<a href="https://x.example/?a=1&amp;b=&quot;2&quot;" style="color:#14503C">ok</a>');
    expect(email.html).toContain('&lt;b&gt;Acme&lt;/b&gt;');
    expect(email.from).toBe('"Eve script" <no-reply@pultly.com>');
  });

  it('takes no internal minutes: only the external text and facts about sender and workspace', () => {
    // The input type has no field for them; whatever else is passed in never shows up.
    const marker = 'INTERNAL-ONLY-7f3a';
    const sneaky = { ...input, summary: marker, agreements: marker, nextSteps: [{ text: marker }] } as MinutesEmailInput;
    const email = minutesEmail(sneaky);
    expect(JSON.stringify(email)).not.toContain(marker);
  });
});

describe('renderMinutesHtml / renderMinutesText', () => {
  it('keeps paragraphs with line breaks and turns "-" and "*" lines into lists', () => {
    expect(renderMinutesHtml('one\ntwo\n\n* a\n- b')).toBe('<p style="margin:0 0 12px">one<br>two</p>\n<ul style="margin:0 0 12px;padding-left:22px"><li>a</li><li>b</li></ul>');
    expect(renderMinutesText('**x** and [y](https://y.example)\n* z')).toBe('x and y (https://y.example)\n• z');
  });
});

describe('minutesTemplate (spec 7.1)', () => {
  const base = {
    timeZone: 'Europe/Belgrade',
    workspaceName: 'Kestrel',
    meeting: { title: 'Quarterly review', startsAt: new Date('2026-10-06T08:00:00Z'), endsAt: new Date('2026-10-06T09:00:00Z'), location: 'Bulevar 1', companyName: 'Acme' },
    internalNames: ['Ana Petrović', 'Bo Tester'],
    externalNames: ['Jovan Jovanović'],
    agreements: 'Pilot in **Belgrade**',
    nextSteps: [
      { text: 'Send the offer', dueDate: '2026-10-10' },
      { text: '  ', dueDate: null },
      { text: 'Book the follow-up', dueDate: null },
    ],
  };

  it('has the meeting, both sides, the agreements and the next steps without owners', () => {
    const t = minutesTemplate({ ...base, language: 'en' });
    expect(t.subject).toBe('Minutes: Quarterly review, 6 Oct 2026');
    expect(t.body).toBe(
      [
        '**Quarterly review**',
        'Date: Tue 6 Oct 2026, 10:00–11:00',
        'Location: Bulevar 1',
        'Participants:',
        '- Kestrel: Ana Petrović, Bo Tester',
        '- Acme: Jovan Jovanović',
        '',
        '**Agreements**',
        'Pilot in **Belgrade**',
        '',
        '**Next steps**',
        '- Send the offer (by 10 Oct 2026)',
        '- Book the follow-up',
      ].join('\n'),
    );
  });

  it('is in Serbian when the workspace writes to customers in Serbian, and leaves out what is empty', () => {
    const t = minutesTemplate({ ...base, language: 'sr', meeting: { ...base.meeting, location: null }, agreements: '', nextSteps: [{ text: 'Poslati ponudu', dueDate: '2026-10-10' }] });
    expect(t.subject).toBe('Zapisnik: Quarterly review, 6. 10. 2026.');
    expect(t.body).toBe(['**Quarterly review**', 'Datum: 6. 10. 2026. 10:00–11:00', 'Učesnici:', '- Kestrel: Ana Petrović, Bo Tester', '- Acme: Jovan Jovanović', '', '**Sledeći koraci**', '- Poslati ponudu (rok 10. 10. 2026.)'].join('\n'));
  });

  it('formats dates and times in the workspace zone', () => {
    expect(dayLabel('2026-03-09', 'en')).toBe('9 Mar 2026');
    expect(dayLabel('2026-03-09', 'sr')).toBe('9. 3. 2026.');
    expect(meetingWhen(new Date('2026-10-24T21:00:00Z'), new Date('2026-10-24T23:00:00Z'), 'Europe/Belgrade', 'sr')).toBe('24. 10. 2026. 23:00 – 25. 10. 2026. 01:00');
  });
});

describe('delivery and sender helpers', () => {
  it('sums up a send: failed beats queued beats sent', () => {
    expect(deliveryOf(['sent', 'failed', 'queued'])).toBe('failed');
    expect(deliveryOf(['sent', 'queued'])).toBe('queued');
    expect(deliveryOf(['sent', 'sent'])).toBe('sent');
  });

  it('puts the sender name on the platform address', () => {
    expect(mailAddressOf('Pultly <no-reply@pultly.com>')).toBe('no-reply@pultly.com');
    expect(mailAddressOf('no-reply@pultly.com')).toBe('no-reply@pultly.com');
    expect(fromHeader({ fromName: 'Ana' }, 'Pultly <no-reply@pultly.com>')).toBe('"Ana" <no-reply@pultly.com>');
    expect(fromHeader({}, 'Pultly <no-reply@pultly.com>')).toBe('Pultly <no-reply@pultly.com>');
  });
});


describe('external minutes that follow their meeting (CD-222)', () => {
  const basis = (when: string, extra = '') => ({
    startsAt: when,
    endsAt: when,
    headSubject: `Minutes: Visit, ${when}`,
    headBody: `**Visit**\nDate: ${when}`,
    subject: `Minutes: Visit, ${when}`,
    body: `**Visit**\nDate: ${when}${extra}`,
  });
  const before = basis('09:30', '\n\n**Agreements**\nPilot');
  const moved = basis('11:15', '\n\n**Agreements**\nPilot');
  const text = (b: { subject: string; body: string }) => ({ subject: b.subject, body: b.body });

  it('fills in again a text nobody changed when the meeting moved', () => {
    expect(prefillCheck(text(before), before, before, { sent: false, untouched: false })).toBe('current');
    expect(prefillCheck(text(before), before, moved, { sent: false, untouched: false })).toBe('refill');
  });

  it('keeps a text someone changed, or one that was sent, and says so', () => {
    expect(prefillCheck({ ...text(before), body: before.body + '\nThanks!' }, before, moved, { sent: false, untouched: false })).toBe('stale');
    expect(prefillCheck(text(before), before, moved, { sent: true, untouched: false })).toBe('stale');
  });

  it('fills in a text from before the basis was kept only while nobody changed it', () => {
    expect(prefillCheck(text(before), null, moved, { sent: false, untouched: true })).toBe('refill');
    expect(prefillCheck(text(moved), null, moved, { sent: false, untouched: true })).toBe('current');
    expect(prefillCheck(text(before), null, moved, { sent: false, untouched: false })).toBe('current');
    expect(prefillCheck(text(before), null, moved, { sent: true, untouched: true })).toBe('current');
  });

  it('"Update from meeting" replaces the meeting lines and keeps what was written below them', () => {
    const edited = { subject: before.subject, body: before.body + '\nThanks!' };
    expect(updateFromMeeting(edited, before, moved)).toEqual({ subject: moved.subject, body: '**Visit**\nDate: 11:15\n\n**Agreements**\nPilot\nThanks!' });
    // Its own subject stays; changed meeting lines (or no basis) give the whole template again.
    expect(updateFromMeeting({ subject: 'Our notes', body: 'Hello' }, before, moved)).toEqual({ subject: 'Our notes', body: moved.body });
    expect(updateFromMeeting(edited, null, moved)).toEqual({ subject: moved.subject, body: moved.body });
  });
});
