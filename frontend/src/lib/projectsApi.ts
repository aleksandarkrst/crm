/**
 * Projects (milestone 14): project types with stages (CD-272, `/api/project-types`) and client
 * projects linked to the CRM (CD-233, `/api/projects`). Everyone reads; owners and admins change
 * project types (the API answers 403 otherwise); any member creates a project, and its lead, owners
 * and admins change it.
 */
import { download } from '../store/documents';
import { api, ApiError, authorizedFetch } from './api';

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
  /** Logged time (CD-277): everyone's entries on its tasks and work orders, all time and this calendar month, in minutes. */
  loggedMinutes: number;
  monthMinutes: number;
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
  /** The team by name (the avatars on board cards and in the list). */
  team: { employeeId: string; name: string }[];
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
  /** "Add starter tasks from the products" (CD-263): a task per product line of the deal. */
  starterTasks?: boolean;
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

/** A person on a project's team (CD-271). */
export interface ApiProjectMember {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  /** Their org unit. */
  team: string | null;
  /** False once they left the company. */
  active: boolean;
  role: string | null;
  hoursPerWeek: number;
  /** Their weekly hours (Workforce). */
  weeklyHours: number;
  /** The hours a week they give every open project. */
  loadHours: number;
}

/** Where a project's file sits (design v2 Documents tab). */
export const PROJECT_FILE_FOLDERS = ['Contract', 'Brief', 'Design', 'Client material', 'Deliverable'] as const;
export type ProjectFileFolder = (typeof PROJECT_FILE_FOLDERS)[number];
/** The same limit as the API, checked before uploading. */
export const MAX_PROJECT_FILE_BYTES = 25 * 1024 * 1024;

/** A file added to a project (CD-271). */
export interface ApiProjectFile {
  id: string;
  name: string;
  folder: ProjectFileFolder;
  contentType: string;
  sizeBytes: number;
  /** The task it was added to (CD-270): "Linked to: T-12". */
  taskId: string | null;
  taskNumber: number | null;
  addedByUserId: string | null;
  addedByName: string | null;
  createdAt: string;
}

/** Multipart upload of one file (api() sends JSON only); `taskId`: the task it is for (CD-270). */
async function uploadFile(projectId: string, file: File, folder: ProjectFileFolder, taskId?: string): Promise<ApiProjectFile> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('folder', folder);
  if (taskId) form.append('taskId', taskId);
  const res = await authorizedFetch(`/projects/${projectId}/files`, { method: 'POST', body: form });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, res.status === 413 ? { message: 'A file can be at most 25 MB' } : body);
  return body as ApiProjectFile;
}

/** Estimates against logged time (CD-261), in minutes: a project's summary, a stage or a person. */
export interface ApiReportStats {
  tasks: number;
  doneTasks: number;
  openTasks: number;
  estimateMinutes: number;
  loggedMinutes: number;
  remainingMinutes: number;
  donePercent: number;
  overEstimate: boolean;
  variancePercent: number | null;
  lateTasks: number;
}

/** A project's Report tab (CD-261): the summary, "By stage" and "By person". */
export interface ApiProjectReport {
  summary: ApiReportStats & { budgetMinutes: number | null; onHoldTasks: number; forecast: { slipDays: number; date: string } | null };
  stages: (ApiReportStats & { id: string | null; name: string; dueDate: string | null })[];
  people: (ApiReportStats & { employeeId: string; name: string })[];
}

/** The Workload report (CD-261): remaining minutes per person and week (Mondays), by team. */
export interface ApiWorkload {
  weeks: string[];
  teams: { name: string; rows: { employeeId: string; name: string; jobTitle: string | null; cells: number[]; projects: string[] }[] }[];
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
  createProject: (input: NewProjectInput) => api<ApiProject>('/projects', { method: 'POST', json: input }),
  updateProject: (id: string, patch: ProjectPatch) => api<ApiProject>(`/projects/${id}`, { method: 'PATCH', json: patch }),
  // The team (CD-271): every change answers with the whole team.
  members: (projectId: string) => api<ApiProjectMember[]>(`/projects/${projectId}/members`),
  addMembers: (projectId: string, employeeIds: string[]) => api<ApiProjectMember[]>(`/projects/${projectId}/members`, { method: 'POST', json: { employeeIds } }),
  updateMember: (projectId: string, employeeId: string, patch: { role?: string | null; hoursPerWeek?: number }) =>
    api<ApiProjectMember[]>(`/projects/${projectId}/members/${employeeId}`, { method: 'PUT', json: patch }),
  removeMember: (projectId: string, employeeId: string) => api<ApiProjectMember[]>(`/projects/${projectId}/members/${employeeId}`, { method: 'DELETE' }),
  // Files (CD-271): anyone adds and downloads; the one who added it, the lead, owners and admins move or delete it.
  files: (projectId: string) => api<ApiProjectFile[]>(`/projects/${projectId}/files`),
  uploadFile,
  moveFile: (projectId: string, fileId: string, folder: ProjectFileFolder) => api<ApiProjectFile>(`/projects/${projectId}/files/${fileId}`, { method: 'PATCH', json: { folder } }),
  deleteFile: (projectId: string, fileId: string) => api<null>(`/projects/${projectId}/files/${fileId}`, { method: 'DELETE' }),
  downloadFile: (projectId: string, f: ApiProjectFile) => download(`/projects/${projectId}/files/${f.id}/download`, f.name),
  report: (id: string) => api<ApiProjectReport>(`/projects/${id}/report`),
  workload: () => api<ApiWorkload>('/workload'),
  /** Owners and admins. */
  deleteProject: (id: string) => api<null>(`/projects/${id}`, { method: 'DELETE' }),
};
