import { useState } from 'react';
import { useStore } from './store';

export type BoardView = 'board' | 'table';

/**
 * A page's Kanban / Table choice, remembered per person and workspace in this browser: the
 * Pipeline (CD-274, key `crm.pipelineView`) and Companies (CD-359, `crm.companiesView`).
 */
export function useBoardView(prefix: 'crm.pipelineView' | 'crm.companiesView'): [BoardView, (v: BoardView) => void] {
  const { session } = useStore();
  const key = `${prefix}.${session.userId}.${session.tenant.id}`;
  const [view, setView] = useState<BoardView>(() => {
    try {
      return localStorage.getItem(key) === 'table' ? 'table' : 'board';
    } catch {
      return 'board';
    }
  });
  const choose = (v: BoardView) => {
    setView(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      // No storage (private mode, blocked): the choice lasts until the page is left.
    }
  };
  return [view, choose];
}
