import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { type ApiLoggable, type ApiTimesheetWeek, timesheetApi } from '../../lib/timesheetApi';
import { projectError } from '../../store/projects';

/**
 * Add a row to the week (CD-351, replaces the inline search): pick the project, then a task or
 * work order on it, or "No task" for time on the project itself where the workspace allows it (CD-350). Projects are the ones the person can log on now ("Company › Project"; a work
 * order without a project goes under its company); what is already in the week is left out.
 */
export function AddRowDialog({ week, employeeId, onAdd, onClose }: { week: ApiTimesheetWeek; employeeId?: string; onAdd: (item: ApiLoggable) => Promise<void>; onClose: () => void }) {
  const [items, setItems] = useState<ApiLoggable[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [project, setProject] = useState('');
  const [itemId, setItemId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    timesheetApi.loggable(employeeId).then(
      (list) => alive && setItems(list),
      (err) => alive && setFailed(projectError(err)),
    );
    return () => {
      alive = false;
    };
  }, [employeeId]);

  const inWeek = useMemo(() => new Set(week.rows.map((r) => r.id)), [week.rows]);
  const open = useMemo(() => (items ?? []).filter((i) => !inWeek.has(i.id)), [items, inWeek]);
  const projects = useMemo(() => [...new Set(open.map((i) => i.path))].sort((a, b) => a.localeCompare(b)), [open]);
  const rank = { project: 0, task: 1, work_order: 2 } as const;
  const onProject = open.filter((i) => i.path === project).sort((a, b) => rank[a.kind] - rank[b.kind] || a.code.localeCompare(b.code, undefined, { numeric: true }));
  // One project: it is picked already.
  useEffect(() => {
    if (projects.length === 1 && !project) setProject(projects[0]!);
  }, [projects, project]);

  const who = employeeId ? (week.employee?.name ?? 'They') : 'You';
  const empty = !items ? null : !items.length ? `${who === 'You' ? 'You are' : `${who} is`} on no open task or work order yet, so there is nothing to log time on.` : !open.length ? `Everything ${who === 'You' ? 'you' : who} can log on is in this week already.` : null;
  const add = async () => {
    const item = onProject.find((i) => i.id === itemId);
    if (!item) return;
    setBusy(true);
    await onAdd(item);
    onClose();
  };

  return (
    <Modal maxWidth={480} onBackdrop={() => !busy && onClose()}>
      <ModalHeader title="Add a row" sub="Choose the project, then the task or work order to log time on, or the project itself when your workspace allows it." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="ts-add-dialog">
        {failed ? (
          <span className="emp-error">{failed}</span>
        ) : !items ? (
          <span className="emp-note">Loading</span>
        ) : empty ? (
          <span className="emp-note" data-testid="ts-add-empty">
            {empty}
          </span>
        ) : (
          <>
            <label className="policy-field">
              <span className="th">Project</span>
              <select
                className="form-input"
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setItemId('');
                }}
                data-testid="ts-add-project"
              >
                <option value="">Pick a project</option>
                {projects.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="policy-field">
              <span className="th">{onProject.some((i) => i.kind === 'project') ? 'Task (optional)' : 'Task or work order'}</span>
              <select className="form-input" value={itemId} disabled={!project} onChange={(e) => setItemId(e.target.value)} data-testid="ts-add-item">
                <option value="">{project ? 'Pick a task or work order' : 'Pick a project first'}</option>
                {onProject.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.kind === 'project' ? 'No task (time on the project)' : `${i.code} ${i.name}${i.kind === 'work_order' ? ' (work order)' : ''}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !itemId} onClick={() => void add()} data-testid="ts-add-go">
            {busy ? 'Adding…' : 'Add row'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
