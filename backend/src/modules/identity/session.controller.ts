import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Injectable, Post, Query, Req, Res, UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ENV, type Env } from '../../infrastructure/config/config.module';
import { Public } from '../../shared/authorization';
import { RateLimit } from '../../shared/rate-limit';
import { pkce, SessionError, SessionProvider, type SessionTokens } from './sessions';

/** The refresh token. httpOnly, so page scripts never see it; only sent to /api/auth. */
const SESSION_COOKIE = 'crm_session';
/** State and PKCE verifier of a Google sign-in on its way, for the callback. */
const OAUTH_COOKIE = 'crm_oauth';
const SESSION_DAYS = 30;

const STATUS: Record<SessionError['reason'], number> = {
  credentials: HttpStatus.UNAUTHORIZED,
  expired: HttpStatus.UNAUTHORIZED,
  blocked: HttpStatus.FORBIDDEN,
  reset: HttpStatus.FORBIDDEN,
  'too-many': HttpStatus.TOO_MANY_REQUESTS,
  unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};
export const sessionProblem = (err: SessionError) => new HttpException({ statusCode: STATUS[err.reason], code: err.reason, message: err.message }, STATUS[err.reason]);

/** What the browser gets back from signing in: the access token only. */
export interface SignedIn {
  accessToken: string;
  expiresIn: number;
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Only JSON requests may sign in, renew or sign out: a page on another site can't send one without
 * a CORS preflight, which this API refuses. With SameSite=Strict on the cookie, that rules out
 * cross-site request forgery.
 */
function requireJson(req: Request) {
  if (!req.is('application/json')) throw new UnsupportedMediaTypeException('Send JSON');
}

/** Sets and clears the session cookie; shared with the sign-up and password-reset routes, which sign in at the end. */
@Injectable()
export class SessionCookies {
  private readonly secure: boolean;

  constructor(
    private readonly sessions: SessionProvider,
    @Inject(ENV) env: Env,
  ) {
    this.secure = env.NODE_ENV === 'production' || env.APP_URL.startsWith('https:');
  }

  /** Signs in with a password and sets the cookie. */
  async passwordLogin(req: Request, res: Response, email: string, password: string): Promise<SignedIn> {
    try {
      return this.start(res, await this.sessions.passwordLogin(email, password, req.ip ?? req.socket.remoteAddress ?? ''));
    } catch (err) {
      throw err instanceof SessionError ? sessionProblem(err) : err;
    }
  }

  start(res: Response, tokens: SessionTokens): SignedIn {
    if (tokens.refreshToken) {
      res.cookie(SESSION_COOKIE, tokens.refreshToken, { httpOnly: true, secure: this.secure, sameSite: 'strict', path: '/api/auth', maxAge: SESSION_DAYS * 86_400_000 });
    }
    return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
  }

  end(res: Response) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: this.secure, sameSite: 'strict', path: '/api/auth' });
  }

  oauthCookie(res: Response, value: string | null) {
    const options = { httpOnly: true, secure: this.secure, sameSite: 'lax' as const, path: '/api/auth' };
    // Lax: the browser comes back from Google with a top-level GET, which Strict would leave bare.
    if (value) res.cookie(OAUTH_COOKIE, value, { ...options, maxAge: 10 * 60_000 });
    else res.clearCookie(OAUTH_COOKIE, options);
  }
}

const LoginBody = z.object({
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});
const OAuthState = z.object({ state: z.string(), verifier: z.string(), popup: z.boolean() });

/**
 * Signing in on Pultly's own pages (CD-114). The browser holds only a short-lived access token in
 * memory; the refresh token stays in an httpOnly cookie and /auth/refresh swaps it for a new one.
 */
@Controller('auth')
@Public()
export class SessionController {
  private readonly redirectUri: string;

  constructor(
    private readonly sessions: SessionProvider,
    private readonly cookies: SessionCookies,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.redirectUri = `${env.APP_URL.replace(/\/+$/, '')}/api/auth/callback`;
  }

  @Post('login')
  @HttpCode(200)
  @RateLimit('signIn')
  login(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() raw: unknown): Promise<SignedIn> {
    // Before validating: a form post has no JSON body, and should be told 415, not 400.
    requireJson(req);
    const body = LoginBody.safeParse(raw);
    if (!body.success) throw new BadRequestException('Enter your email and password.');
    return this.cookies.passwordLogin(req, res, body.data.email, body.data.password);
  }

  /** A new access token for the session in the cookie; 401 when there is none or it ended. */
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SignedIn> {
    requireJson(req);
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) throw sessionProblem(new SessionError('expired', 'Sign in to continue.'));
    try {
      return this.cookies.start(res, await this.sessions.refresh(token));
    } catch (err) {
      if (!(err instanceof SessionError)) throw err;
      if (err.reason === 'expired') this.cookies.end(res);
      throw sessionProblem(err);
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    requireJson(req);
    const token = readCookie(req, SESSION_COOKIE);
    this.cookies.end(res);
    if (token) await this.sessions.revoke(token);
  }

  /**
   * "Continue with Google": off to Google's account picker. `popup=1` when signing in again over
   * an open page (CD-88), so the callback closes the window instead of loading the app.
   */
  @Get('google')
  @RateLimit('signIn')
  google(@Query('popup') popup: string | undefined, @Res() res: Response) {
    const connection = this.env.AUTH_GOOGLE_CONNECTION;
    if (!this.sessions.available || this.env.AUTH_MODE !== 'oidc' || !connection) return res.redirect(303, '/auth/callback?result=unavailable');
    const state = randomBytes(24).toString('base64url');
    const { verifier, challenge } = pkce();
    this.cookies.oauthCookie(res, JSON.stringify({ state, verifier, popup: popup === '1' }));
    return res.redirect(303, this.sessions.authorizeUrl({ connection, redirectUri: this.redirectUri, state, challenge }));
  }

  /** Back from Google (through the provider). Always ends on the app's /auth/callback page, which shows how it went. */
  @Get('callback')
  async callback(@Req() req: Request, @Res() res: Response, @Query() query: Record<string, string | undefined>) {
    const saved = OAuthState.safeParse(parseJson(readCookie(req, OAUTH_COOKIE)));
    this.cookies.oauthCookie(res, null);
    const popup = saved.success && saved.data.popup;
    const done = (result: string) => res.redirect(303, `/auth/callback?result=${result}${popup ? '&popup=1' : ''}`);
    if (query.error) return done(query.error === 'access_denied' ? 'cancelled' : 'failed');
    if (!saved.success || !query.code || query.state !== saved.data.state) return done('failed');
    try {
      this.cookies.start(res, await this.sessions.exchangeCode({ code: query.code, verifier: saved.data.verifier, redirectUri: this.redirectUri }));
    } catch (err) {
      if (!(err instanceof SessionError)) throw err;
      return done('failed');
    }
    return done('ok');
  }
}

function parseJson(value: string | null): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
