import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../../components/ui';
import { projectsApi } from '../../lib/projectsApi';
import { type ApiChecklistItem, type ApiTask, type ApiTaskComment, tasksApi } from '../../lib/tasksApi';
import { projectError, useProjectFiles } from '../../store/projects';
import { initialsOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import { useChecklist, useComments } from '../../store/tasks';
import { fileDay, fileExt, fileSize, useFileUpload } from '../project/ProjectDocuments';

/** Runs a change that answers with the whole list; a refusal is a toast. */
function useSave<T>(set: (data: T) => void) {
  const { flash } = useStore();
  return async (change: () => Promise<T>): Promise<boolean> => {
    try {
      set(await change());
      return true;
    } catch (err) {
      flash(projectError(err));
      return false;
    }
  };
}

/**
 * Checklist (CD-270, design v2 §4): "N of M" with a 4 px bar; items with a checkbox, inline text
 * (struck through when done) and ×; "Add an item" with Add, where Enter adds too.
 */
export function TaskChecklist({ task }: { task: ApiTask }) {
  const { data, set } = useChecklist(task.id);
  const save = useSave<ApiChecklistItem[]>(set);
  const [draft, setDraft] = useState('');
  const canEdit = task.access === 'act';
  const items = data ?? [];
  const done = items.filter((i) => i.done).length;
  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    if (await save(() => tasksApi.addItem(task.id, text))) setDraft('');
  };
  return (
    <div className="card card-pad" data-testid="task-checklist" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Checklist</span>
        {items.length > 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }} data-testid="checklist-count">
            {done} of {items.length}
          </span>
        )}
      </span>
      {items.length > 0 && (
        <span className="check-bar">
          <span style={{ width: `${(done / items.length) * 100}%` }} />
        </span>
      )}
      <div>
        {items.map((item) => (
          <ChecklistRow key={item.id} item={item} canEdit={canEdit} onToggle={() => void save(() => tasksApi.updateItem(task.id, item.id, { done: !item.done }))} onRename={(text) => save(() => tasksApi.updateItem(task.id, item.id, { text }))} onRemove={() => void save(() => tasksApi.removeItem(task.id, item.id))} />
        ))}
      </div>
      {canEdit && (
        <span style={{ display: 'flex', gap: 8 }}>
          <input
            className="form-input"
            placeholder="Add an item"
            maxLength={300}
            value={draft}
            data-testid="checklist-input"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            style={{ flex: 1 }}
          />
          <button type="button" className="btn-outline" data-testid="checklist-add" disabled={!draft.trim()} onClick={() => void add()}>
            Add
          </button>
        </span>
      )}
      {!canEdit && items.length === 0 && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No checklist yet.</span>}
    </div>
  );
}

function ChecklistRow({ item, canEdit, onToggle, onRename, onRemove }: { item: ApiChecklistItem; canEdit: boolean; onToggle: () => void; onRename: (text: string) => Promise<boolean>; onRemove: () => void }) {
  const [text, setText] = useState(item.text);
  useEffect(() => setText(item.text), [item.text]);
  const commit = async () => {
    const next = text.trim();
    if (!next || next === item.text) return setText(item.text);
    if (!(await onRename(next))) setText(item.text);
  };
  return (
    <div className={'check-row' + (item.done ? ' done' : '')} data-testid="checklist-item">
      <button type="button" className={'check-box' + (item.done ? ' on' : '')} role="checkbox" aria-checked={item.done} aria-label={item.done ? `Mark "${item.text}" not done` : `Mark "${item.text}" done`} disabled={!canEdit} onClick={onToggle}>
        {item.done && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 12 5 5 9-10" />
          </svg>
        )}
      </button>
      <input
        className="ghost ghost-sm"
        aria-label="Checklist item"
        value={text}
        maxLength={300}
        disabled={!canEdit}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setText(item.text);
        }}
        style={{ flex: 1, minWidth: 0 }}
      />
      {canEdit && (
        <button type="button" className="icon-btn" aria-label={`Remove "${item.text}"`} onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}

/** The extension tile's colours, by kind of file. */
const TILE: { test: RegExp; bg: string; fg: string }[] = [
  { test: /^PDF$/, bg: '#FDECEA', fg: '#B42318' },
  { test: /^(DOCX?|ODT|RTF|TXT)$/, bg: '#E8EEFB', fg: '#2F5BB7' },
  { test: /^(XLSX?|CSV|ODS)$/, bg: '#E3F3EA', fg: '#1E7A4C' },
  { test: /^(PNG|JPE?G|GIF|WEBP|SVG|HEIC)$/, bg: '#F1EAFB', fg: '#6B3FB0' },
];
const tileOf = (ext: string) => TILE.find((t) => t.test.test(ext)) ?? { bg: 'var(--chip)', fg: 'var(--text-2)' };

/**
 * Files (CD-270): the project files added to this task (they show in the project's Documents tab
 * too, "Linked to: T-12"). "New file" adds one; a name downloads it.
 */
export function TaskFiles({ task }: { task: ApiTask }) {
  const { flash } = useStore();
  const { data, set } = useProjectFiles(task.projectId);
  const input = useRef<HTMLInputElement>(null);
  const upload = useFileUpload(task.projectId, (f) => set([f, ...(data ?? [])]), task.id);
  const files = (data ?? []).filter((f) => f.taskId === task.id);
  return (
    <div className="card card-pad" data-testid="task-files" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Files</span>
        {task.access === 'act' && (
          <>
            <button type="button" className="btn-outline" data-testid="task-new-file" disabled={upload.busy} onClick={() => input.current?.click()}>
              {upload.busy ? 'Adding…' : 'New file'}
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              data-testid="task-file-input"
              onChange={(e) => {
                if (e.target.files?.length) void upload.add(e.target.files, 'Client material');
                e.target.value = '';
              }}
            />
          </>
        )}
      </span>
      {files.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Files you add here also appear in the project&apos;s Documents tab.</span>
      ) : (
        files.map((f) => {
          const ext = fileExt(f.name);
          const tile = tileOf(ext);
          return (
            <button
              key={f.id}
              type="button"
              className="doc-name"
              data-testid="task-file"
              title="Download"
              onClick={() => void projectsApi.downloadFile(task.projectId, f).catch((err: unknown) => flash(projectError(err)))}
              style={{ padding: '4px 0' }}
            >
              <span className="file-tile" style={{ background: tile.bg, color: tile.fg }}>
                {ext}
              </span>
              <span className="pt-cell">
                <span className="pt-main" style={{ fontWeight: 600 }}>
                  {f.name}
                </span>
                <span className="pt-sub">{[f.addedByName, fileDay(f.createdAt), fileSize(f.sizeBytes)].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

/**
 * Comments (CD-270): the conversation on the task, oldest first, visible to everyone who can see
 * it; the author (or an owner or admin) deletes their comment.
 */
export function TaskComments({ task }: { task: ApiTask }) {
  const { session } = useStore();
  const { data, set } = useComments(task.id);
  const save = useSave<ApiTaskComment[]>(set);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const isAdmin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const comments = data ?? [];
  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    if (await save(() => tasksApi.addComment(task.id, body))) setDraft('');
    setSending(false);
  };
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <div className="card card-pad" data-testid="task-comments" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>Comments{comments.length ? ` · ${comments.length}` : ''}</span>
      {comments.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No comments yet. Comments are visible to everyone on the project team.</span>
      ) : (
        comments.map((c) => (
          <div key={c.id} className="comment" data-testid="task-comment">
            <Avatar initials={initialsOf(c.authorName ?? '?')} size={28} font={10} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 12.5 }}>
                <b>{c.authorName ?? 'A former member'}</b> <span style={{ color: 'var(--muted)' }}>· {when(c.createdAt)}</span>
              </span>
              <span style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{c.body}</span>
            </span>
            {(c.authorUserId === session.userId || isAdmin) && (
              <button type="button" className="icon-btn" aria-label="Delete comment" onClick={() => void save(() => tasksApi.removeComment(task.id, c.id))}>
                ×
              </button>
            )}
          </div>
        ))
      )}
      {task.access === 'act' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
          <textarea className="box-input" rows={3} maxLength={5000} placeholder="Write a comment" value={draft} data-testid="comment-input" onChange={(e) => setDraft(e.target.value)} />
          <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className={draft.trim() && !sending ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!draft.trim() || sending} data-testid="comment-send" onClick={() => void send()}>
              {sending ? 'Posting…' : 'Comment'}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
