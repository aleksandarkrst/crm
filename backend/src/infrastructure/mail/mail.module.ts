import { Controller, Get, Global, Inject, Logger, Module, Query } from '@nestjs/common';
import { join, resolve } from 'node:path';
import { ENV, type Env } from '../config/config.module';
import { LogMailer, readOutbox } from './log-mailer';
import { Mailer } from './mailer';
import { SmtpMailer } from './smtp-mailer';

/** Where the log driver keeps messages outside production, so tests and developers can read them. */
export const outboxFileOf = (env: Env): string | null => (env.NODE_ENV === 'production' ? null : join(resolve(env.STORAGE_DIR), 'dev-mail', 'outbox.jsonl'));

/** What an owner sees on an invitation that couldn't be emailed because no provider is set up. */
export const MAIL_NOT_SET_UP = "Email isn't set up on this server yet. Copy the invite link and send it yourself.";

export function createMailer(env: Env): Mailer {
  if (env.MAIL_DRIVER === 'smtp') return new SmtpMailer(env.SMTP_URL!, env.MAIL_FROM);
  if (env.NODE_ENV !== 'production') return new LogMailer(env.MAIL_FROM, outboxFileOf(env));
  new Logger('Mail').warn('MAIL_DRIVER=log in production: no email is delivered (docs/DEPLOYMENT.md, "Email")');
  return new LogMailer(env.MAIL_FROM, null, MAIL_NOT_SET_UP);
}

/** Email sending (see Mailer). Inject `Mailer`. */
@Global()
@Module({
  providers: [{ provide: Mailer, inject: [ENV], useFactory: createMailer }],
  exports: [Mailer],
})
export class MailModule {}

/**
 * Development only (registered when AUTH_MODE=dev, which production refuses): the messages the
 * log driver "sent", newest first, optionally only those to one address. Any signed-in user can
 * read them, which is fine where anyone can sign in as anyone.
 */
@Controller('dev/mail')
export class DevMailController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  async list(@Query('to') to?: string) {
    const file = outboxFileOf(this.env);
    const mails = file ? await readOutbox(file) : [];
    const wanted = to?.trim().toLowerCase();
    return mails.filter((m) => !wanted || m.to.toLowerCase() === wanted).reverse();
  }
}

@Module({ controllers: [DevMailController] })
export class DevMailModule {}
