import { useState } from 'react';
import { type FilterValue, restoreValue } from './filters';
import { useStore } from './store';

/**
 * A page's filter row (CD-366), remembered per person, workspace and page in this browser and
 * restored on the next visit; the page's defaults when nothing (readable) was saved. `initial`
 * (a link's filters) and `remember = false` give a value that only lasts this visit.
 */
export function usePageFilters(page: string, defaults: FilterValue, initial?: FilterValue): [FilterValue, (v: FilterValue, remember?: boolean) => void] {
  const { session } = useStore();
  const key = `crm.filters.${session.userId}.${session.tenant.id}.${page}`;
  const [value, setValue] = useState<FilterValue>(() => {
    if (initial) return initial;
    try {
      const saved = localStorage.getItem(key);
      return saved ? restoreValue(JSON.parse(saved), defaults) : defaults;
    } catch {
      return defaults;
    }
  });
  const change = (v: FilterValue, remember = true) => {
    setValue(v);
    if (!remember) return;
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // No storage (private mode, blocked): the filters last until the page is left.
    }
  };
  return [value, change];
}
