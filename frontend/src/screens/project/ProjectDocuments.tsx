import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '../../lib/paths';
import { type ApiProjectFile, MAX_PROJECT_FILE_BYTES, PROJECT_FILE_FOLDERS, type ProjectFileFolder, projectsApi } from '../../lib/projectsApi';
import { type DealDoc, docsApi } from '../../store/documents';
import { projectError } from '../../store/projects';
import { useStore } from '../../store/store';

type Folder = ProjectFileFolder | 'all';

export const fileSize = (bytes: number | null) => (bytes == null ? '—' : bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
export const fileDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const fileExt = (name: string) => (/\.([a-z0-9]{1,4})$/i.exec(name)?.[1] ?? 'file').toUpperCase();

/**
 * Adds the files someone dropped or picked, one by one (each its own upload); too large ones are
 * refused before sending. Used by the Documents tab and the Overview's drop zone.
 */
export function useFileUpload(projectId: string, onAdded: (f: ApiProjectFile) => void, taskId?: string) {
  const { flash } = useStore();
  const [busy, setBusy] = useState(false);
  const add = async (files: FileList | File[], folder: ProjectFileFolder) => {
    const list = [...files];
    if (!list.length) return;
    setBusy(true);
    let added = 0;
    for (const file of list) {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        flash(`${file.name} is larger than 25 MB`);
        continue;
      }
      try {
        onAdded(await projectsApi.uploadFile(projectId, file, folder, taskId));
        added++;
      } catch (err) {
        flash(projectError(err));
      }
    }
    setBusy(false);
    if (added) flash(`${added === 1 ? 'File' : `${added} files`} added to the ${taskId ? 'task' : 'project'}`);
  };
  return { add, busy };
}

/** A dashed area that takes dropped files, with a button that opens the file picker. */
export function DropZone({ text, button, busy, onFiles, testId }: { text: string; button: string; busy: boolean; onFiles: (files: FileList) => void; testId?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid={testId}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
      style={{ border: `1.5px dashed ${over ? 'var(--brand)' : 'var(--dashed)'}`, borderRadius: 12, padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-2)', background: over ? 'var(--brand-tint)' : 'var(--bg-soft)' }}
    >
      <span>{busy ? 'Adding files…' : text}</span>
      <button type="button" className="btn-outline" disabled={busy} onClick={() => input.current?.click()}>
        {button}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/**
 * The Documents tab (CD-271, design v2 §2): folders as filters, a drop zone, and the files with
 * their folder, what they are linked to, who added them, when and their size. The deal's generated
 * documents appear here too ("Linked to: the deal"; they're managed on the deal). Anyone adds
 * files; the one who added a file, the project lead, owners and admins move or delete it.
 */
export function ProjectDocuments({
  projectId,
  dealTitle,
  files,
  dealDocs,
  canManage,
  onChange,
}: {
  projectId: string;
  dealTitle: string | null;
  files: ApiProjectFile[] | null;
  dealDocs: DealDoc[];
  canManage: (f: ApiProjectFile) => boolean;
  onChange: (files: ApiProjectFile[]) => void;
}) {
  const { flash } = useStore();
  const [folder, setFolder] = useState<Folder>('all');
  const all = files ?? [];
  const upload = useFileUpload(projectId, (f) => onChange([f, ...(files ?? [])]));
  const readyDocs = dealDocs.filter((d) => d.status === 'ready');
  const shown = folder === 'all' ? all : all.filter((f) => f.folder === folder);
  const showDealDocs = folder === 'all' || folder === 'Contract';
  const count = (f: Folder) => (f === 'all' ? all.length + readyDocs.length : all.filter((x) => x.folder === f).length + (f === 'Contract' ? readyDocs.length : 0));

  const run = async (change: () => Promise<unknown>) => {
    try {
      await change();
    } catch (err) {
      flash(projectError(err));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="project-documents">
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-testid="document-folders">
        {(['all', ...PROJECT_FILE_FOLDERS] as Folder[]).map((f) => (
          <button key={f} type="button" className={'reason-pill' + (folder === f ? ' on' : '')} aria-pressed={folder === f} data-folder={f} onClick={() => setFolder(f)}>
            {f === 'all' ? 'All' : f} · {count(f)}
          </button>
        ))}
      </div>
      <DropZone testId="documents-drop" text="Drop files here to add them to this project, or" button="Upload" busy={upload.busy} onFiles={(fs) => void upload.add(fs, folder === 'all' ? 'Client material' : folder)} />
      <div className="pipeline-table">
        <div className="docs-table-inner">
          <div className="table-head caps">
            <span>Name</span>
            <span>Folder</span>
            <span>Linked to</span>
            <span>Added by</span>
            <span>Date</span>
            <span>Size</span>
            <span />
          </div>
          {shown.map((f) => (
            <div key={f.id} className="table-row" data-testid="project-file" style={{ paddingTop: 8, paddingBottom: 8 }}>
              <button type="button" className="doc-name" onClick={() => void run(() => projectsApi.downloadFile(projectId, f))} title="Download">
                <span className="doc-ext">{fileExt(f.name)}</span>
                <span className="pt-cell">
                  <span className="pt-main" style={{ fontWeight: 600 }}>
                    {f.name}
                  </span>
                  <span className="pt-sub">Uploaded</span>
                </span>
              </button>
              {canManage(f) ? (
                <select
                  className="ghost ghost-sm"
                  aria-label="Folder"
                  value={f.folder}
                  onChange={(e) =>
                    void run(async () => {
                      const moved = await projectsApi.moveFile(projectId, f.id, e.target.value as ProjectFileFolder);
                      onChange(all.map((x) => (x.id === f.id ? moved : x)));
                    })
                  }
                >
                  {PROJECT_FILE_FOLDERS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <span style={{ color: 'var(--text-2)' }}>{f.folder}</span>
              )}
              {f.taskId && f.taskNumber != null ? (
                <Link to={paths.task(f.taskId)} className="crumb-link" data-testid="file-task-link">
                  T-{f.taskNumber}
                </Link>
              ) : (
                <span style={{ color: 'var(--text-2)' }}>The project</span>
              )}
              <span className="pt-main" style={{ color: 'var(--text-2)' }}>
                {f.addedByName ?? '—'}
              </span>
              <span style={{ color: 'var(--text-2)' }}>{fileDay(f.createdAt)}</span>
              <span style={{ color: 'var(--text-2)' }}>{fileSize(f.sizeBytes)}</span>
              {canManage(f) ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Delete file"
                  title="Delete file"
                  onClick={() =>
                    void run(async () => {
                      await projectsApi.deleteFile(projectId, f.id);
                      onChange(all.filter((x) => x.id !== f.id));
                      flash(`${f.name} deleted`);
                    })
                  }
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          {showDealDocs &&
            readyDocs.map((d) => (
              <div key={d.id} className="table-row" data-testid="deal-file" style={{ paddingTop: 8, paddingBottom: 8 }}>
                <button type="button" className="doc-name" onClick={() => void run(() => docsApi.downloadDocument(d))} title="Download">
                  <span className="doc-ext">DOCX</span>
                  <span className="pt-cell">
                    <span className="pt-main" style={{ fontWeight: 600 }}>
                      {d.name}
                    </span>
                    <span className="pt-sub">From the deal · {d.docType}</span>
                  </span>
                </button>
                <span style={{ color: 'var(--text-2)' }}>Contract</span>
                <span className="pt-main" style={{ color: 'var(--text-2)' }}>
                  Deal · {dealTitle}
                </span>
                <span className="pt-main" style={{ color: 'var(--text-2)' }}>
                  {d.createdByName ?? '—'}
                </span>
                <span style={{ color: 'var(--text-2)' }}>{fileDay(d.createdAt)}</span>
                <span style={{ color: 'var(--text-2)' }}>{fileSize(d.sizeBytes)}</span>
                <span />
              </div>
            ))}
          {files && shown.length === 0 && !(showDealDocs && readyDocs.length) && <div className="pipeline-table-empty">No files in this folder.</div>}
          {!files && <div className="pipeline-table-empty">Loading files</div>}
        </div>
      </div>
    </div>
  );
}
