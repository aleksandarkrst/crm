/**
 * A file sent with an email, as text (calendar invitations, CD-131). `contentType` is the full
 * header value, e.g. "text/calendar; charset=utf-8; method=REQUEST".
 */
export interface MailAttachment {
  filename: string;
  contentType: string;
  content: string;
}

/** One email: plain text plus a simple HTML version of the same content, and optional attachments. */
export interface MailMessage {
  /** One address, or several (the external minutes to a customer's people, CD-133). */
  to: string | string[];
  /** Copies (CD-133: members the sender adds). */
  cc?: string[];
  /** Where replies go (CD-133: the salesperson who sent the minutes). */
  replyTo?: string;
  /**
   * A display name for the sender, shown with the platform's sending address (MAIL_FROM's address):
   * "Ana Petrović" <no-reply@pultly.com> (CD-133). Without it the email is from MAIL_FROM as is.
   */
  fromName?: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

/** A message as the log driver recorded it. `rejected`: addresses it refused while delivering to the others. */
export interface SentMail extends MailMessage {
  from: string;
  sentAt: string;
  rejected?: string[];
}

/** What a send reports when it went out: the addresses the server refused (the others got it). */
export interface MailResult {
  rejected: string[];
}

/** The addresses of a message's `to` and `cc`. */
export const recipientsOf = (message: Pick<MailMessage, 'to' | 'cc'>): string[] => [...(Array.isArray(message.to) ? message.to : [message.to]), ...(message.cc ?? [])];

/** The bare address of a sender such as `Pultly <no-reply@pultly.com>`, or the value itself. */
export function mailAddressOf(from: string): string {
  const m = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  return (m ? m[1]! : from).trim();
}

/** A display name for a From header: quotes, brackets and line breaks removed (they would break the header). */
export const safeDisplayName = (name: string): string =>
  name
    .replace(/["\\<>\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The From header of a message: its `fromName` with the platform's address, else MAIL_FROM as is. */
export const fromHeader = (message: Pick<MailMessage, 'fromName'>, mailFrom: string): string => {
  const name = message.fromName ? safeDisplayName(message.fromName) : '';
  return name ? `"${name}" <${mailAddressOf(mailFrom)}>` : mailFrom;
};

/**
 * Sends email. The driver is chosen by MAIL_DRIVER (see MailModule): "log" for development and
 * tests, "smtp" for any real provider. Throwing means the send failed for every recipient; the
 * job that called it fails and pg-boss retries it. When it went out, the result names the
 * addresses the server refused, if any (the external minutes track them per recipient, CD-133).
 */
export abstract class Mailer {
  /**
   * Why messages never reach anyone (the log driver in production), or null when they do. Jobs
   * check it before sending, so nothing is reported as sent that wasn't (CD-84).
   */
  readonly notDelivered: string | null = null;

  abstract send(message: MailMessage): Promise<MailResult>;
}
