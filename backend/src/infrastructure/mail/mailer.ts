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
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

/** A message as the log driver recorded it. */
export interface SentMail extends MailMessage {
  from: string;
  sentAt: string;
}

/**
 * Sends email. The driver is chosen by MAIL_DRIVER (see MailModule): "log" for development and
 * tests, "smtp" for any real provider. Throwing means the send failed; the job that called it
 * fails and pg-boss retries it.
 */
export abstract class Mailer {
  /**
   * Why messages never reach anyone (the log driver in production), or null when they do. Jobs
   * check it before sending, so nothing is reported as sent that wasn't (CD-84).
   */
  readonly notDelivered: string | null = null;

  abstract send(message: MailMessage): Promise<void>;
}
