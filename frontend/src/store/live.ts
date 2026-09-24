/**
 * Live updates (CD-20): reads the workspace's change stream (GET /api/events, Server-Sent Events).
 *
 * It uses fetch, not EventSource: EventSource can't send headers, and this way the stream
 * authenticates exactly like every other call (Authorization + X-Tenant-Id, see apiHeaders)
 * instead of putting a token in the URL, where proxies and logs would keep it. fetch also lets
 * each reconnect pick up a refreshed OIDC token.
 *
 * The stream only carries hints ({ type, ids }); the store re-reads what changed. When the stream
 * drops it reconnects with backoff (1 s doubling to 30 s, with jitter) and says so through
 * `onOpen(false)`, so the store can re-read everything it may have missed. Nothing is shown to the
 * user; the store also refreshes when the window gets focus. A 403 (no longer a member) stops it.
 */
import { apiHeaders } from '../lib/api';

export interface LiveEvent {
  /** deal, company, contact, deal_line, deal_contact, task, activity, product, funnel, or resync. */
  type: string;
  op?: 'insert' | 'update' | 'delete';
  /** null: many rows changed, re-read the list. */
  ids?: string[] | null;
  dealIds?: string[] | null;
  /** The tab that made the change (see CLIENT_ID). */
  client?: string | null;
}

export function connectLive(handlers: { onEvent: (e: LiveEvent) => void; onOpen: (first: boolean) => void }): () => void {
  let stopped = false;
  let attempt = 0;
  let opened = false;
  let abort: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const reconnect = () => {
    if (stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** attempt++) * (0.75 + Math.random() / 2);
    retry = setTimeout(() => void run(), delay);
  };

  const run = async () => {
    abort = new AbortController();
    try {
      const res = await fetch('/api/events', { headers: await apiHeaders({ Accept: 'text/event-stream' }), signal: abort.signal, cache: 'no-store' });
      if (res.status === 403) return; // not a member of this workspace (any more)
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n');
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (event === 'ready') {
            attempt = 0;
            handlers.onOpen(!opened);
            opened = true;
          } else if (event === 'change' && data) {
            try {
              handlers.onEvent(JSON.parse(data) as LiveEvent);
            } catch {
              // a malformed hint is skipped; the next refresh catches up
            }
          }
        }
      }
    } catch {
      // dropped, offline or aborted: reconnect quietly (below)
    }
    if (!stopped) reconnect();
  };

  void run();
  return () => {
    stopped = true;
    clearTimeout(retry);
    abort?.abort();
  };
}
