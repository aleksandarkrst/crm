import { type ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { reportError } from './error-tracking';

/**
 * Reports unexpected errors (anything that becomes a 5xx) to error tracking, then answers exactly
 * as Nest would. 4xx are the client's mistakes (validation, permissions, conflicts, rate limits)
 * and are not reported. Neither is the 503 of /api/health/ready while the database is down: the
 * uptime monitor alerts on that, and it would report every check.
 */
@Catch()
export class ErrorReportingFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const req = host.getType() === 'http' ? host.switchToHttp().getRequest<Request & { user?: { id: string }; route?: { path?: string } }>() : undefined;
    if (req && status >= 500 && !req.originalUrl?.startsWith('/api/health')) {
      reportError(exception, {
        tags: { method: req.method, route: req.route?.path ?? 'unknown', status: String(status) },
        userId: req.user?.id,
      });
    }
    super.catch(exception, host);
  }
}
