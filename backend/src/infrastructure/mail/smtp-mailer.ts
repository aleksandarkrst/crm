import { createTransport, type Transporter } from 'nodemailer';
import { fromHeader, type MailMessage, type MailResult, Mailer } from './mailer';

/**
 * MAIL_DRIVER=smtp: sends through any SMTP server (Postmark, Resend, SES, Mailgun and most others
 * offer one). SMTP_URL holds host, port and credentials, e.g.
 * smtps://USER:PASSWORD@smtp.example.com:465 or smtp://USER:PASSWORD@smtp.example.com:587.
 */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<MailResult> {
    const info: { rejected?: (string | { address: string })[] } = await this.transport.sendMail({
      from: fromHeader(message, this.from),
      to: message.to,
      cc: message.cc?.length ? message.cc : undefined,
      replyTo: message.replyTo,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    return { rejected: (info.rejected ?? []).map((r) => (typeof r === 'string' ? r : r.address)) };
  }
}
