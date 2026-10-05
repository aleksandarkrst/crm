import { useEffect, useRef, useState } from 'react';
import type { ApiEmployeeCard } from '../lib/api';
import { useStore } from './store';

/**
 * One employee card (CD-140), read when the page opens and kept current by the store (saving and
 * live updates). undefined while loading; null when there is no such employee for this caller;
 * 'error' when it couldn't load.
 */
export function useEmployeeCard(id: string): ApiEmployeeCard | null | undefined | 'error' {
  const { s, employeeCard } = useStore();
  const [result, setResult] = useState<{ id: string; state: 'loading' | 'done' | 'missing' | 'error' }>({ id, state: 'loading' });
  const load = useRef(employeeCard.load);
  load.current = employeeCard.load;
  useEffect(() => {
    let alive = true;
    load.current(id).then(
      (card) => alive && setResult({ id, state: card ? 'done' : 'missing' }),
      () => alive && setResult({ id, state: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [id]);
  const card = s.employeeCards[id];
  if (card) return card;
  if (result.id !== id || result.state === 'loading') return undefined;
  if (result.state === 'error') return 'error';
  return null;
}
