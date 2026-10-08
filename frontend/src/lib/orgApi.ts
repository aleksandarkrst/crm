/**
 * Organization levels and units, people's units and managers (CD-226; departments and teams
 * before, CD-138, CD-139): `/api/people/org-levels`, `/org-units`, `/assignments` and
 * `/reporting-lines`. Reading is for every member; changes are for Admins (the API answers 403
 * otherwise). Managers and units follow the org rules on the server (a unit brings its lead as
 * manager, a manager their unit, a new lead reports to the lead above).
 */
import { api, type ApiOrgLevel, type ApiOrgUnit } from './api';

export type { ApiOrgLevel, ApiOrgUnit } from './api';

/** A row of the directory (`GET /api/people/employees`), the fields the panel uses. */
export interface ApiDirectoryRow {
  id: string;
  fullName: string;
  jobTitle: string | null;
  unitId: string | null;
  unitName: string | null;
  managerId: string | null;
  managerName: string | null;
  status: 'active' | 'leaving' | 'inactive';
  /** Their member account; null: "No account yet" (no emails). */
  userId: string | null;
}

export interface ApiPeopleAccess {
  employeeId: string | null;
  roles: ('employee' | 'manager' | 'admin')[];
  directReportIds: string[];
  reportIds: string[];
}

/** Someone a new lead leaves alone: reporting to the lead would close a loop. */
export interface LoopSkip {
  id: string;
  fullName: string;
  message: string;
}

export interface UnitSaved {
  unit: ApiOrgUnit;
  /** Employees whose manager changed (the lead, the members who now report to them). */
  managersChanged: string[];
  loops: LoopSkip[];
}

/** What a new lead would change (`GET /org-units/:id/lead-preview`). */
export interface LeadPreview {
  /** The lead's manager afterwards: the nearest lead above, else the CEO. */
  managerId: string | null;
  managerName: string | null;
  /** Who would report to the new lead. */
  members: { id: string; fullName: string }[];
  loops: LoopSkip[];
  /** The unit the person leads now and would stop leading. */
  leavesUnit: { id: string; name: string } | null;
}

/** Confirms moving a unit's lead elsewhere, which ends that role (lib/headMoves.ts). */
interface LeadMove {
  clearLeadRoles?: boolean;
}

export interface UnitInput extends LeadMove {
  name?: string;
  code?: string | null;
  parentId?: string | null;
  leadEmployeeId?: string | null;
}

export const orgApi = {
  access: () => api<ApiPeopleAccess>('/people/access'),
  directory: () => api<{ employees: ApiDirectoryRow[] }>('/people/employees').then((r) => r.employees),

  levels: () => api<ApiOrgLevel[]>('/people/org-levels'),
  /** A new level at `position` (1 = top; default the bottom). Every call answers with all levels. */
  createLevel: (name: string, position?: number) => api<ApiOrgLevel[]>('/people/org-levels', { method: 'POST', json: position ? { name, position } : { name } }),
  renameLevel: (id: string, name: string) => api<ApiOrgLevel[]>(`/people/org-levels/${id}`, { method: 'PATCH', json: { name } }),
  reorderLevels: (ids: string[]) => api<ApiOrgLevel[]>('/people/org-levels/order', { method: 'PUT', json: { ids } }),
  deleteLevel: (id: string) => api<ApiOrgLevel[]>(`/people/org-levels/${id}`, { method: 'DELETE' }),

  units: () => api<ApiOrgUnit[]>('/people/org-units'),
  createUnit: (input: { levelId: string; name: string; parentId?: string | null; code?: string | null; leadEmployeeId?: string | null } & LeadMove) =>
    api<UnitSaved>('/people/org-units', { method: 'POST', json: input }),
  updateUnit: (id: string, input: UnitInput) => api<UnitSaved>(`/people/org-units/${id}`, { method: 'PATCH', json: input }),
  deleteUnit: (id: string) => api<null>(`/people/org-units/${id}`, { method: 'DELETE' }),
  unitUsage: (id: string) =>
    api<{ id: string; name: string; units: { id: string; name: string }[]; usedBy: string[]; members: { id: string; fullName: string }[] }>(`/people/org-units/${id}/usage`),
  leadPreview: (id: string, leadEmployeeId: string) => api<LeadPreview>(`/people/org-units/${id}/lead-preview?leadEmployeeId=${leadEmployeeId}`),

  /** "Add people": puts them in the unit (null: no unit); their managers follow the rules except those in `managers`. */
  assign: (input: { unitId: string | null; employeeIds: string[]; managers?: Record<string, string | null> } & LeadMove) =>
    api<{ updated: number; managersChanged: string[] }>('/people/assignments', { method: 'POST', json: input }),
  /** "Set manager" for one or many; null removes it. Each joins the manager's unit. */
  setManager: (employeeIds: string[], managerId: string | null) => api<{ changed: string[] }>('/people/reporting-lines', { method: 'POST', json: { employeeIds, managerId } }),
};
