import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { type ApiProject, type ApiProjectFile, type ApiProjectMember, type ApiProjectType, projectsApi } from '../lib/projectsApi';
import { type DealDoc, docsApi } from './documents';
import { useStore } from './store';

/** The API's message (and the first field problem), for error lines and toasts. */
export function projectError(err: unknown): string {
  if (err instanceof ApiError) {
    const issue = (err.body as { issues?: { message?: string }[] } | null)?.issues?.[0];
    return issue?.message ? `${err.message}: ${issue.message}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads something from the projects API when `enabled` turns on, and again shortly after any
 * project type, stage or project change (`s.projectRev`, raised by live hints, this tab's own
 * included). `set` replaces the data at once with what a save answered. The last data stays on
 * screen while it loads.
 */
function useProjectsRead<T>(enabled: boolean, read: () => Promise<T>, key: string): { data: T | null; error: string | null; reload: () => Promise<void>; set: (data: T) => void } {
  const { s } = useStore();
  const rev = s.projectRev;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const next = await readRef.current();
      if (mine !== seq.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (mine === seq.current) setError(projectError(err));
    }
  }, []);

  const loaded = useRef(false);
  useEffect(() => {
    if (!enabled) {
      loaded.current = false;
      return;
    }
    // The first load at once; a change waits a moment (hints come in bursts).
    const timer = setTimeout(() => void load(), loaded.current ? 300 : 0);
    loaded.current = true;
    return () => clearTimeout(timer);
  }, [enabled, rev, load, key]);

  const set = useCallback((next: T) => {
    seq.current++;
    setData(next);
    setError(null);
  }, []);

  return { data: enabled ? data : null, error, reload: load, set };
}

/** Every project type with its stages, in order (Settings → Project types, the New project dialog). */
export const useProjectTypes = (enabled = true) => useProjectsRead<ApiProjectType[]>(enabled, projectsApi.types, 'types');

/** Every project of the workspace (the Projects board and list, Ctrl/⌘K, CD-234). */
export const useProjects = (enabled = true) => useProjectsRead<ApiProject[]>(enabled, () => projectsApi.projects(), 'all');

/** The projects of one company (its page's Projects card, CD-234). */
export const useCompanyProjects = (companyId: string | undefined) =>
  useProjectsRead<ApiProject[]>(!!companyId, () => projectsApi.projects({ companyId }), `company:${companyId ?? ''}`);

/** One project (its page, CD-275). */
export const useProject = (id: string | undefined) => useProjectsRead<ApiProject>(!!id, () => projectsApi.project(id!), `project:${id ?? ''}`);

/** A project's team (CD-271). */
export const useProjectMembers = (projectId: string | undefined) =>
  useProjectsRead<ApiProjectMember[]>(!!projectId, () => projectsApi.members(projectId!), `members:${projectId ?? ''}`);

/** A project's files (CD-271, Documents tab). */
export const useProjectFiles = (projectId: string | undefined) =>
  useProjectsRead<ApiProjectFile[]>(!!projectId, () => projectsApi.files(projectId!), `files:${projectId ?? ''}`);

/** The documents of a project's deal, shown on its Documents tab ("Deal files appear automatically"). */
export const useDealDocuments = (dealId: string | null | undefined) =>
  useProjectsRead<DealDoc[]>(!!dealId, () => docsApi.documents(dealId!), `dealdocs:${dealId ?? ''}`);

/** The projects of one deal (the won deal's header and Summary, CD-275). */
export const useDealProjects = (dealId: string | undefined) =>
  useProjectsRead<ApiProject[]>(!!dealId, () => projectsApi.projects({ dealId }), `deal:${dealId ?? ''}`);
