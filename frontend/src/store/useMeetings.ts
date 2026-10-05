import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiMeeting, MeetingQuery } from '../lib/api';
import { meetingKey } from './meetings';
import { useStore } from './store';

/**
 * The meetings of a query (CD-130), kept current by the store: saving and live updates change the
 * list without loading it again. `query` may be a new object on every render; its key decides
 * when it is loaded. null loads nothing.
 */
export function useMeetingList(query: MeetingQuery | null): { meetings: ApiMeeting[]; loading: boolean; more: boolean; error: string | null } {
  const { s, meetings: actions } = useStore();
  const key = query ? meetingKey(query) : '';
  // The store's action object is rebuilt on navigation; the list is (re)loaded only when the key changes.
  const watch = useRef(actions.watch);
  watch.current = actions.watch;
  const latest = useRef(query);
  latest.current = query;
  useEffect(() => {
    if (!key || !latest.current) return;
    return watch.current(key, latest.current);
  }, [key]);
  const list = key ? s.meetingLists[key] : undefined;
  const cache = s.meetings;
  const rows = useMemo(() => (list ? list.ids.map((id) => cache[id]).filter((m): m is ApiMeeting => !!m) : []), [list, cache]);
  return { meetings: rows, loading: !!key && (!list || list.loading), more: !!list?.more, error: list?.error ?? null };
}

/**
 * One meeting (its page), read when the page opens and kept current by live updates. undefined
 * while loading; null when there is no such meeting (or it was deleted); 'error' when it couldn't load.
 */
export function useMeeting(id: string): ApiMeeting | null | undefined | 'error' {
  const { s, meetings: actions } = useStore();
  const [result, setResult] = useState<{ id: string; state: 'loading' | 'done' | 'missing' | 'error' }>({ id, state: 'loading' });
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    let alive = true;
    const stop = ref.current.view(id);
    ref.current.fetchOne(id).then(
      (m) => alive && setResult({ id, state: m ? 'done' : 'missing' }),
      () => alive && setResult({ id, state: 'error' }),
    );
    return () => {
      alive = false;
      stop();
    };
  }, [id]);
  const m = s.meetings[id];
  if (m) return m;
  if (result.id !== id || result.state === 'loading') return undefined;
  if (result.state === 'error') return 'error';
  return null;
}
