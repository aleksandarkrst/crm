import { useState } from 'react';

export type PipelineView = 'board' | 'table';

const viewKey = (userId: string, tenantId: string) => `crm.pipelineView.${userId}.${tenantId}`;

/** The Kanban / Table choice, remembered per person and workspace in this browser (CD-274). */
export function usePipelineView(userId: string, tenantId: string): [PipelineView, (v: PipelineView) => void] {
  const [view, setView] = useState<PipelineView>(() => {
    try {
      return localStorage.getItem(viewKey(userId, tenantId)) === 'table' ? 'table' : 'board';
    } catch {
      return 'board';
    }
  });
  const choose = (v: PipelineView) => {
    setView(v);
    try {
      localStorage.setItem(viewKey(userId, tenantId), v);
    } catch {
      // No storage (private mode, blocked): the choice lasts until the page is left.
    }
  };
  return [view, choose];
}

