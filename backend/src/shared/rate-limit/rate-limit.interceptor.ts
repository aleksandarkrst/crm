import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import type { AppRequest } from '../authorization';
import { RATE_LIMIT_POLICY, RATE_LIMIT_RULES, type RateLimitPolicy, type RateLimitRules, clientIp, tooManyRequests } from './policies';
import { RateLimiter, type RateRule } from './rate-limiter';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The per-route and per-user limits. A global interceptor, so it runs after the auth guard and
 * knows the user: changes are counted per user, not per address, so colleagues behind one office
 * IP don't use up each other's allowance. Sign-in routes are counted per IP.
 */
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(RATE_LIMIT_RULES) private readonly rules: RateLimitRules,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AppRequest>();
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(RATE_LIMIT_POLICY, [context.getHandler(), context.getClass()]);
    const client = req.user ? `user:${req.user.id}` : `ip:${clientIp(req)}`;

    const checks: [string, RateRule][] = [];
    if (policy === 'signIn') checks.push([`signIn:ip:${clientIp(req)}`, this.rules.signIn]);
    else if (policy) checks.push([`${policy}:${client}`, this.rules[policy]]);
    if (req.user && WRITE_METHODS.has(req.method)) checks.push([`write:${client}`, this.rules.write]);

    for (const [key, rule] of checks) {
      const verdict = this.limiter.hit(key, rule);
      if (!verdict.allowed) {
        context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(verdict.retryAfterSeconds));
        throw tooManyRequests(verdict.retryAfterSeconds);
      }
    }
    return next.handle();
  }
}
