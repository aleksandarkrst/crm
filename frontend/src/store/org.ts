import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { type ApiDepartment, type ApiDirectoryRow, type ApiPeopleAccess, type ApiTeam, orgApi } from '../lib/orgApi';
import { useStore } from './store';

export interface OrgStructure {
  departments: ApiDepartment[];
  teams: ApiTeam[];
  /** Active employees of the directory, by last name. */
  employees: ApiDirectoryRow[];
  access: ApiPeopleAccess;
}

/** Admins only (CD-225): may change departments, teams and reporting lines (spec 9.3). */
export const canManageOrg = (access: ApiPeopleAccess | null | undefined): boolean => !!access && access.roles.includes('admin');

/** The API's message (and the first field problem), for the panel's error lines. */
export function orgError(err: unknown): string {
  if (err instanceof ApiError) {
    const issue = (err.body as { issues?: { message?: string }[] } | null)?.issues?.[0];
    return issue?.message ? `${err.message}: ${issue.message}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Departments, teams, the directory and the caller's access (CD-138), read when `enabled` turns on
 * and again shortly after any employee, department or team change (`s.orgRev`, raised by live
 * hints, this tab's own included), so the panel shows what other viewers change without a reload.
 * `reload()` reads it at once (after this tab saves). The last data stays on screen while it loads.
 */
export function useOrgStructure(enabled: boolean): { data: OrgStructure | null; error: string | null; reload: () => Promise<void> } {
  const { s } = useStore();
  const rev = s.orgRev;
  const [data, setData] = useState<OrgStructure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [departments, teams, employees, access] = await Promise.all([orgApi.departments(), orgApi.teams(), orgApi.directory(), orgApi.access()]);
      if (mine !== seq.current) return;
      setData({ departments, teams, employees: employees.filter((e) => e.status !== 'inactive'), access });
      setError(null);
    } catch (err) {
      if (mine === seq.current) setError(orgError(err));
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
  }, [enabled, rev, load]);

  return { data: enabled ? data : null, error, reload: load };
}
