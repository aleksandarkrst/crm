import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Modal, ModalHeader } from '../../components/ui';
import { orgApi, type ApiDirectoryRow } from '../../lib/orgApi';
import { paths } from '../../lib/paths';
import { type ApiProjectMember, projectsApi } from '../../lib/projectsApi';
import { type ApiTask, HOLD_REASONS, statusLabel, TASK_STATUSES, taskId, type TaskPatch, type TaskStatus, tasksApi } from '../../lib/tasksApi';
import { projectError } from '../../store/projects';
import { initialsOf } from '../../store/selectors';
import { useStore } from '../../store/store';
import { activeAssignees, dueText, hours, isLate, todayIso } from '../../store/tasks';

/** Up to `max` people as overlapping avatars, then "+N" (board cards, tables). */
export function AvatarStack({ names, max = 3, size = 24 }: { names: string[]; max?: number; size?: number }) {
  if (!names.length) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>Unassigned</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }} title={names.join(', ')}>
      {names.slice(0, max).map((n, i) => (
        <Avatar key={n + i} initials={initialsOf(n)} size={size} font={size < 24 ? 8.5 : 9.5} style={{ marginLeft: i ? -6 : 0, border: '2px solid var(--white)' }} />
      ))}
      {names.length > max && <span style={{ fontSize: 11, color: 'var(--text-2)', marginLeft: 4 }}>+{names.length - max}</span>}
    </span>
  );
}

/** The status as a small badge with its colour dot. */
export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const s = TASK_STATUSES.find((x) => x.id === status)!;
  return (
    <span className={status === 'done' ? 'badge badge-brand' : status === 'on_hold' ? 'badge badge-danger' : 'badge'} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: s.dot }} />
      {s.label}
    </span>
  );
}

/** "Due 7 Oct", or "Late · 25 Sep" in red. */
export function DueLabel({ task }: { task: Pick<ApiTask, 'dueDate' | 'status'> }) {
  const text = dueText(task.dueDate);
  if (!text) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>No due date</span>;
  const late = isLate(task, todayIso());
  return <span style={{ fontSize: 12, color: late ? 'var(--danger)' : 'var(--text-2)', fontWeight: late ? 600 : 400, whiteSpace: 'nowrap' }}>{late ? `Late · ${text}` : `Due ${text}`}</span>;
}

/**
 * Changing a task's status or saving a patch, with the toasts of design v2 ("T-12 on hold · Waiting
 * for the client"). On hold asks for a reason first (`dialog` renders it). `onSaved` gets the
 * saved task (the list or page replaces its copy).
 */
export function useTaskUpdate(onSaved: (t: ApiTask) => void) {
  const { flash } = useStore();
  const [holding, setHolding] = useState<ApiTask | null>(null);
  const save = async (task: ApiTask, patch: TaskPatch, message?: (t: ApiTask) => string): Promise<boolean> => {
    try {
      const saved = await tasksApi.update(task.id, patch);
      onSaved(saved);
      if (message) flash(message(saved));
      return true;
    } catch (err) {
      flash(projectError(err));
      return false;
    }
  };
  const setStatus = (task: ApiTask, status: TaskStatus) => {
    if (status === task.status) return;
    if (task.access !== 'act') return flash('You can see this task but not change it');
    if (status === 'on_hold') return setHolding(task);
    void save(task, { status }, (t) => (status === 'done' ? `${taskId(t)} done` : `${taskId(t)} moved to ${statusLabel(status)}`));
  };
  const dialog = holding && (
    <HoldDialog
      task={holding}
      onClose={() => setHolding(null)}
      onHold={async (reason) => {
        if (await save(holding, { status: 'on_hold', onHoldReason: reason }, (t) => `${taskId(t)} on hold · ${reason}`)) setHolding(null);
      }}
    />
  );
  return { save, setStatus, dialog };
}

/** Design v2 §4: "Put T-12 on hold" with the reason presets or the person's own words. */
function HoldDialog({ task, onClose, onHold }: { task: ApiTask; onClose: () => void; onHold: (reason: string) => Promise<void> }) {
  const [preset, setPreset] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [saving, setSaving] = useState(false);
  const reason = preset === 'Other' ? other.trim() : preset;
  return (
    <Modal maxWidth={480} onBackdrop={onClose}>
      <ModalHeader title={`Put ${taskId(task)} on hold`} sub="The task stays with its assignee. Tell the team why the work is paused." />
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }} data-testid="hold-reasons">
        {[...HOLD_REASONS, 'Other'].map((r) => (
          <button key={r} type="button" className={'reason-pill' + (preset === r ? ' on' : '')} aria-pressed={preset === r} onClick={() => setPreset(r)}>
            {r}
          </button>
        ))}
      </div>
      {preset === 'Other' && <input className="form-input" autoFocus maxLength={200} placeholder="Why is the work paused?" value={other} onChange={(e) => setOther(e.target.value)} data-testid="hold-other" />}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={reason && !saving ? 'btn btn-primary' : 'btn btn-disabled'}
          disabled={!reason || saving}
          data-testid="confirm-hold"
          onClick={async () => {
            if (!reason) return;
            setSaving(true);
            await onHold(reason);
            setSaving(false);
          }}
        >
          Put on hold
        </button>
      </div>
    </Modal>
  );
}

export type BoardColumn = { id: string; label: string; dot?: string };

/**
 * The tasks kanban (design v2 §3): one column per status (or per stage on a project's Plan tab),
 * a grey body, cards with "Project · Stage", the name, the people, the estimate and the due date.
 * Dropping a card on a column calls `onDrop`.
 */
export function TaskBoard({ tasks, columns, columnOf, onDrop, showProject = true }: { tasks: ApiTask[]; columns: BoardColumn[]; columnOf: (t: ApiTask) => string; onDrop: (t: ApiTask, column: string) => void; showProject?: boolean }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="task-board" data-testid="task-board">
      {columns.map((col) => {
        const cards = tasks.filter((t) => columnOf(t) === col.id);
        const est = cards.reduce((a, t) => a + (t.estimateHours ?? 0), 0);
        return (
          <div
            key={col.id}
            className={'task-column' + (over === col.id ? ' over' : '')}
            data-testid="task-column"
            data-column={col.label}
            onDragOver={(e) => {
              e.preventDefault();
              if (over !== col.id) setOver(col.id);
            }}
            onDragLeave={() => over === col.id && setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || dragId;
              setDragId(null);
              setOver(null);
              const t = tasks.find((x) => x.id === id);
              if (t && columnOf(t) !== col.id) onDrop(t, col.id);
            }}
          >
            <div className="task-column-head">
              {col.dot && <span style={{ width: 8, height: 8, borderRadius: 4, background: col.dot, flex: '0 0 8px' }} />}
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{col.label}</span>
              <span style={{ color: 'var(--text-2)', fontSize: 12.5 }}>{cards.length}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-2)', fontSize: 12 }}>{est ? hours(est) : ''}</span>
            </div>
            <div className="task-column-body">
              {cards.map((t) => (
                <div
                  key={t.id}
                  className="task-card"
                  data-testid="task-card"
                  data-task={taskId(t)}
                  draggable={t.access === 'act'}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', t.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragId(t.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  style={{ opacity: dragId === t.id ? 0.45 : 1 }}
                >
                  {showProject ? (
                    <Link to={paths.project(t.projectId)} className="task-card-project">
                      {t.projectName}
                      {t.stageName ? ` · ${t.stageName}` : ''}
                    </Link>
                  ) : (
                    <span className="task-card-project">{taskId(t)}</span>
                  )}
                  <Link to={paths.task(t.id)} className="task-card-name">
                    {t.name}
                  </Link>
                  {t.waitsFor && (
                    <span className="task-card-waits" data-testid="card-waits" style={{ color: t.waitsFor.status === 'done' ? 'var(--muted)' : '#B4531B' }}>
                      ↳ waits for {taskId(t.waitsFor)}
                      {t.waitsFor.status === 'done' ? ' (done)' : ''}
                    </span>
                  )}
                  {t.status === 'on_hold' && t.onHoldReason && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{t.onHoldReason}</span>}
                  <span className="task-card-foot">
                    <AvatarStack names={activeAssignees(t).map((a) => a.name)} size={22} />
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{hours(t.estimateHours) ?? ''}</span>
                    <span style={{ marginLeft: 'auto' }}>{t.dueDate && <DueLabel task={t} />}</span>
                  </span>
                </div>
              ))}
              {cards.length === 0 && <div className="empty-dashed">No tasks</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The org chart's people (who hasn't left) who can be given `kind` (CD-268), read once per picker. */
function useDirectory(kind: 'task' | 'work_order') {
  const [people, setPeople] = useState<ApiDirectoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    orgApi
      .directory()
      // Tasks go to office staff (CD-268): Office and Both; work orders to Service and Both.
      .then((rows) => setPeople(rows.filter((r) => r.status !== 'inactive' && r.workType !== (kind === 'task' ? 'service' : 'office'))))
      .catch((err: unknown) => setError(projectError(err)));
  }, [kind]);
  return { people, error };
}

/**
 * Who works on a task: the project team first, then "Others" from the org chart, searchable; people
 * without an account say "No account yet" (they get no email). `taken` are already on the task.
 * Inline (no overlay of its own), so the New task dialog can hold it.
 */
export function PeoplePicker({
  projectId,
  taken,
  picked,
  onToggle,
  kind = 'task',
}: {
  projectId: string | null;
  taken: Set<string>;
  picked: Set<string>;
  onToggle: (employeeId: string, name: string) => void;
  /** Who can be given it (CD-268): tasks Office and Both, work orders Service and Both. */
  kind?: 'task' | 'work_order';
}) {
  const { people, error } = useDirectory(kind);
  const [team, setTeam] = useState<ApiProjectMember[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!projectId) return setTeam([]);
    let live = true;
    projectsApi
      .members(projectId)
      .then((m) => live && setTeam(m))
      .catch(() => live && setTeam([]));
    return () => {
      live = false;
    };
  }, [projectId]);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const onTeam = new Set(team.map((m) => m.employeeId));
    const rows = (people ?? []).filter((p) => !taken.has(p.id)).filter((p) => !needle || `${p.fullName} ${p.jobTitle ?? ''} ${p.unitName ?? ''}`.toLowerCase().includes(needle));
    return [
      { label: 'Project team', rows: rows.filter((p) => onTeam.has(p.id)) },
      { label: 'Others', rows: rows.filter((p) => !onTeam.has(p.id)) },
    ].filter((g) => g.rows.length);
  }, [people, team, taken, q]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input className="form-input" placeholder="Search by name, job title or team" value={q} onChange={(e) => setQ(e.target.value)} data-testid="assign-search" />
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }} data-testid="assign-list">
        {error ? (
          <div className="hint-box">{error}</div>
        ) : !people ? (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--text-2)' }}>Loading people</div>
        ) : groups.length === 0 ? (
          <div style={{ padding: 12, fontSize: 13, color: 'var(--text-2)' }}>No one matches.</div>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="caps-muted" style={{ padding: '8px 12px 4px' }}>
                {g.label}
              </div>
              {g.rows.map((p) => (
                <label key={p.id} data-employee={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: '1px solid var(--divider)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => onToggle(p.id, p.fullName)} />
                  <Avatar initials={initialsOf(p.fullName)} size={24} font={9.5} />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{p.fullName}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{[p.jobTitle, p.unitName].filter(Boolean).join(' · ')}</span>
                  </span>
                  {!p.userId && <span className="badge">No account yet</span>}
                </label>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** The toast after assigning: who gets an email and who can't (no account), or "You're on T-12". */
export function assignedMessage(task: ApiTask, added: { name: string; hasAccount: boolean; me: boolean }[]): string {
  if (added.length === 1) {
    const [a] = added as [{ name: string; hasAccount: boolean; me: boolean }];
    if (a.me) return `You're on ${taskId(task)}`;
    return a.hasAccount ? `${a.name} assigned and emailed` : `${a.name} assigned · no account yet, so no email`;
  }
  return `${added.length} people assigned to ${taskId(task)}`;
}
