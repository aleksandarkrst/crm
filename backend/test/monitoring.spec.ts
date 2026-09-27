import { type ArgumentsHost, BadRequestException, HttpException, HttpStatus, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { ErrorEvent } from '@sentry/node';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorReportingFilter } from '../src/infrastructure/monitoring/error-reporting.filter';
import { reportError, scrubEvent, scrubUrl } from '../src/infrastructure/monitoring/error-tracking';

vi.mock('../src/infrastructure/monitoring/error-tracking', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reportError: vi.fn(),
}));

describe('scrubUrl', () => {
  it('cuts invitation tokens and query strings out of URLs', () => {
    expect(scrubUrl('https://app.example.com/api/invitations/abc_DEF-123456789012345/accept')).toBe('https://app.example.com/api/invitations/[token]/accept');
    expect(scrubUrl('https://app.example.com/invite/abc_DEF-123456789012345')).toBe('https://app.example.com/invite/[token]');
    expect(scrubUrl('/callback?code=secret&state=x')).toBe('/callback');
    expect(scrubUrl('/api/crm/deals/5#x')).toBe('/api/crm/deals/5');
  });
});

describe('scrubEvent', () => {
  it('keeps method, URL and user id, and drops everything else that identifies someone', () => {
    const event = {
      type: undefined,
      server_name: 'a1b2c3',
      user: { id: 'u-1', email: 'ana@example.com', ip_address: '203.0.113.9' },
      request: {
        method: 'POST',
        url: 'https://app.example.com/api/invitations/tok_123456789012345678901/accept',
        data: '{"email":"ana@example.com"}',
        headers: { authorization: 'Bearer x', cookie: 'y' },
        cookies: { a: 'b' },
        query_string: 'q=1',
      },
    } as ErrorEvent;
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request).toEqual({ method: 'POST', url: 'https://app.example.com/api/invitations/[token]/accept' });
    expect(scrubbed.user).toEqual({ id: 'u-1' });
    expect(scrubbed.server_name).toBeUndefined();
  });
});

describe('ErrorReportingFilter', () => {
  const superCatch = vi.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation(() => undefined);
  const hostFor = (req: object) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ArgumentsHost;
  const host = hostFor({ method: 'PATCH', originalUrl: '/api/crm/deals/5', route: { path: '/api/crm/deals/:id' }, user: { id: 'u-1' } });
  const filter = new ErrorReportingFilter();

  beforeEach(() => vi.mocked(reportError).mockClear());
  afterAll(() => superCatch.mockRestore());

  it('reports crashes and 5xx with the route and user id, then answers as Nest does', () => {
    const crash = new TypeError('x is undefined');
    filter.catch(crash, host);
    expect(reportError).toHaveBeenCalledWith(crash, { tags: { method: 'PATCH', route: '/api/crm/deals/:id', status: '500' }, userId: 'u-1' });
    filter.catch(new InternalServerErrorException(), host);
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(superCatch).toHaveBeenCalledWith(crash, host);
  });

  it("doesn't report the client's mistakes", () => {
    filter.catch(new BadRequestException('bad'), host);
    filter.catch(new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS), host);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("doesn't report the readiness check failing (the uptime monitor alerts on that)", () => {
    filter.catch(new ServiceUnavailableException(), hostFor({ method: 'GET', originalUrl: '/api/health/ready' }));
    expect(reportError).not.toHaveBeenCalled();
  });
});
