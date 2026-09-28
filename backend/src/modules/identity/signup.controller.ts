import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../../shared/authorization';
import { RateLimit } from '../../shared/rate-limit';
import { ZodPipe } from '../../shared/validation/zod-validation.pipe';
import { SignupService } from './signup.service';

const StartBody = z.object({ email: z.email().max(254).transform((e) => e.trim().toLowerCase()) });
const Token = z.string().min(20).max(200);
const CheckBody = z.object({ token: Token });
// The provider applies its own password policy on top (Auth0: the connection's strength setting).
const CompleteBody = z.object({ token: Token, password: z.string().min(8, 'Use at least 8 characters.').max(128) });

/**
 * Creating an account with email (CD-114). All public: the person has no account yet. The token
 * travels in the body, not the URL, so it stays out of access logs.
 */
@Controller('auth/signup')
@Public()
@RateLimit('signIn')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

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
  complete(@Body(new ZodPipe(CompleteBody)) body: z.infer<typeof CompleteBody>) {
    return this.signup.complete(body.token, body.password);
  }
}
