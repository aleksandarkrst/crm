import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { useStore } from './store';

/**
 * Visit plan numbers (CD-135) from the API: loaded when `key` changes, and counted again shortly
 * after any meeting or visit plan change (`s.visitRev`, raised by live hints, this tab's own
 * included), so marking a visit held updates every screen showing it without a reload. The last
 * numbers stay on screen while new ones load. null `key` loads nothing.
 */
export function useVisitProgress<T>(key: string | null, load: () => Promise<T>): { data: T | undefined; error: string | null; loading: boolean } {
  const { s } = useStore();
  const rev = s.visitRev;
  const [state, setState] = useState<{ key: string | null; data: T | undefined; error: string | null; loading: boolean }>({ key: null, data: undefined, error: null, loading: !!key });
  const loader = useRef(load);
  loader.current = load;
  const shown = useRef<{ key: string | null; rev: number }>({ key: null, rev });

  useEffect(() => {
    if (!key) return;
    let alive = true;
    // A new key loads at once; a change of the same numbers waits a moment (hints come in bursts).
    const sameKey = shown.current.key === key;
    shown.current = { key, rev };
    const timer = setTimeout(
      () => {
        if (!sameKey) setState((x) => ({ ...x, key, loading: true }));
        loader.current().then(
          (data) => alive && setState({ key, data, error: null, loading: false }),
          (err: unknown) => alive && setState((x) => ({ key, data: x.key === key ? x.data : undefined, error: err instanceof ApiError ? err.message : "Couldn't load the visit numbers.", loading: false })),
        );
      },
      sameKey ? 400 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, rev]);

  if (!key) return { data: undefined, error: null, loading: false };
  const current = state.key === key;
  return { data: current ? state.data : undefined, error: current ? state.error : null, loading: !current || state.loading };
}
