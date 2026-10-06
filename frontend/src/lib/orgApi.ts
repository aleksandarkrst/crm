/**
 * Departments, teams and reporting lines (CD-138, CD-139): `/api/people/departments`, `/teams`,
 * `/assignments` and `/reporting-lines`. Reading is for every member; changes are for
 * Admins (the API answers 403 otherwise).
 */
import { api } from './api';

export interface ApiDepartment {
  id: string;
  name: string;
  code: string | null;
  headEmployeeId: string | null;
  headName: string | null;
  version: string;
  /** Number of teams. */
  teams: number;
  activeEmployees: number;
}

export interface ApiTeam {
  id: string;
  departmentId: string;
  name: string;
  leadEmployeeId: string | null;
  leadName: string | null;
  /** The lead isn't a member of the team (the chart shows them on top with "(lead)"). */
  leadOutside: boolean;
  version: string;
  activeEmployees: number;
}

/** An employee as confirmations and previews name them. */
export interface ApiOrgPerson {
  id: string;
  fullName: string;
  jobTitle: string | null;
  departmentId: string | null;
  teamId: string | null;
  teamName: string | null;
  managerId: string | null;
  managerName: string | null;
}

/** A row of the directory (`GET /api/people/employees`), the fields the panel uses. */
export interface ApiDirectoryRow {
  id: string;
  fullName: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  teamId: string | null;
  teamName: string | null;
  managerId: string | null;
  managerName: string | null;
  status: 'active' | 'leaving' | 'inactive';
}

export interface ApiPeopleAccess {
  employeeId: string | null;
  roles: ('employee' | 'manager' | 'admin')[];
  directReportIds: string[];
  reportIds: string[];
}

/** Someone the team-lead dialog leaves alone: reporting to the lead would close a loop. */
export interface LoopSkip {
  id: string;
  fullName: string;
  message: string;
}

export interface TeamSaved {
  team: ApiTeam;
  /** Active members whose department changed with the team. */
  moved: number;
  /** Employees who now report to the lead. */
  reassigned: string[];
  loops: LoopSkip[];
}

export interface AssignmentRow extends ApiOrgPerson {
  /** Leaves another team or department. */
  moves: boolean;
  /** Without a manager: the team lead, else the department head (never themselves, never a loop). */
  suggestedManagerId: string | null;
  suggestedManagerName: string | null;
}

/** Confirms moving a department head or team lead elsewhere, which ends that role (CD-225, lib/headMoves.ts). */
interface HeadMove {
  clearHeadRoles?: boolean;
}

export interface DepartmentInput extends HeadMove {
  name?: string;
  code?: string | null;
  headEmployeeId?: string | null;
}

export interface TeamInput extends HeadMove {
  name?: string;
  departmentId?: string;
  leadEmployeeId?: string | null;
  makeMembersReport?: boolean;
}

export const orgApi = {
  access: () => api<ApiPeopleAccess>('/people/access'),
  directory: () => api<{ employees: ApiDirectoryRow[] }>('/people/employees').then((r) => r.employees),
  departments: () => api<ApiDepartment[]>('/people/departments'),
  teams: () => api<ApiTeam[]>('/people/teams'),

  createDepartment: (input: DepartmentInput & { name: string }) => api<ApiDepartment>('/people/departments', { method: 'POST', json: input }),
  updateDepartment: (id: string, input: DepartmentInput) => api<ApiDepartment>(`/people/departments/${id}`, { method: 'PATCH', json: input }),
  deleteDepartment: (id: string) => api<null>(`/people/departments/${id}`, { method: 'DELETE' }),
  departmentUsage: (id: string) => api<{ id: string; name: string; teams: { id: string; name: string }[]; usedBy: string[]; members: ApiOrgPerson[] }>(`/people/departments/${id}/usage`),

  createTeam: (input: { departmentId: string; name: string; leadEmployeeId?: string | null } & HeadMove) => api<TeamSaved>('/people/teams', { method: 'POST', json: input }),
  updateTeam: (id: string, input: TeamInput) => api<TeamSaved>(`/people/teams/${id}`, { method: 'PATCH', json: input }),
  deleteTeam: (id: string) => api<null>(`/people/teams/${id}`, { method: 'DELETE' }),
  teamUsage: (id: string) => api<{ id: string; name: string; departmentId: string; members: ApiOrgPerson[] }>(`/people/teams/${id}/usage`),
  leadPreview: (id: string, leadEmployeeId: string) => api<{ members: ApiOrgPerson[]; loops: LoopSkip[] }>(`/people/teams/${id}/lead-preview?leadEmployeeId=${leadEmployeeId}`),

  previewAssignment: (input: { departmentId: string; teamId?: string | null; employeeIds: string[] }) =>
    api<{ employees: AssignmentRow[] }>('/people/assignments/preview', { method: 'POST', json: input }),
  /** "Add people" / "Set department and team"; `managers` sets Reports to of some of them. */
  assign: (input: { departmentId: string; teamId?: string | null; employeeIds: string[]; managers?: Record<string, string | null> } & HeadMove) =>
    api<{ updated: number; managersChanged: string[] }>('/people/assignments', { method: 'POST', json: input }),
  /** "Set manager" for one or many; null removes it. */
  setManager: (employeeIds: string[], managerId: string | null) => api<{ changed: string[] }>('/people/reporting-lines', { method: 'POST', json: { employeeIds, managerId } }),
};
