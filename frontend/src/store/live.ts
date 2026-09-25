/**
 * Live updates (CD-20): connects the store to the workspace's change stream (see liveStream.ts).
 * The stream runs in a worker (live.worker.ts); the page supplies the API headers, so the token
 * stays where it is refreshed. Without worker support it runs on the page.
 */
import { apiHeaders } from '../lib/api';
import type { FromWorker, ToWorker } from './live.worker';
import { type LiveEvent, type LiveHandlers, streamEvents } from './liveStream';

export type { LiveEvent };

const headers = async () => Object.fromEntries((await apiHeaders({ Accept: 'text/event-stream' })).entries());

/**
 * Starts the stream; the returned function stops it. Leaving the page (a reload, a sign-in
 * redirect) closes the stream at once: the browser can keep a left page alive for back/forward,
 * and a stream per left page would use up its few connections to the server, so later requests
 * would wait forever. Coming back reconnects and reports it as a reconnect, so the store re-reads
 * what it missed.
 */
export function connectLive(handlers: LiveHandlers): () => void {
  let stop: (() => void) | null = null;
  let resumed = false;
  const start = () => {
    stop = openStream({ ...handlers, onOpen: (first) => handlers.onOpen(first && !resumed) });
  };
  const onHide = () => {
    stop?.();
    stop = null;
  };
  const onShow = (e: PageTransitionEvent) => {
    if (!e.persisted || stop) return;
    resumed = true;
    start();
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);
  start();
  return () => {
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('pageshow', onShow);
    onHide();
  };
}

function openStream(handlers: LiveHandlers): () => void {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./live.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return streamEvents(headers, handlers);
  }
  const send = (m: ToWorker) => worker.postMessage(m);
  worker.onmessage = ({ data }: MessageEvent<FromWorker>) => {
    if (data.kind === 'headers?') void headers().then((h) => send({ kind: 'headers', id: data.id, headers: h }));
    else if (data.kind === 'open') handlers.onOpen(data.first);
    else if (data.kind === 'event') handlers.onEvent(data.event);
  };
  send({ kind: 'start' });
  return () => {
    send({ kind: 'stop' });
    worker.terminate();
  };
}
