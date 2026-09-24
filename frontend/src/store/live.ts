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

/** Starts the stream; the returned function stops it. */
export function connectLive(handlers: LiveHandlers): () => void {
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
