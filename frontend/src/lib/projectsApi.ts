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

export interface ApiProject {
  id: string;
  name: string;
  status: ApiProjectStatus;
  projectTypeId: string;
  projectTypeName: string;
  stageId: string;
  stageName: string;
  companyId: string;
  companyName: string;
  dealId: string | null;
  dealTitle: string | null;
  leadUserId: string | null;
  leadName: string | null;
  createdAt: string;
  version: string;
}

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
  createProject: (input: { name: string; projectTypeId: string; companyId: string; dealId?: string | null; leadUserId?: string | null }) =>
    api<ApiProject>('/projects', { method: 'POST', json: input }),
  updateProject: (id: string, patch: Partial<{ name: string; leadUserId: string; stageId: string; status: ApiProjectStatus }>) =>
    api<ApiProject>(`/projects/${id}`, { method: 'PATCH', json: patch }),
};
