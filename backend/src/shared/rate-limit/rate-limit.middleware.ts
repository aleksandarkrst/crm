import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RATE_LIMIT_RULES, type RateLimitRules, clientIp, tooManyRequests } from './policies';
import { RateLimiter } from './rate-limiter';

/**
 * Counts every API request per client IP. A middleware, so it runs before the auth guard and also
 * counts requests with bad tokens. Health checks are left out so monitoring never sees a 429.
 */
@Injectable()
export class IpRateLimitMiddleware implements NestMiddleware {
  constructor(
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(RATE_LIMIT_RULES) private readonly rules: RateLimitRules,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (req.originalUrl.startsWith('/api/health')) return next();

    const verdict = this.limiter.hit(`ip:${clientIp(req)}`, this.rules.ip);
    if (verdict.allowed) return next();

    const error = tooManyRequests(verdict.retryAfterSeconds);
    res.setHeader('Retry-After', String(verdict.retryAfterSeconds));
    res.status(error.getStatus()).json(error.getResponse());
  }
}
