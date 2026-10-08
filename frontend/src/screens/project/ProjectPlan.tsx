import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiProjectStage } from '../../lib/projectsApi';
import { paths } from '../../lib/paths';
import { type ApiTask, TASK_STATUSES, taskId, type TaskStatus } from '../../lib/tasksApi';
import { useStore } from '../../store/store';
import { activeAssignees, dueText, hours } from '../../store/tasks';
import { AvatarStack, DueLabel, TaskBoard, TaskStatusBadge, useTaskUpdate } from '../task/parts';
import { ProjectGantt } from './ProjectGantt';
import { useTerms } from '../../store/terms';

type View = 'table' | 'kanban' | 'gantt';
const NO_STAGE = 'none';

/**
 * A project's Plan tab (CD-283, design v2 §2): its tasks as a Table grouped by stage (bands with
 * the count and estimate) or a Kanban by status or by stage; dropping a card changes that. "New
 * task" opens the dialog with the project fixed. Gantt: bars from start to due with the
 * dependencies as arrows (CD-269).
 */
export function ProjectPlan({ projectId, tasks, stages, canAdd, onChange }: { projectId: string; tasks: ApiTask[] | null; stages: ApiProjectStage[]; canAdd: boolean; onChange: (tasks: ApiTask[]) => void }) {
  const { set } = useStore();
  const terms = useTerms();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('table');
  const [by, setBy] = useState<'status' | 'stage'>('status');
  const replace = (t: ApiTask) => onChange((tasks ?? []).map((x) => (x.id === t.id ? t : x)));
  const { save, setStatus, dialog } = useTaskUpdate(replace);
  // A plan reads in order: T-1 before T-2 (the API lists the newest first).
  const all = [...(tasks ?? [])].sort((a, b) => a.number - b.number);
  const stageColumns = [...stages.map((st) => ({ id: st.id, label: st.name })), ...(all.some((t) => !t.stageId) ? [{ id: NO_STAGE, label: 'No stage' }] : [])];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="project-plan">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="view-toggle" role="group" aria-label="View">
          {(['table', 'kanban', 'gantt'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} data-testid={`plan-view-${v}`} onClick={() => setView(v)} style={{ padding: '0 10px', width: 'auto', fontSize: 12.5 }}>
              {v === 'table' ? 'Table' : v === 'kanban' ? 'Kanban' : 'Gantt'}
            </button>
          ))}
        </div>
        {view === 'kanban' && (
          <select className="ghost ghost-sm" aria-label="Columns" data-testid="plan-columns" value={by} onChange={(e) => setBy(e.target.value as 'status' | 'stage')} style={{ width: 'auto' }}>
            <option value="status">By {terms.task} status</option>
            <option value="stage">By project stage</option>
          </select>
        )}
        {canAdd && (
          <button type="button" className="btn btn-primary" data-testid="plan-new-task" onClick={() => set({ newTask: { projectId } })} style={{ marginLeft: 'auto', fontSize: 13, padding: '8px 14px' }}>
            New {terms.task}
          </button>
        )}
      </div>
      {!tasks ? (
        <div className="hint-box">Loading tasks</div>
      ) : view === 'gantt' ? (
        <ProjectGantt tasks={all} bands={stageColumns.map((c) => ({ ...c, tasks: all.filter((t) => (t.stageId ?? NO_STAGE) === c.id) })).filter((b) => b.tasks.length)} />
      ) : view === 'kanban' ? (
        by === 'status' ? (
          <TaskBoard tasks={all} columns={TASK_STATUSES} columnOf={(t) => t.status} onDrop={(t, status) => setStatus(t, status as TaskStatus)} showProject={false} />
        ) : (
          <TaskBoard
            tasks={all}
            columns={stageColumns}
            columnOf={(t) => t.stageId ?? NO_STAGE}
            onDrop={(t, stageId) => void save(t, { stageId: stageId === NO_STAGE ? null : stageId }, (x) => `${taskId(x)} moved to ${x.stageName ?? 'no stage'}`)}
            showProject={false}
          />
        )
      ) : (
        <div className="pipeline-table" data-testid="plan-table">
          <div className="plan-table-inner">
            <div className="table-head caps">
              <span>ID</span>
              <span>{terms.Task}</span>
              <span>Assignees</span>
              <span>Est. h</span>
              <span>Start</span>
              <span>Due</span>
              <span>Depends on</span>
              <span>Status</span>
            </div>
            {all.length === 0 && <div className="pipeline-table-empty">No {terms.tasks} yet. Add the first one with New {terms.task}.</div>}
            {stageColumns.map((col) => {
              const rows = all.filter((t) => (t.stageId ?? NO_STAGE) === col.id);
              if (!rows.length) return null;
              const est = rows.reduce((a, t) => a + (t.estimateHours ?? 0), 0);
              return (
                <div key={col.id} data-testid="plan-band" data-stage={col.label}>
                  <div className="table-band">
                    <span style={{ fontWeight: 600 }}>{col.label}</span>
                    <span style={{ color: 'var(--text-2)' }}>
                      {rows.length} {rows.length === 1 ? terms.task : terms.tasks}
                      {est ? ` · ${hours(est)}` : ''}
                    </span>
                  </div>
                  {rows.map((t) => (
                    <div key={t.id} className="table-row clickable" data-testid="plan-row" onClick={() => navigate(paths.task(t.id))}>
                      <span style={{ color: 'var(--text-2)' }}>{taskId(t)}</span>
                      <span className="pt-main" style={{ fontWeight: 600 }}>
                        {t.name}
                      </span>
                      <span>
                        <AvatarStack names={activeAssignees(t).map((a) => a.name)} size={22} />
                      </span>
                      <span style={{ color: 'var(--text-2)' }}>{t.estimateHours ?? '—'}</span>
                      <span style={{ color: 'var(--text-2)' }}>{dueText(t.startDate) ?? '—'}</span>
                      <span>{t.dueDate ? <DueLabel task={t} /> : '—'}</span>
                      <span style={{ color: 'var(--text-2)' }} data-testid="plan-depends">
                        {t.waitsFor ? taskId(t.waitsFor) : '—'}
                      </span>
                      <span>
                        <TaskStatusBadge status={t.status} />
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}

/** The Overview's "Coming up" (design v2 §2): the next open tasks by due date (undated last). */
export function ComingUp({ tasks }: { tasks: ApiTask[] | null }) {
  const navigate = useNavigate();
  const next = (tasks ?? [])
    .filter((t) => t.status !== 'done')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.number - b.number)
    .slice(0, 5);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="coming-up">
      <span className="caps">Coming up</span>
      {!tasks ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading tasks</span>
      ) : next.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>No open tasks. Add them on the Plan tab.</span>
      ) : (
        next.map((t) => (
          <button key={t.id} type="button" className="coming-row" data-testid="coming-up-row" onClick={() => navigate(paths.task(t.id))}>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, textAlign: 'left' }}>
              <span className="pt-main" style={{ fontWeight: 600 }}>
                {taskId(t)} · {t.name}
              </span>
              <span className="pt-sub">{[t.stageName, t.estimateHours != null ? hours(t.estimateHours) : null].filter(Boolean).join(' · ') || 'No stage'}</span>
            </span>
            <AvatarStack names={activeAssignees(t).map((a) => a.name)} size={22} />
            <span style={{ minWidth: 86, textAlign: 'right' }}>{t.dueDate ? <DueLabel task={t} /> : <span style={{ fontSize: 12, color: 'var(--muted)' }}>No due date</span>}</span>
          </button>
        ))
      )}
    </div>
  );
}

