import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChangeHistory } from '../components/ChangeHistory';
import { askConfirm } from '../components/ConfirmDialog';
import { Screen } from '../components/Layout';
import { Avatar, Modal, ModalHeader } from '../components/ui';
import { paths } from '../lib/paths';
import { type ApiTask, type ApiTaskBrief, quarterHourError, statusLabel, TASK_STATUSES, taskId, type TaskPatch, tasksApi } from '../lib/tasksApi';
import { projectError, useProject, useProjects, useProjectTypes } from '../store/projects';
import { curOf, initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import { activeAssignees, dueText, isLate, todayIso, useTask, useTasks } from '../store/tasks';
import { NumberField, Row, TextField } from './project/fields';
import { assignedMessage, DueLabel, PeoplePicker, useTaskUpdate } from './task/parts';
import { PeopleAndHours } from './task/PeopleAndHours';
import { TaskChecklist, TaskComments, TaskFiles } from './task/TaskNotes';

/**
 * A task's page (CD-283, design v2 §4):
 * - header: crumb "Tasks → project → T-12", the name (inline), Mark done or Done + Reopen, "⋯" with
 *   Move to another project and Delete (the lead, owners and admins), the status bar To do / In
 *   progress / On hold / Done (On hold asks why first, then shows the reason in a red box), and the
 *   meta line (stage · people · due);
 * - Details: assignees (chips; "Add" picks the project team first, then others), stage, start,
 *   due (red when late), estimate, project and company;
 * - Description and History.
 * Indirect managers see it read-only (`access: 'read'`); the API agrees.
 */
export function Task() {
  const { id = '' } = useParams();
  const { s, session, flash } = useStore();
  const navigate = useNavigate();
  const { data: task, error, set } = useTask(id);
  const { data: project } = useProject(task?.projectId);
  // The project's tasks: what this one can wait for (CD-269).
  const { data: siblings } = useTasks({ projectId: task?.projectId }, !!task?.projectId);
  const { data: types } = useProjectTypes();
  const { save, setStatus, dialog } = useTaskUpdate(set);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [menu]);

  if (!task) {
    return (
      <Screen title="Task" parent={{ label: 'Tasks', to: paths.tasks }}>
        <div className="hint-box">{error ? `Couldn't load this task: ${error}` : 'Loading the task'}</div>
      </Screen>
    );
  }

  const canEdit = task.access === 'act';
  const stages = types?.find((t) => t.id === project?.projectTypeId)?.stages ?? [];
  const people = activeAssignees(task);
  const late = isLate(task, todayIso());
  const me = s.team.find((m) => m.id === session.userId)?.employeeId ?? null;
  const update = (patch: TaskPatch, message?: (t: ApiTask) => string) => save(task, patch, message);

  const assign = async (ids: string[], hourLimits?: Record<string, number>) => {
    try {
      const saved = await tasksApi.assign(task.id, ids, hourLimits);
      set(saved);
      const added = saved.assignees.filter((a) => ids.includes(a.employeeId)).map((a) => ({ name: a.name, hasAccount: a.hasAccount, me: a.employeeId === me }));
      flash(assignedMessage(saved, added));
      setAdding(false);
    } catch (err) {
      flash(projectError(err));
    }
  };
  const unassign = async (employeeId: string, name: string) => {
    try {
      const saved = await tasksApi.unassign(task.id, employeeId);
      flash(`${name} is off ${taskId(saved)}`);
      set(saved);
    } catch (err) {
      flash(projectError(err));
    }
  };
  const remove = async () => {
    setMenu(false);
    const yes = await askConfirm({ title: `Delete ${taskId(task)}?`, message: `${task.name} and its history are deleted. The project is kept.`, confirmLabel: 'Delete task', danger: true });
    if (!yes) return;
    try {
      await tasksApi.remove(task.id);
      flash(`${taskId(task)} deleted`);
      navigate(paths.project(task.projectId));
    } catch (err) {
      flash(projectError(err));
    }
  };

  const meta = [task.stageName, people.map((a) => a.name).join(', ') || 'Unassigned', task.dueDate ? `Due ${dueText(task.dueDate)}` : null].filter(Boolean).join(' · ');
  return (
    <Screen title="Task" parent={{ label: 'Tasks', to: paths.tasks }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="task-page">
        <div className="card deal-header" style={{ padding: '16px 20px' }}>
          <div className="deal-crumb">
            <Link to={paths.tasks} className="crumb-link">
              Tasks
            </Link>
            <span aria-hidden>→</span>
            <Link to={paths.project(task.projectId)} className="crumb-link">
              {task.projectName}
            </Link>
            <span aria-hidden>→</span>
            <span style={{ color: 'var(--ink)' }}>{taskId(task)}</span>
          </div>
          <div className="deal-header-top">
            <TextField className="ghost deal-title" testId="task-title" label="Task name" value={task.name} disabled={!canEdit} required maxLength={200} onSave={(name) => update({ name })} />
            <div className="deal-actions">
              {task.status === 'done' && <span className="badge badge-brand">Done</span>}
              {canEdit &&
                (task.status === 'done' ? (
                  <button type="button" className="btn btn-secondary" data-testid="reopen-task" onClick={() => setStatus(task, 'in_progress')}>
                    Reopen
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" data-testid="mark-done" onClick={() => setStatus(task, 'done')}>
                    Mark done
                  </button>
                ))}
              {task.canManage && (
                <div ref={menuRef} style={{ position: 'relative' }}>
                  <button type="button" className="btn btn-secondary" aria-label="More actions" aria-expanded={menu} data-testid="task-menu" onClick={() => setMenu((m) => !m)} style={{ padding: '10px 12px' }}>
                    ⋯
                  </button>
                  {menu && (
                    <div className="deal-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        data-testid="move-task"
                        onClick={() => {
                          setMenu(false);
                          setMoving(true);
                        }}
                      >
                        Move to another project
                      </button>
                      <button type="button" role="menuitem" data-testid="delete-task" onClick={() => void remove()}>
                        Delete task
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="stage-bar" data-testid="task-status-bar">
            {TASK_STATUSES.map((st, i) => {
              const at = TASK_STATUSES.findIndex((x) => x.id === task.status);
              const current = i === at;
              return (
                <button
                  key={st.id}
                  type="button"
                  className={'stage-chev' + (current ? ' current' : i < at ? ' done' : '')}
                  title={current ? `${st.label} (current status)` : `Move to ${st.label}`}
                  aria-current={current ? 'step' : undefined}
                  disabled={current || !canEdit}
                  onClick={() => setStatus(task, st.id)}
                >
                  {st.label}
                </button>
              );
            })}
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)' }} data-testid="task-meta">
            {meta}
          </span>
          {task.status === 'on_hold' && (
            <div className="hold-box" data-testid="hold-box">
              <span style={{ fontWeight: 600 }}>On hold</span>
              <TextField className="ghost ghost-sm" label="Why the work is paused" value={task.onHoldReason ?? ''} disabled={!canEdit} required maxLength={200} onSave={(onHoldReason) => update({ onHoldReason }, (t) => `${taskId(t)} on hold · ${onHoldReason}`)} />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 320px', maxWidth: 540, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card card-pad">
              <span style={{ fontSize: 15, fontWeight: 600 }}>Details</span>
              <div className="project-fields" data-testid="task-details">
                <Row label="Assignees">
                  <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: 1, minWidth: 0 }} data-testid="task-assignees">
                    {people.map((a) => (
                      <span key={a.employeeId} className="person-chip" data-employee={a.employeeId}>
                        <Avatar initials={initialsOf(a.name)} size={20} font={8.5} />
                        {a.name}
                        {a.formerMember && <span style={{ color: 'var(--muted)' }}> (former member)</span>}
                        {canEdit && (
                          <button type="button" aria-label={`Take ${a.name} off the task`} onClick={() => void unassign(a.employeeId, a.name)}>
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                    {canEdit && (
                      <button type="button" className="btn-outline" data-testid="add-assignee" onClick={() => setAdding(true)} style={{ fontSize: 12.5, padding: '3px 10px' }}>
                        Add
                      </button>
                    )}
                    {!people.length && !canEdit && <span style={{ fontSize: 13, color: 'var(--muted)' }}>Unassigned</span>}
                  </span>
                </Row>
                <Row label="Stage">
                  <select
                    className="ghost ghost-sm"
                    aria-label="Stage"
                    data-testid="task-stage"
                    value={task.stageId ?? ''}
                    disabled={!canEdit || !stages.length}
                    onChange={(e) => void update({ stageId: e.target.value || null }, (t) => `${taskId(t)} moved to ${t.stageName ?? 'no stage'}`)}
                  >
                    <option value="">No stage</option>
                    {stages.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name}
                      </option>
                    ))}
                    {task.stageId && !stages.some((st) => st.id === task.stageId) && <option value={task.stageId}>{task.stageName}</option>}
                  </select>
                </Row>
                <Row label="Start">
                  <input className="ghost ghost-sm" type="date" aria-label="Start" value={task.startDate ?? ''} disabled={!canEdit} onChange={(e) => void update({ startDate: e.target.value || null })} />
                </Row>
                <Row label="Due">
                  <input
                    className="ghost ghost-sm"
                    type="date"
                    aria-label="Due"
                    data-testid="task-due"
                    value={task.dueDate ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => void update({ dueDate: e.target.value || null })}
                    style={late ? { color: 'var(--danger)', fontWeight: 600 } : undefined}
                  />
                </Row>
                <Row label="Estimate, h">
                  <NumberField label="Estimate in hours" testId="task-estimate" value={task.estimateHours == null ? null : String(task.estimateHours)} disabled={!canEdit} step={0.25} placeholder="Not set" onSave={(estimateHours) => update({ estimateHours })} />
                </Row>
                <Row label="Waits for">
                  <select
                    className="ghost ghost-sm"
                    aria-label="Waits for"
                    data-testid="task-waits-for"
                    value={task.waitsForTaskId ?? ''}
                    disabled={!canEdit}
                    onChange={(e) => void update({ waitsForTaskId: e.target.value || null }, (t) => (t.waitsFor ? `${taskId(t)} waits for ${taskId(t.waitsFor)}` : `${taskId(t)} waits for nothing`))}
                  >
                    <option value="">—</option>
                    {(siblings ?? [])
                      .filter((x) => x.id !== task.id)
                      .sort((a, b) => a.number - b.number)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {taskId(x)} · {x.name}
                        </option>
                      ))}
                    {task.waitsFor && !siblings?.some((x) => x.id === task.waitsForTaskId) && <option value={task.waitsFor.id}>{taskId(task.waitsFor)}</option>}
                  </select>
                </Row>
                <Row label="Project">
                  <Link to={paths.project(task.projectId)} className="crumb-link" data-testid="task-project-link">
                    {task.projectName}
                  </Link>
                </Row>
                <Row label="Company">
                  <Link to={paths.company(task.companyId)} className="crumb-link">
                    {task.companyName}
                  </Link>
                </Row>
              </div>
            </div>
            <Dependencies task={task} />
          </div>
          <div style={{ flex: '999 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* CD-147: here rather than under Details, where its six columns don't fit. */}
            <PeopleAndHours task={task} onChange={set} onUnassign={(id, name) => void unassign(id, name)} />
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Description</span>
              <TextField multiline className="ghost ghost-sm" testId="task-description" label="Description" value={task.description ?? ''} disabled={!canEdit} placeholder="What needs doing, and what done looks like" maxLength={10000} onSave={(v) => update({ description: v || null })} />
            </div>
            <TaskChecklist task={task} />
            <TaskFiles task={task} />
            <TaskComments task={task} />
            <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="caps">History</span>
              {/* Assignee and limit changes don't touch the task's version: they count as a change too. */}
              <ChangeHistory entity="task" id={task.id} cur={curOf(s)} rev={`${task.version}:${task.assignees.map((a) => `${a.employeeId}${a.active}${a.hourLimit}`).join()}`} />
            </div>
          </div>
        </div>
      </div>
      {dialog}
      {adding && <AssignDialog task={task} onClose={() => setAdding(false)} onAssign={assign} />}
      {moving && (
        <MoveDialog
          task={task}
          onClose={() => setMoving(false)}
          onMove={async (projectId) => {
            if (await update({ projectId }, (t) => `${taskId(t)} moved to ${t.projectName}`)) setMoving(false);
          }}
        />
      )}
    </Screen>
  );
}

/** Design v2 §4: what this task waits for and what waits for it; each row opens that task. */
function Dependencies({ task }: { task: ApiTask }) {
  const navigate = useNavigate();
  const deps = task.dependencies ?? { waitsFor: null, blocks: [] };
  const row = (t: ApiTaskBrief) => (
    <button key={t.id} type="button" className="dep-row" data-testid="dep-row" onClick={() => navigate(paths.task(t.id))}>
      <span style={{ width: 8, height: 8, borderRadius: 4, flex: '0 0 8px', background: TASK_STATUSES.find((s) => s.id === t.status)!.dot }} />
      <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{taskId(t)}</span>
      <span className="pt-main" style={{ flex: 1, textAlign: 'left' }}>
        {t.name}
      </span>
      {t.status === 'done' || !t.dueDate ? <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{statusLabel(t.status)}</span> : <DueLabel task={t} />}
    </button>
  );
  return (
    <div className="card card-pad" data-testid="task-dependencies" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>Dependencies</span>
      <span className="caps-muted">Waits for</span>
      <div data-testid="deps-waits-for">{deps.waitsFor ? row(deps.waitsFor) : <span className="dep-empty">Nothing. This task can start any time.</span>}</div>
      <span className="caps-muted">Blocks</span>
      <div data-testid="deps-blocks">{deps.blocks.length ? deps.blocks.map(row) : <span className="dep-empty">No tasks wait for this one.</span>}</div>
    </div>
  );
}

/**
 * "Add people": the project team first, then others; several at once. The lead, owners and admins
 * give each one an hour limit too (CD-147; empty is no limit).
 */
function AssignDialog({ task, onClose, onAssign }: { task: ApiTask; onClose: () => void; onAssign: (ids: string[], hourLimits?: Record<string, number>) => Promise<void> }) {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const taken = new Set(activeAssignees(task).map((a) => a.employeeId));
  const picked = new Set(names.keys());
  const errors = Object.fromEntries([...names.keys()].map((id) => [id, limits[id]?.trim() ? quarterHourError(Number(limits[id])) : null]));
  const invalid = Object.values(errors).some(Boolean);
  return (
    <Modal maxWidth={520} onBackdrop={onClose}>
      <ModalHeader title={`Assign people to ${taskId(task)}`} sub="People with an account get an email. Everyone assigned can log time on the task." />
      <PeoplePicker
        projectId={task.projectId}
        taken={taken}
        picked={picked}
        onToggle={(id, name) =>
          setNames((cur) => {
            const next = new Map(cur);
            if (next.has(id)) next.delete(id);
            else next.set(id, name);
            return next;
          })
        }
      />
      {task.canManage && names.size > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="assign-limits">
          {[...names].map(([id, name]) => (
            <label key={id} className="form-label">
              Hour limit for {name}
              <input className="form-input" type="number" min={0.25} step={0.25} placeholder="No limit" value={limits[id] ?? ''} onChange={(e) => setLimits((cur) => ({ ...cur, [id]: e.target.value }))} data-testid="assign-limit" />
              <span style={{ fontSize: 12, color: errors[id] ? 'var(--danger)' : 'var(--text-2)' }}>{errors[id] ?? 'Empty means no limit. Use quarter hours, for example 7.5 or 7.25.'}</span>
            </label>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={picked.size && !saving && !invalid ? 'btn btn-primary' : 'btn btn-disabled'}
          disabled={!picked.size || saving || invalid}
          data-testid="assign-submit"
          onClick={async () => {
            setSaving(true);
            const set = Object.fromEntries([...names.keys()].filter((id) => limits[id]?.trim()).map((id) => [id, Number(limits[id])]));
            await onAssign([...picked], Object.keys(set).length ? set : undefined);
            setSaving(false);
          }}
        >
          {picked.size > 1 ? `Assign ${picked.size} people` : 'Assign'}
        </button>
      </div>
    </Modal>
  );
}

/** Another open project; the task lands at its current stage (the lead of both, owners and admins). */
function MoveDialog({ task, onClose, onMove }: { task: ApiTask; onClose: () => void; onMove: (projectId: string) => Promise<void> }) {
  const { data: projects } = useProjects();
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const options = (projects ?? []).filter((p) => p.status === 'open' && p.id !== task.projectId);
  return (
    <Modal maxWidth={460} onBackdrop={onClose}>
      <ModalHeader title={`Move ${taskId(task)}`} sub="It goes to the other project's current stage. Its people, dates and history come along." />
      <label className="form-label">
        Project
        <select className="form-input" data-testid="move-target" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Pick a project</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.companyName}
            </option>
          ))}
        </select>
      </label>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={target && !saving ? 'btn btn-primary' : 'btn btn-disabled'}
          disabled={!target || saving}
          data-testid="move-submit"
          onClick={async () => {
            setSaving(true);
            await onMove(target);
            setSaving(false);
          }}
        >
          Move task
        </button>
      </div>
    </Modal>
  );
}
