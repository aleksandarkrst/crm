import * as Sentry from '@sentry/node';
import { loadEnv } from '../config/env';

/**
 * Error tracking with Sentry (CD-8), off unless SENTRY_DSN is set. Only unexpected failures are
 * reported: 5xx responses, jobs that failed their last attempt, and crashes. Nothing that
 * identifies a person leaves the server: no request bodies, headers, cookies or IP addresses, and
 * invitation tokens are cut out of URLs. The user is sent as their internal id only.
 */
let enabled = false;

export function initErrorTracking(service: 'api' | 'worker'): void {
  const env = loadEnv();
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.APP_VERSION && env.APP_VERSION !== 'latest' ? env.APP_VERSION : undefined,
    // Sentry collects all of these by default. Local variables of stack frames would carry CRM data.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    // Errors only: no performance tracing, which would also send every request.
    tracesSampleRate: 0,
    initialScope: { tags: { service } },
    beforeSend: scrubEvent,
    beforeBreadcrumb: (breadcrumb) => (breadcrumb.data?.url ? { ...breadcrumb, data: { ...breadcrumb.data, url: scrubUrl(String(breadcrumb.data.url)) } } : breadcrumb),
  });
  enabled = true;
}

export interface ErrorContext {
  tags?: Record<string, string>;
  userId?: string;
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  if (!enabled) return;
  Sentry.captureException(error, { tags: context.tags, user: context.userId ? { id: context.userId } : undefined });
}

/** Invitation tokens are secrets; query strings may carry sign-in codes. */
export function scrubUrl(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/\/(invite|invitations)\/[^/]+/g, '/$1/[token]');
}

/** Keeps a report to what's needed to find the bug (see the note at the top). */
export function scrubEvent<E extends Sentry.ErrorEvent>(event: E): E {
  if (event.request) {
    event.request = {
      method: event.request.method,
      url: event.request.url ? scrubUrl(event.request.url) : undefined,
    };
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  delete event.server_name;
  return event;
}
