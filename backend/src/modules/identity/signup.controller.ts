import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../shared/authorization';
import { RateLimit } from '../../shared/rate-limit';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { SessionCookies, type SignedIn } from './session.controller';
import { SignupService } from './signup.service';

const StartBody = z.object({ email: z.email().max(254).transform((e) => e.trim().toLowerCase()) });
const Token = z.string().min(20).max(200);
const CheckBody = z.object({ token: Token });
// The provider applies its own password policy on top (Auth0: the connection's strength setting).
const CompleteBody = z.object({ token: Token, password: z.string().min(8, 'Use at least 8 characters.').max(128) });

/**
 * Having set the password, the person is signed in with it straight away. When that fails (the
 * provider is briefly away) the password is still set: the page asks them to sign in.
 */
async function signInAfter(cookies: SessionCookies, req: Request, res: Response, email: string, password: string): Promise<{ email: string } & Partial<SignedIn>> {
  try {
    return { email, ...(await cookies.passwordLogin(req, res, email, password)) };
  } catch {
    return { email };
  }
}

/**
 * Creating an account with email (CD-114). All public: the person has no account yet. The token
 * travels in the body, not the URL, so it stays out of access logs.
 */
@Controller('auth/signup')
@Public()
@RateLimit('signIn')
export class SignupController {
  constructor(
    private readonly signup: SignupService,
    private readonly cookies: SessionCookies,
  ) {}

  @Get('options')
  options() {
    return this.signup.options();
  }

  /** Sends the confirmation email. The same answer whether or not the address has an account. */
  @Post()
  @HttpCode(202)
  async start(@Body(new ZodPipe(StartBody)) body: z.infer<typeof StartBody>) {
    await this.signup.start(body.email);
    return { sent: true };
  }

  @Post('check')
  @HttpCode(200)
  check(@Body(new ZodPipe(CheckBody)) body: z.infer<typeof CheckBody>) {
    return this.signup.check(body.token);
  }

  @Post('complete')
  @HttpCode(200)
  async complete(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(new ZodPipe(CompleteBody)) body: z.infer<typeof CompleteBody>) {
    const { email } = await this.signup.complete(body.token, body.password);
    return signInAfter(this.cookies, req, res, email, body.password);
  }
}

/**
 * "Forgot password?" (CD-114): the same shape as creating an account. An emailed link that works
 * once, for an hour, then a new password, set at the provider, and the person is signed in.
 */
@Controller('auth/password')
@Public()
@RateLimit('signIn')
export class PasswordResetController {
  constructor(
    private readonly signup: SignupService,
    private readonly cookies: SessionCookies,
  ) {}

  /** Emails the link. The same answer whether or not the address has an account. */
  @Post('forgot')
  @HttpCode(202)
  async forgot(@Body(new ZodPipe(StartBody)) body: z.infer<typeof StartBody>) {
    await this.signup.startReset(body.email);
    return { sent: true };
  }

  @Post('check')
  @HttpCode(200)
  check(@Body(new ZodPipe(CheckBody)) body: z.infer<typeof CheckBody>) {
    return this.signup.check(body.token, 'reset');
  }

  @Post('reset')
  @HttpCode(200)
  async reset(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body(new ZodPipe(CompleteBody)) body: z.infer<typeof CompleteBody>) {
    const { email } = await this.signup.resetPassword(body.token, body.password);
    return signInAfter(this.cookies, req, res, email, body.password);
  }
}
