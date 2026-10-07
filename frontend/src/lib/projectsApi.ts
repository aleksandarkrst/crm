/**
 * Projects (milestone 14): project types with stages (CD-272, `/api/project-types`) and client
 * projects linked to the CRM (CD-233, `/api/projects`). Everyone reads; owners and admins change
 * project types (the API answers 403 otherwise); any member creates a project, and its lead, owners
 * and admins change it.
 */
import { api } from './api';

export interface ApiProjectStage {
  id: string;
  name: string;
  position: number;
  /** Projects in this stage, open or closed. */
  projects: number;
}

export interface ApiProjectType {
  id: string;
  name: string;
  position: number;
  version: string;
  projects: number;
  stages: ApiProjectStage[];
}

export type ApiProjectStatus = 'open' | 'completed' | 'cancelled';
export type ApiProjectHealth = 'on_track' | 'at_risk' | 'off_track';
/** The Cancel project dialog's reasons (design v2 §2). */
export const PROJECT_CANCEL_REASONS = ['Client cancelled', 'Budget cut', 'Scope moved to another project', 'Other'] as const;
export type ApiProjectCancelReason = (typeof PROJECT_CANCEL_REASONS)[number];

export interface ApiProject {
  id: string;
  name: string;
  code: string | null;
  status: ApiProjectStatus;
  cancelReason: ApiProjectCancelReason | null;
  health: ApiProjectHealth;
  /** Design v2 Details: the value (a decimal string, in `currency`, the workspace's when null) and the budget in hours. */
  value: string | null;
  currency: string | null;
  budgetHours: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  projectTypeId: string;
  projectTypeName: string;
  stageId: string;
  stageName: string;
  companyId: string;
  companyName: string;
  dealId: string | null;
  dealTitle: string | null;
  /** The linked deal was lost after the project started: the project says "Deal lost". */
  dealLost: boolean;
  /** The deal's primary contact (the Linked card). */
  contactId: string | null;
  contactName: string | null;
  leadUserId: string | null;
  leadName: string | null;
  createdAt: string;
  version: string;
}

export interface NewProjectInput {
  name: string;
  projectTypeId: string;
  companyId: string;
  dealId?: string | null;
  leadUserId?: string | null;
  code?: string | null;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

/** `cancelled` needs `cancelReason`; another type starts at its first stage; another company clears the deal. */
export type ProjectPatch = Partial<{
  name: string;
  leadUserId: string;
  projectTypeId: string;
  stageId: string;
  status: ApiProjectStatus;
  cancelReason: ApiProjectCancelReason;
  companyId: string;
  dealId: string | null;
  code: string | null;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  health: ApiProjectHealth;
  value: number | null;
  currency: string | null;
  budgetHours: number | null;
}>;

const move = (to?: string) => (to ? `?moveProjectsTo=${encodeURIComponent(to)}` : '');

export const projectsApi = {
  // Every project type call answers with all types, in order.
  types: () => api<ApiProjectType[]>('/project-types'),
  createType: (name: string) => api<ApiProjectType[]>('/project-types', { method: 'POST', json: { name } }),
  renameType: (id: string, name: string) => api<ApiProjectType[]>(`/project-types/${id}`, { method: 'PATCH', json: { name } }),
  /** `moveProjectsTo` (another type) is required while it has projects. */
  deleteType: (id: string, moveProjectsTo?: string) => api<ApiProjectType[]>(`/project-types/${id}${move(moveProjectsTo)}`, { method: 'DELETE' }),
  createStage: (typeId: string, name: string) => api<ApiProjectType[]>(`/project-types/${typeId}/stages`, { method: 'POST', json: { name } }),
  renameStage: (typeId: string, stageId: string, name: string) => api<ApiProjectType[]>(`/project-types/${typeId}/stages/${stageId}`, { method: 'PATCH', json: { name } }),
  reorderStages: (typeId: string, stageIds: string[]) => api<ApiProjectType[]>(`/project-types/${typeId}/stages/order`, { method: 'PUT', json: { stageIds } }),
  /** `moveProjectsTo` (another stage of the type) is required while it has projects. */
  deleteStage: (typeId: string, stageId: string, moveProjectsTo?: string) =>
    api<ApiProjectType[]>(`/project-types/${typeId}/stages/${stageId}${move(moveProjectsTo)}`, { method: 'DELETE' }),

  projects: (filter: { dealId?: string; companyId?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(filter).filter((e): e is [string, string] => !!e[1]));
    return api<ApiProject[]>('/projects' + (q.size ? `?${q}` : ''));
  },
  project: (id: string) => api<ApiProject>(`/projects/${id}`),
  createProject: (input: NewProjectInput) => api<ApiProject>('/projects', { method: 'POST', json: input }),
  updateProject: (id: string, patch: ProjectPatch) => api<ApiProject>(`/projects/${id}`, { method: 'PATCH', json: patch }),
  /** Owners and admins. */
  deleteProject: (id: string) => api<null>(`/projects/${id}`, { method: 'DELETE' }),
};
