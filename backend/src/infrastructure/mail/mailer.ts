/** One email: plain text plus a simple HTML version of the same content. */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
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
