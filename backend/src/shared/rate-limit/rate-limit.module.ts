import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DEFAULT_RATE_LIMITS, RATE_LIMIT_RULES } from './policies';
import { IpRateLimitMiddleware } from './rate-limit.middleware';
import { RateLimitInterceptor } from './rate-limit.interceptor';
import { RateLimiter } from './rate-limiter';

/**
 * API rate limits (CD-18): per client IP for every request, per user for changes, and stricter
 * limits on the routes marked @RateLimit(). Over a limit the API answers 429 with Retry-After.
 * AppModule leaves this module out when RATE_LIMIT_ENABLED=false (the test suites).
 */
@Module({
  providers: [
    { provide: RateLimiter, useValue: new RateLimiter() },
    { provide: RATE_LIMIT_RULES, useValue: DEFAULT_RATE_LIMITS },
    { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
  ],
})
export class RateLimitModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(IpRateLimitMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
