import { createTransport, type Transporter } from 'nodemailer';
import { type MailMessage, Mailer } from './mailer';

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

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  }
}
