import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/infrastructure/config/env';
import { SecretBox } from '../src/infrastructure/crypto/secret-box';
import { escapeHtml } from '../src/infrastructure/mail/html';
import { LogMailer, readOutbox } from '../src/infrastructure/mail/log-mailer';
import { createMailer, MAIL_NOT_SET_UP, outboxFileOf } from '../src/infrastructure/mail/mail.module';
import { SmtpMailer } from '../src/infrastructure/mail/smtp-mailer';
import { invitationEmail, inviteLink } from '../src/modules/identity/invitation-email';

const message = { to: 'ana@example.com', subject: 'Hello', text: 'Plain text', html: '<p>Hi</p>' };
const env = (over: Partial<Env>): Env => ({ NODE_ENV: 'development', STORAGE_DIR: './storage', MAIL_DRIVER: 'log', MAIL_FROM: 'Pultly <no-reply@example.com>', ...over }) as Env;

describe('LogMailer', () => {
  it('keeps the message in memory and appends it to the outbox file', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mail-')), 'dev-mail', 'outbox.jsonl');
    const mailer = new LogMailer('Pultly <no-reply@example.com>', file);
    await mailer.send(message);
    await mailer.send({ ...message, to: 'bo@example.com' });
    expect(mailer.sent.map((m) => m.to)).toEqual(['ana@example.com', 'bo@example.com']);
    expect(mailer.sent[0]).toMatchObject({ ...message, from: 'Pultly <no-reply@example.com>' });
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);
    const read = await readOutbox(file);
    expect(read.map((m) => m.to)).toEqual(['ana@example.com', 'bo@example.com']);
    expect(read[0]!.sentAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('works without an outbox file (production)', async () => {
    const mailer = new LogMailer('x@example.com', null);
    await mailer.send(message);
    expect(mailer.sent).toHaveLength(1);
  });

  it('refuses addresses at the reserved .invalid domain, so failures can be tried', async () => {
    const mailer = new LogMailer('x@example.com', null);
    await expect(mailer.send({ ...message, to: 'bounce@nowhere.invalid' })).rejects.toThrow(/Mailbox unavailable/);
    expect(mailer.sent).toHaveLength(0);
  });

  it('sends to several people and copies, from a display name, and reports the refused ones (CD-133)', async () => {
    const mailer = new LogMailer('Pultly <no-reply@example.com>', null);
    const res = await mailer.send({ ...message, to: ['jo@customer.example.com', 'gone@nowhere.invalid'], cc: ['bo@example.com'], replyTo: 'ana@example.com', fromName: 'Ana "A" Petrović' });
    expect(res).toEqual({ rejected: ['gone@nowhere.invalid'] });
    expect(mailer.sent[0]).toMatchObject({ from: '"Ana A Petrović" <no-reply@example.com>', replyTo: 'ana@example.com', cc: ['bo@example.com'], rejected: ['gone@nowhere.invalid'] });
    await expect(mailer.send({ ...message, to: ['a@x.invalid'], cc: ['b@y.invalid'] })).rejects.toThrow(/Mailbox unavailable/);
    expect(await mailer.send(message)).toEqual({ rejected: [] });
  });

  it('keeps attachments with the message and in the outbox (CD-131)', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mail-')), 'dev-mail', 'outbox.jsonl');
    const mailer = new LogMailer('x@example.com', file);
    const ics = { filename: 'meeting.ics', contentType: 'text/calendar; charset=utf-8; method=REQUEST', content: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' };
    await mailer.send({ ...message, attachments: [ics] });
    expect(mailer.sent[0]!.attachments).toEqual([ics]);
    expect((await readOutbox(file))[0]!.attachments).toEqual([ics]);
  });

  it('reads a missing outbox as empty', async () => {
    expect(await readOutbox(join(tmpdir(), 'no-such-dir-' + Date.now(), 'outbox.jsonl'))).toEqual([]);
  });
});

describe('createMailer', () => {
  it('picks the driver from MAIL_DRIVER', () => {
    expect(createMailer(env({}))).toBeInstanceOf(LogMailer);
    expect(createMailer(env({ MAIL_DRIVER: 'smtp', SMTP_URL: 'smtp://user:pass@localhost:2525' }))).toBeInstanceOf(SmtpMailer);
  });

  it('says the log driver delivers nothing only in production (CD-84)', () => {
    expect(createMailer(env({})).notDelivered).toBeNull();
    expect(createMailer(env({ NODE_ENV: 'production' })).notDelivered).toBe(MAIL_NOT_SET_UP);
    expect(createMailer(env({ NODE_ENV: 'production', MAIL_DRIVER: 'smtp', SMTP_URL: 'smtp://user:pass@localhost:2525' })).notDelivered).toBeNull();
  });

  it('keeps an outbox file only outside production', () => {
    expect(outboxFileOf(env({}))).toMatch(/dev-mail[\\/]outbox\.jsonl$/);
    expect(outboxFileOf(env({ NODE_ENV: 'production' }))).toBeNull();
  });
});

describe('SmtpMailer', () => {
  it('passes attachments to nodemailer with their file name and content type (CD-131)', async () => {
    const mailer = new SmtpMailer('smtp://user:pass@localhost:2525', 'Pultly <no-reply@example.com>');
    const sendMail = vi.fn().mockResolvedValue({});
    Object.assign(mailer, { transport: { sendMail } });
    const ics = { filename: 'meeting.ics', contentType: 'text/calendar; charset=utf-8; method=CANCEL', content: 'BEGIN:VCALENDAR\r\n' };
    await mailer.send({ ...message, attachments: [ics] });
    expect(sendMail).toHaveBeenCalledWith({ from: 'Pultly <no-reply@example.com>', to: 'ana@example.com', subject: 'Hello', text: 'Plain text', html: '<p>Hi</p>', attachments: [ics] });
    await mailer.send(message);
    expect(sendMail.mock.calls[1]![0].attachments).toBeUndefined();
  });
});

describe('SecretBox', () => {
  it('round-trips, uses a fresh IV each time, and refuses another key or purpose', () => {
    const box = new SecretBox('a'.repeat(32), 'invite-link');
    const sealed = box.seal('token-123');
    expect(sealed).not.toContain('token-123');
    expect(box.seal('token-123')).not.toBe(sealed);
    expect(box.open(sealed)).toBe('token-123');
    expect(new SecretBox('b'.repeat(32), 'invite-link').open(sealed)).toBeNull();
    expect(new SecretBox('a'.repeat(32), 'other').open(sealed)).toBeNull();
    expect(box.open('garbage')).toBeNull();
  });
});

describe('invitationEmail', () => {
  const input = {
    to: 'new@example.com',
    workspaceName: 'Acme <Studio>',
    inviterName: 'Ana Petrović',
    inviterEmail: 'ana@example.com',
    role: 'admin' as const,
    link: inviteLink('https://app.example.com/', 'tok_123'),
    expiresAt: new Date('2026-10-01T10:00:00Z'),
    timeZone: 'Europe/Belgrade',
  };

  it('names the inviter and workspace and carries the link built from the app URL', () => {
    const mail = invitationEmail(input);
    expect(input.link).toBe('https://app.example.com/invite/tok_123');
    expect(mail.to).toBe('new@example.com');
    expect(mail.subject).toBe('Ana Petrović invited you to Acme <Studio> on Pultly');
    expect(mail.text).toContain('Ana Petrović (ana@example.com) invited you to join Acme <Studio> on Pultly as an admin');
    expect(mail.text).toContain('https://app.example.com/invite/tok_123');
    expect(mail.text).toContain('until 1 October 2026');
    expect(mail.html).toContain('href="https://app.example.com/invite/tok_123"');
  });

  it('shows the Pultly logo from the app, with a text fallback (CD-203)', () => {
    const mail = invitationEmail(input);
    expect(mail.html).toContain('<img src="https://app.example.com/email-logo.png"');
    expect(mail.html).toContain('alt="Pultly"');
  });

  it('escapes names in the HTML version', () => {
    const mail = invitationEmail(input);
    expect(mail.html).toContain('Acme &lt;Studio&gt;');
    expect(mail.html).not.toContain('Acme <Studio>');
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });

  it('falls back to the email, or "A teammate", when the inviter has no name', () => {
    expect(invitationEmail({ ...input, inviterName: null }).subject).toMatch(/^ana@example\.com invited you/);
    expect(invitationEmail({ ...input, inviterName: null, inviterEmail: null, role: 'member' }).text).toContain('A teammate invited you to join Acme <Studio> on Pultly as a member');
  });
});
