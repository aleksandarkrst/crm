/**
 * Error tracking with Sentry (CD-8), only in builds with VITE_SENTRY_DSN. The SDK loads after the
 * app has started, so it never slows the first screen; errors from before that wait in a short
 * queue. Nothing that identifies a person is sent: no user, cookies, headers or bodies, and
 * invitation tokens and query strings (sign-in codes) are cut out of URLs.
 */
import type { ErrorEvent, Breadcrumb } from '@sentry/react';

const DSN = import.meta.env.VITE_SENTRY_DSN;

type Extra = Record<string, unknown>;
let capture: ((error: unknown, extra?: Extra) => void) | null = null;
const early: [unknown, Extra | undefined][] = [];

/** Reports an error that would otherwise only reach the console. */
export function reportError(error: unknown, extra?: Extra): void {
  if (!DSN) return;
  if (capture) capture(error, extra);
  else if (early.length < 20) early.push([error, extra]);
}

export function startErrorTracking(): void {
  if (!DSN) return;
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: DSN,
      release: import.meta.env.VITE_APP_VERSION || undefined,
      environment: import.meta.env.MODE,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
      },
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    capture = (error, extra) => Sentry.captureException(error, { extra });
    for (const [error, extra] of early.splice(0)) capture(error, extra);
  });
}

export function scrubUrl(url: string): string {
  return url.replace(/[?#].*$/, '').replace(/\/(invite|invitations)\/[^/]+/g, '/$1/[token]');
}

function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) event.request = { url: event.request.url ? scrubUrl(event.request.url) : undefined };
  delete event.user;
  return event;
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const data = breadcrumb.data;
  if (!data) return breadcrumb;
  const scrubbed = { ...data };
  for (const key of ['url', 'from', 'to']) if (typeof scrubbed[key] === 'string') scrubbed[key] = scrubUrl(scrubbed[key]);
  return { ...breadcrumb, data: scrubbed };
}
