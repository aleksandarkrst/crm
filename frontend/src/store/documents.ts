/**
 * Document templates and generated documents (CD-13), next to the store. Templates are .docx files
 * with {{merge fields}} that owners and admins upload; anyone generates a document on a deal from
 * one (a worker job fills it in) and downloads it. The store calls these; screens use the store.
 */
import { api, ApiError, authorizedFetch } from '../lib/api';

export const DOC_TYPES = ['Proposal', 'Quote', 'Contract', 'NDA', 'Onboarding brief', 'Invoice'] as const;
export type DocType = (typeof DOC_TYPES)[number];
/** The same limit as the API, checked before uploading. */
export const MAX_TEMPLATE_BYTES = 5 * 1024 * 1024;

export interface FoundPlaceholder {
  tag: string;
  known: boolean;
  label: string | null;
}
export interface DocTemplate {
  id: string;
  name: string;
  docType: DocType;
  fileName: string;
  sizeBytes: number;
  placeholders: FoundPlaceholder[];
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  createdAt: string;
}
export type DocStatus = 'queued' | 'running' | 'ready' | 'failed';
export interface DealDoc {
  id: string;
  dealId: string;
  templateId: string | null;
  templateName: string;
  docType: DocType;
  name: string;
  status: DocStatus;
  error: string | null;
  sizeBytes: number | null;
  missingFields: string[];
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface PlaceholderDef {
  tag: string;
  label: string;
  group: string;
  example: string;
}
export interface PlaceholderReference {
  fields: PlaceholderDef[];
  loop: string;
  lineFields: PlaceholderDef[];
  aliases: Record<string, string>;
}
export interface ScanResult {
  fileName: string;
  sizeBytes: number;
  placeholders: FoundPlaceholder[];
}


/** Multipart upload (api() sends JSON only). */
async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await authorizedFetch(path, { method: 'POST', body: form });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, res.status === 413 ? { message: 'The file is larger than 5 MB' } : body);
  return body as T;
}

/** Downloads a file behind auth and saves it under the name the API gives it. */
export async function download(path: string, fallback: string): Promise<void> {
  const res = await authorizedFetch(path);
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const disposition = res.headers.get('Content-Disposition') || '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  const name = star ? decodeURIComponent(star) : plain || fallback;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const templateForm = (file: File, fields: Record<string, string> = {}) => {
  const form = new FormData();
  form.append('file', file, file.name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
};

export const docsApi = {
  templates: () => api<DocTemplate[]>('/crm/document-templates'),
  placeholders: () => api<PlaceholderReference>('/crm/document-templates/placeholders'),
  scan: (file: File) => upload<ScanResult>('/crm/document-templates/scan', templateForm(file)),
  createTemplate: (file: File, name: string, docType: DocType) => upload<DocTemplate>('/crm/document-templates', templateForm(file, { name, docType })),
  deleteTemplate: (id: string) => api<null>(`/crm/document-templates/${id}`, { method: 'DELETE' }),
  downloadTemplate: (t: DocTemplate) => download(`/crm/document-templates/${t.id}/file`, t.fileName),
  downloadStarter: () => download('/crm/document-templates/starter', 'Pultly proposal starter template.docx'),

  documents: (dealId: string) => api<DealDoc[]>(`/crm/deal-documents?dealId=${dealId}&limit=200`),
  document: (id: string) => api<DealDoc>(`/crm/deal-documents/${id}`),
  generate: (dealId: string, templateId: string) => api<DealDoc>(`/crm/deals/${dealId}/documents`, { method: 'POST', json: { templateId } }),
  deleteDocument: (id: string) => api<null>(`/crm/deal-documents/${id}`, { method: 'DELETE' }),
  downloadDocument: (d: DealDoc) => download(`/crm/deal-documents/${d.id}/file`, `${d.name}.docx`),
};

/** Checks a picked file before it is sent; returns the problem, or null. */
export function templateFileProblem(file: File): string | null {
  if (!/\.docx$/i.test(file.name)) return 'Templates must be Word documents (.docx). Save it as .docx in Word and pick it again.';
  if (file.size > MAX_TEMPLATE_BYTES) return 'The file is larger than 5 MB.';
  if (file.size === 0) return 'The file is empty.';
  return null;
}

export const canManageTemplates = (role: string) => role === 'owner' || role === 'admin';
export const docBusy = (d: DealDoc) => d.status === 'queued' || d.status === 'running';

/** The template to suggest on a deal: the first one of the stage's document type, else the newest. */
export function suggestedTemplate(templates: DocTemplate[], docType?: string): DocTemplate | undefined {
  return templates.find((t) => t.docType === docType) ?? templates[0];
}

/** "24 Sep 2026, 14:05" in the workspace time zone. */
export function docMoment(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz || undefined });
  } catch {
    return new Date(iso).toLocaleString('en-GB');
  }
}

export const fileSize = (bytes: number | null) => (bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
