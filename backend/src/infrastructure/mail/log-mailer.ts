import { Logger } from '@nestjs/common';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type MailMessage, Mailer, type SentMail } from './mailer';

const KEEP = 200;

/**
 * MAIL_DRIVER=log: nothing leaves the machine. Each message is logged (recipient and subject at
 * info, the text at debug) and kept: the last messages in memory, and, when an outbox file is
 * given (outside production), appended to it as JSON lines. The API and the worker are separate
 * processes, so the dev-only GET /api/dev/mail reads the file, not this process's memory.
 *
 * Addresses at the reserved ".invalid" top-level domain (RFC 2606) are refused, so a failed send
 * (and its retries) can be seen without a real provider.
 */
export class LogMailer extends Mailer {
  private readonly logger = new Logger('Mail');
  readonly sent: SentMail[] = [];
  override readonly notDelivered: string | null;

  /** `notDelivered`: set in production, where no one can read what this driver "sends". */
  constructor(
    private readonly from: string,
    private readonly outboxFile: string | null,
    notDelivered: string | null = null,
  ) {
    super();
    this.notDelivered = notDelivered;
  }

  async send(message: MailMessage): Promise<void> {
    if (/\.invalid$/i.test(message.to.trim())) throw new Error(`Mailbox unavailable: ${message.to} (the log driver refuses .invalid addresses)`);
    const mail: SentMail = { ...message, from: this.from, sentAt: new Date().toISOString() };
    this.sent.push(mail);
    if (this.sent.length > KEEP) this.sent.splice(0, this.sent.length - KEEP);
    this.logger.log(`Email to ${message.to}: ${message.subject}`);
    this.logger.debug(message.text);
    if (this.outboxFile) {
      await mkdir(dirname(this.outboxFile), { recursive: true });
      await appendFile(this.outboxFile, JSON.stringify(mail) + '\n', 'utf8');
    }
  }
}

/** The messages in an outbox file, newest last, trimming the file when it has grown long. */
export async function readOutbox(file: string): Promise<SentMail[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter(Boolean);
  const mails: SentMail[] = [];
  for (const line of lines.slice(-KEEP)) {
    try {
      mails.push(JSON.parse(line) as SentMail);
    } catch {
      // a line cut off mid-write: skip it
    }
  }
  if (lines.length > KEEP * 2) await writeFile(file, lines.slice(-KEEP).join('\n') + '\n', 'utf8');
  return mails;
}
