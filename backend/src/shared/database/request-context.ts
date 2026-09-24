import { AsyncLocalStorage } from 'node:async_hooks';
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AppRequest } from '../authorization';

/**
 * Who is acting in the current request: the signed-in user and the browser tab (X-Client-Id).
 * DatabaseService.withTenant hands both to PostgreSQL (app.user_id, app.client_id), where the
 * change-history triggers record them and the live-update triggers pass the tab on, so a tab can
 * skip the echo of its own changes. Outside a request (worker jobs) both are unset: "the system".
 */
export interface RequestActor {
  userId?: string;
  clientId?: string;
}

export const requestActor = new AsyncLocalStorage<RequestActor>();

/** A tab id is an opaque token the browser makes up; anything else is ignored. */
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Global interceptor (runs after the auth guard, so the user is known). */
@Injectable()
export class RequestActorInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers['x-client-id'];
    const actor: RequestActor = {
      userId: req.tenant?.userId ?? req.user?.id,
      clientId: typeof header === 'string' && CLIENT_ID_RE.test(header) ? header : undefined,
    };
    return new Observable((subscriber) => requestActor.run(actor, () => next.handle().subscribe(subscriber)));
  }
}
