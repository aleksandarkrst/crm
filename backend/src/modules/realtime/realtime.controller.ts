import { Controller, Get, Req, Res } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { decodeJwt } from 'jose';
import { type AppRequest, RequireTenant, Tenant, type TenantContext } from '../../shared/authorization';
import { DatabaseService } from '../../shared/database/database.service';
import { memberships } from '../../shared/database/schema';
import { type ChangeEvent, RealtimeService } from './realtime.service';

/** Comment lines keep proxies (nginx: 60 s, Cloudflare: 100 s) from closing an idle stream. */
const HEARTBEAT_MS = 20_000;
/** How often a stream checks that its user is still a member of the workspace. */
const MEMBERSHIP_CHECK_MS = 30_000;

/**
 * GET /api/events: a Server-Sent Events stream of change hints for the caller's workspace
 * (X-Tenant-Id; any member). The browser reads it with fetch, not EventSource, so it
 * authenticates like every other call (Authorization and X-Tenant-Id headers; no token in the
 * URL). The stream ends when the token expires or the user leaves the workspace; the browser then
 * reconnects with a fresh token, or gets 403 and stops.
 */
@Controller('events')
@RequireTenant('member')
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly database: DatabaseService,
  ) {}

  @Get()
  stream(@Tenant() ctx: TenantContext, @Req() req: AppRequest, @Res() res: Response): void {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: pass events on at once
    });
    res.flushHeaders();

    let open = true;
    const write = (chunk: string) => {
      if (open) res.write(chunk);
    };
    const send = (event: ChangeEvent) => write(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
    const unsubscribe = this.realtime.subscribe(ctx.tenantId, send);
    const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
    const membership = setInterval(() => {
      this.database.db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.userId)))
        .then((rows) => rows.length === 0 && close())
        .catch(() => undefined);
    }, MEMBERSHIP_CHECK_MS);
    const expiresIn = tokenExpiresIn(req.headers.authorization);
    const expiry = expiresIn === null ? undefined : setTimeout(() => close(), Math.min(expiresIn, 2 ** 31 - 1));

    function close() {
      if (!open) return;
      open = false;
      clearInterval(heartbeat);
      clearInterval(membership);
      clearTimeout(expiry);
      unsubscribe();
      res.end();
    }
    req.on('close', close);
    res.on('error', close);

    write('retry: 3000\n\n');
    write('event: ready\ndata: {}\n\n');
  }
}

/** Milliseconds until the (already verified) bearer token expires, or null when it doesn't say. */
function tokenExpiresIn(authorization: string | undefined): number | null {
  try {
    const exp = decodeJwt(authorization?.slice('Bearer '.length) ?? '').exp;
    return typeof exp === 'number' ? Math.max(0, exp * 1000 - Date.now()) : null;
  } catch {
    return null;
  }
}
