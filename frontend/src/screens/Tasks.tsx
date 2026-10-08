import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Screen } from '../components/Layout';
import { FilterBar } from '../components/ui';
import { paths } from '../lib/paths';
import { type ApiTask, TASK_STATUSES, taskId, type TaskStatus } from '../lib/tasksApi';
import { activeAssignees, hours, isLate, todayIso, useTasks } from '../store/tasks';
import { useStore } from '../store/store';
import { AvatarStack, DueLabel, TaskBoard, useTaskUpdate } from './task/parts';
import { useTerms } from '../store/terms';

type View = 'kanban' | 'table';
const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'kanban', label: 'Kanban', icon: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z' },
  { id: 'table', label: 'Table', icon: 'M4 6h16M4 12h16M4 18h16' },
];
const viewKey = (userId: string, tenantId: string) => `crm.tasksView.${userId}.${tenantId}`;
const DUE_FILTER = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'week', label: 'Due in 7 days' },
  { value: 'none', label: 'No due date' },
];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** YYYY-MM-DD a week from `iso`. */
const weekAfter = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
};

/**
 * Tasks (CD-283, design v2 §3): every task the caller can see. Kanban (To do · In progress · On
 * hold · Done; drag a card to change its status, On hold asks why) or Table (status inline).
 * Filters: project, assignee ("Me" too) and due. The view is remembered per person and workspace.
 */
export function Tasks() {
  const { s, set, session } = useStore();
  const terms = useTerms();
  const navigate = useNavigate();
  const { data: tasks, error, set: setTasks } = useTasks();
  const [view, setViewState] = useState<View>(() => {
    try {
      return localStorage.getItem(viewKey(session.userId, session.tenant.id)) === 'table' ? 'table' : 'kanban';
    } catch {
      return 'kanban';
    }
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(viewKey(session.userId, session.tenant.id), v);
    } catch {
      // No storage: the choice lasts until the page is left.
    }
  };
  const [project, setProject] = useState('Project');
  const [assignee, setAssignee] = useState('Assignee');
  const [due, setDue] = useState('Due');
  const replace = (t: ApiTask) => setTasks((tasks ?? []).map((x) => (x.id === t.id ? t : x)));
  const { setStatus, dialog } = useTaskUpdate(replace);

  const me = s.team.find((m) => m.id === session.userId)?.employeeId ?? null;
  const all = tasks ?? [];
  const projects = [...new Map(all.map((t) => [t.projectId, t.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  const people = [...new Map(all.flatMap((t) => activeAssignees(t)).map((a) => [a.employeeId, a.name])).entries()]
    .filter(([id]) => id !== me)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
  const today = todayIso();
  const shown = all
    .filter((t) => project === 'Project' || t.projectId === project)
    .filter((t) => assignee === 'Assignee' || activeAssignees(t).some((a) => a.employeeId === (assignee === 'me' ? me : assignee)))
    .filter((t) => due === 'Due' || (due === 'none' ? !t.dueDate : due === 'overdue' ? isLate(t, today) : !!t.dueDate && t.status !== 'done' && t.dueDate <= weekAfter(today)));
  const dirty = project !== 'Project' || assignee !== 'Assignee' || due !== 'Due';
  const open = shown.filter((t) => t.status !== 'done');
  const estimate = open.reduce((a, t) => a + (t.estimateHours ?? 0), 0);

  return (
    <Screen title={terms.Tasks}>
      <FilterBar
        lead={
          <div className="view-toggle" role="group" aria-label="View">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" title={v.label} aria-label={v.label} aria-pressed={view === v.id} data-testid={`tasks-view-${v.id}`} onClick={() => setView(v.id)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={v.icon} />
                </svg>
              </button>
            ))}
          </div>
        }
        chips={[
          { value: project, options: [{ value: 'Project', label: terms.Project }, ...projects], onChange: setProject },
          { value: assignee, options: ['Assignee', ...(me ? [{ value: 'me', label: 'Me' }] : []), ...people], onChange: setAssignee },
          { value: due, options: ['Due', ...DUE_FILTER], onChange: setDue },
        ]}
        dirty={dirty}
        onClear={() => {
          setProject('Project');
          setAssignee('Assignee');
          setDue('Due');
        }}
        meta={tasks ? `${plural(shown.length, terms.task, terms.tasks)}${estimate ? ` · ${hours(estimate)} estimated` : ''}` : undefined}
        action={{ label: `New ${terms.task}`, onClick: () => set({ newTask: project !== 'Project' ? { projectId: project } : {} }) }}
      />

      {!tasks ? (
        <div className="hint-box">{error ? `Couldn't load ${terms.tasks}: ${error}` : `Loading ${terms.tasks}`}</div>
      ) : view === 'table' ? (
        <TasksTable tasks={shown} onOpen={(id) => navigate(paths.task(id))} onStatus={setStatus} />
      ) : (
        <>
          <TaskBoard tasks={shown} columns={TASK_STATUSES} columnOf={(t) => t.status} onDrop={(t, status) => setStatus(t, status as TaskStatus)} />
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '10px 0 0' }}>
            Drag {terms.aTask} to change its status. Click {terms.aTask} to open it, or the {terms.project} name to open the {terms.project}.
          </p>
        </>
      )}
      {dialog}
    </Screen>
  );
}

/** The table view (design v2 §3): ID, Task, Project (+ company), Stage, Assignees, Est. h, Due, Status (inline). */
function TasksTable({ tasks, onOpen, onStatus }: { tasks: ApiTask[]; onOpen: (id: string) => void; onStatus: (t: ApiTask, s: TaskStatus) => void }) {
  const terms = useTerms();
  return (
    <div className="pipeline-table" data-testid="tasks-table">
      <div className="tasks-table-inner">
        <div className="table-head caps">
          <span>ID</span>
          <span>{terms.Task}</span>
          <span>{terms.Project}</span>
          <span>Stage</span>
          <span>Assignees</span>
          <span>Est. h</span>
          <span>Due</span>
          <span>Status</span>
        </div>
        {tasks.length === 0 && <div className="pipeline-table-empty">No {terms.tasks} match these filters.</div>}
        {tasks.map((t) => (
          <div key={t.id} className="table-row clickable" data-testid="tasks-row" onClick={() => onOpen(t.id)}>
            <span style={{ color: 'var(--text-2)' }}>{taskId(t)}</span>
            <span className="pt-main" style={{ fontWeight: 600 }}>
              {t.name}
            </span>
            <span className="pt-cell">
              <Link to={paths.project(t.projectId)} className="pt-main crumb-link" onClick={(e) => e.stopPropagation()}>
                {t.projectName}
              </Link>
              <span className="pt-sub">{t.companyName}</span>
            </span>
            <span className="pt-main" style={{ color: 'var(--text-2)' }}>
              {t.stageName ?? '—'}
            </span>
            <span>
              <AvatarStack names={activeAssignees(t).map((a) => a.name)} size={22} />
            </span>
            <span style={{ color: 'var(--text-2)' }}>{t.estimateHours ?? '—'}</span>
            <span>{t.dueDate ? <DueLabel task={t} /> : '—'}</span>
            <span onClick={(e) => e.stopPropagation()}>
              <select className="ghost ghost-sm" aria-label={`Status of ${taskId(t)}`} data-testid="task-status-select" value={t.status} disabled={t.access !== 'act'} onChange={(e) => onStatus(t, e.target.value as TaskStatus)}>
                {TASK_STATUSES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
