import { HttpException, HttpStatus, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { RateRule } from './rate-limiter';

export interface RateLimitRules {
  /** Every request from one client IP, checked before authentication (floods, token guessing). */
  ip: RateRule;
  /** Sign-in-related routes, per client IP: dev login, opening and accepting an invitation. */
  signIn: RateRule;
  /** Changes (POST, PUT, PATCH, DELETE) per signed-in user. */
  write: RateRule;
  /** Routes that send email, per user: invitations and resends. */
  email: RateRule;
  /** Expensive routes, per user: CSV import, documents, sample data, new workspaces. */
  heavy: RateRule;
}

/**
 * Far above what one person does in the app. The IP limit leaves room for an office sharing one
 * address, whose tabs each page through every list on startup.
 */
export const DEFAULT_RATE_LIMITS: RateLimitRules = {
  ip: { limit: 1200, windowMs: 60_000 },
  signIn: { limit: 20, windowMs: 10 * 60_000 },
  write: { limit: 120, windowMs: 60_000 },
  email: { limit: 20, windowMs: 60 * 60_000 },
  heavy: { limit: 30, windowMs: 10 * 60_000 },
};

/** Injection token for the rules in force (tests replace them with small numbers). */
export const RATE_LIMIT_RULES = Symbol('RATE_LIMIT_RULES');

export type RateLimitPolicy = 'signIn' | 'email' | 'heavy';
export const RATE_LIMIT_POLICY = 'rateLimit:policy';

/**
 * An extra, stricter limit for a route, on top of the IP limit and (for changes) the write limit.
 * Apply to a controller or a single route; the route-level value wins.
 */
export const RateLimit = (policy: RateLimitPolicy) => SetMetadata(RATE_LIMIT_POLICY, policy);

/**
 * The client's address. main.ts trusts X-Forwarded-For, which nginx sets to the address it got
 * from Cloudflare's CF-Connecting-IP; the API itself is not reachable from outside.
 */
export const clientIp = (req: Request): string => req.ip ?? req.socket.remoteAddress ?? 'unknown';

export const tooManyRequests = (retryAfterSeconds: number) =>
  new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: `Too many requests. Try again in ${retryAfterSeconds} seconds.` },
    HttpStatus.TOO_MANY_REQUESTS,
  );
