import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import { type CanActivate, Controller, type ExecutionContext, Get, type INestApplication, Injectable, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRequest } from '../src/shared/authorization';
import { RATE_LIMIT_RULES, RateLimit, RateLimitModule, RateLimiter, type RateLimitRules } from '../src/shared/rate-limit';

describe('RateLimiter', () => {
  const rule = { limit: 2, windowMs: 10_000 };

  it('allows up to the limit per window, then says how long to wait', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(() => now);
    expect(limiter.hit('a', rule).allowed).toBe(true);
    expect(limiter.hit('a', rule).allowed).toBe(true);
    now += 2_500;
    expect(limiter.hit('a', rule)).toEqual({ allowed: false, retryAfterSeconds: 8 });
  });

  it('starts a new window once the old one ends', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) limiter.hit('a', rule);
    expect(limiter.hit('a', rule).allowed).toBe(false);
    now = 10_000;
    expect(limiter.hit('a', rule).allowed).toBe(true);
  });

  it('counts each key on its own', () => {
    const limiter = new RateLimiter(() => 0);
    limiter.hit('a', rule);
    limiter.hit('a', rule);
    expect(limiter.hit('a', rule).allowed).toBe(false);
    expect(limiter.hit('b', rule).allowed).toBe(true);
  });

  it('forgets finished windows', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 999; i++) limiter.hit(`client-${i}`, rule);
    expect(limiter.size).toBe(999);
    now = 10_000;
    limiter.hit('late', rule); // the 1000th hit sweeps
    expect(limiter.size).toBe(1);
  });
});

/** Stands in for AuthGuard: `x-user` signs the request in as that user. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const user = req.headers['x-user'];
    if (typeof user === 'string') req.user = { id: user, email: `${user}@example.test`, displayName: user } as AppRequest['user'];
    if (req.headers['x-reject'] === '1') return false;
    return true;
  }
}

@Controller()
class TestController {
  @Get('health/ready')
  health() {
    return { ok: true };
  }

  @Get('things')
  list() {
    return [];
  }

  @Post('things')
  create() {
    return { id: 1 };
  }

  @Post('login')
  @RateLimit('signIn')
  login() {
    return { token: 't' };
  }

  @Post('invite')
  @RateLimit('email')
  invite() {
    return { sent: true };
  }
}

const RULES: RateLimitRules = {
  ip: { limit: 12, windowMs: 60_000 },
  signIn: { limit: 2, windowMs: 60_000 },
  write: { limit: 3, windowMs: 60_000 },
  email: { limit: 1, windowMs: 60_000 },
  heavy: { limit: 1, windowMs: 60_000 },
};

describe('RateLimitModule', () => {
  let app: INestApplication;
  let base: string;

  // A fresh app (fresh counters) per test group: the IP limit is shared by every request here.
  async function start() {
    const moduleRef = await Test.createTestingModule({
      imports: [RateLimitModule],
      controllers: [TestController],
      providers: [{ provide: APP_GUARD, useClass: FakeAuthGuard }],
    })
      .overrideProvider(RATE_LIMIT_RULES)
      .useValue(RULES)
      .overrideProvider(RateLimiter)
      .useValue(new RateLimiter())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  }

  const send = (method: string, path: string, user?: string, extra: Record<string, string> = {}) =>
    fetch(base + path, { method, headers: { ...(user ? { 'x-user': user } : {}), ...extra } });

  describe('per user and per route', () => {
    beforeAll(start);
    afterAll(() => app.close());

    it('limits changes per user, with Retry-After and a readable message', async () => {
      for (let i = 0; i < 3; i++) expect((await send('POST', '/things', 'ana')).status).toBe(201);
      const blocked = await send('POST', '/things', 'ana');
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(((await blocked.json()) as { message: string }).message).toMatch(/^Too many requests\. Try again in \d+ seconds\.$/);
    });

    it("doesn't count one user's changes against another, or reads against changes", async () => {
      expect((await send('POST', '/things', 'bo')).status).toBe(201);
      expect((await send('GET', '/things', 'ana')).status).toBe(200);
    });

    it('applies a route policy on top of the write limit', async () => {
      expect((await send('POST', '/invite', 'cy')).status).toBe(201);
      expect((await send('POST', '/invite', 'cy')).status).toBe(429);
    });
  });

  describe('sign-in and per IP', () => {
    beforeAll(start);
    afterAll(() => app.close());

    it('limits sign-in routes per IP, whoever signs in', async () => {
      expect((await send('POST', '/login')).status).toBe(201);
      expect((await send('POST', '/login', 'dee')).status).toBe(201);
      expect((await send('POST', '/login', 'eve')).status).toBe(429);
    });

    it('counts every request per IP before auth, rejected ones too, but never health checks', async () => {
      // 3 requests so far; the guard turns these down, yet they count.
      for (let i = 0; i < 9; i++) expect((await send('GET', '/things', undefined, { 'x-reject': '1' })).status).toBe(403);
      expect((await send('GET', '/things', 'fay')).status).toBe(429);
      expect((await send('GET', '/health/ready')).status).toBe(200);
    });
  });
});
