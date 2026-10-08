import { useState } from 'react';
import { Modal, ModalHeader } from '../components/ui';
import { quarterHourError, taskId, tasksApi } from '../lib/tasksApi';
import { projectError, useProjects } from '../store/projects';
import { useStore } from '../store/store';
import { PeoplePicker } from '../screens/task/parts';

/**
 * New task (CD-283, design v2 "Dialogs"). Opened with `s.newTask`: from a project's Plan tab the
 * project is fixed; from the Tasks page, "+" or Ctrl/⌘K the person picks one of the open projects.
 * The task goes into the project's plan at its current stage. People: the project team first, then
 * others; those with an account get an email.
 */
export function NewTaskDialog() {
  const { s, set, flash } = useStore();
  const seed = s.newTask ?? {};
  const { data: projects, error } = useProjects();
  const [projectId, setProjectId] = useState(seed.projectId ?? '');
  const [name, setName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const close = () => set({ newTask: null });

  const open = (projects ?? []).filter((p) => p.status === 'open');
  const fixed = seed.projectId ? projects?.find((p) => p.id === seed.projectId) : undefined;
  const estimateError = estimate.trim() ? quarterHourError(Number(estimate)) : null;
  const blocked = !projectId ? 'Pick the project the task belongs to.' : !name.trim() ? 'Give the task a name.' : estimateError;

  const create = async () => {
    if (blocked || saving) return;
    setSaving(true);
    try {
      const task = await tasksApi.create({
        projectId,
        name: name.trim(),
        dueDate: dueDate || null,
        estimateHours: estimate.trim() ? Number(estimate) : null,
        assigneeIds: [...picked],
      });
      flash(`${taskId(task)} ${task.name} added to ${task.projectName}`);
      close();
    } catch (err) {
      flash(projectError(err));
      setSaving(false);
    }
  };

  return (
    <Modal maxWidth={600} onBackdrop={close}>
      <ModalHeader title="New task" sub="Office work on a project: quotes, calls, admin, follow-ups. It goes into the project plan at its current stage." />
      <label className="form-label">
        Task
        <input className="form-input" autoFocus data-testid="task-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="e.g. Survey report and unit sizing" />
      </label>
      <label className="form-label">
        Project
        {seed.projectId ? (
          <input className="form-input" value={fixed ? `${fixed.name} · ${fixed.companyName}` : ''} disabled data-testid="task-project-fixed" />
        ) : (
          <select
            className="form-input"
            data-testid="task-project"
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setPicked(new Set());
            }}
          >
            <option value="">{error ? `Couldn't load projects: ${error}` : 'Pick a project'}</option>
            {open.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.companyName}
              </option>
            ))}
          </select>
        )}
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <label className="form-label">
          Due
          <input className="form-input" type="date" data-testid="task-due-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="form-label">
          Estimate (h)
          <input className="form-input" type="number" min={0.25} step={0.25} data-testid="task-estimate-input" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="Optional" />
          {estimateError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{estimateError}</span>}
        </label>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caps">Assignees{picked.size ? ` · ${picked.size}` : ''}</span>
        {projectId ? (
          <PeoplePicker
            projectId={projectId}
            taken={new Set()}
            picked={picked}
            onToggle={(id) =>
              setPicked((cur) => {
                const next = new Set(cur);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
          />
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Pick a project first: its team is listed first.</span>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className={blocked || saving ? 'btn btn-disabled' : 'btn btn-primary'}
          disabled={!!blocked || saving}
          title={blocked ?? undefined}
          data-testid="create-task-submit"
          onClick={() => void create()}
        >
          {saving ? 'Adding…' : 'Add task'}
        </button>
      </div>
    </Modal>
  );
}
