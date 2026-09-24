/**
 * The live-update stream in a dedicated worker (CD-20). The page asks it to start and answers its
 * requests for the API headers (the token lives on the page); it passes the change hints back.
 * Off the page, the long-lived request doesn't count as page activity: the page's own network
 * goes idle as before, which tools that wait for "network idle" (the e2e tests) rely on.
 */
import { streamEvents } from './liveStream';

export type ToWorker = { kind: 'start' } | { kind: 'stop' } | { kind: 'headers'; id: number; headers: Record<string, string> };
export type FromWorker = { kind: 'headers?'; id: number } | { kind: 'open'; first: boolean } | { kind: 'event'; event: import('./liveStream').LiveEvent };

const scope = self as unknown as { postMessage: (m: FromWorker) => void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const waiting = new Map<number, (headers: Record<string, string>) => void>();
let seq = 0;
let stop: (() => void) | null = null;

const getHeaders = () =>
  new Promise<Record<string, string>>((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    scope.postMessage({ kind: 'headers?', id });
  });

scope.onmessage = ({ data }) => {
  if (data.kind === 'headers') {
    waiting.get(data.id)?.(data.headers);
    waiting.delete(data.id);
  } else if (data.kind === 'start' && !stop) {
    stop = streamEvents(getHeaders, {
      onEvent: (event) => scope.postMessage({ kind: 'event', event }),
      onOpen: (first) => scope.postMessage({ kind: 'open', first }),
    });
  } else if (data.kind === 'stop') {
    stop?.();
    stop = null;
  }
};
