import { useState } from 'react';
import { type ApiHoursRow, type ApiTask, quarterHourError, taskId, tasksApi } from '../../lib/tasksApi';
import { projectError } from '../../store/projects';
import { useStore } from '../../store/store';
import { useTaskHours } from '../../store/tasks';

/** The Used bar's colours (spec §8): neutral below 80 %, amber from 80 %, red from 100 %. */
const LEVEL_COLOR = { neutral: '#93A39B', amber: '#B4531B', red: '#B42318' } as const;
const h = (n: number | null) => (n == null ? '—' : `${Number(n.toFixed(2))} h`);

/**
 * People and hours (CD-147, spec §8), under Details on the task page: a row per person (removed
 * people who logged hours stay, "Not assigned any more") with their limit, logged, approved,
 * remaining ("2.5 h over" in red) and a Used bar; then the total. The lead, owners and admins edit
 * a limit inline (Enter saves, Escape cancels). Someone who only works on the task sees their own
 * hours and the others' names.
 */
export function PeopleAndHours({ task, onChange, onUnassign }: { task: ApiTask; onChange: (t: ApiTask) => void; onUnassign: (employeeId: string, name: string) => void }) {
  const { data, reload } = useTaskHours(task.id);
  const canEdit = task.access === 'act';
  if (!data) return null;
  if (!data.rows.length)
    return (
      <div className="card card-pad" data-testid="people-hours">
        <span style={{ fontSize: 15, fontWeight: 600 }}>People and hours</span>
        <span style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 10, display: 'block' }}>No one is on this task yet. Add people under Details.</span>
      </div>
    );
  const { total } = data;
  return (
    <div className="card card-pad" data-testid="people-hours" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>People and hours</span>
      <div style={{ overflowX: 'auto', margin: '0 -4px' }}>
        <div className="hours-grid">
          <div className="hours-head caps-muted">
            <span>Person</span>
            <span>Limit</span>
            <span>Logged</span>
            <span>Approved</span>
            <span>Remaining</span>
            <span>Used</span>
            <span />
          </div>
          {data.rows.map((r) => (
            <div key={r.employeeId} className="hours-row" data-testid="hours-row" data-employee={r.employeeId}>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: r.active ? 'var(--ink)' : 'var(--muted)' }}>
                  {r.name}
                  {r.formerMember && <span style={{ fontWeight: 400, color: 'var(--muted)' }}> (former member)</span>}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.active ? (r.jobTitle ?? '') : 'Not assigned any more'}</span>
              </span>
              <LimitCell
                task={task}
                row={r}
                onSaved={(t) => {
                  onChange(t);
                  void reload();
                }}
              />
              {r.visible ? (
                <>
                  <span>{h(r.logged)}</span>
                  <span>{h(r.approved)}</span>
                  <span data-testid="hours-remaining" style={r.over ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
                    {r.remaining == null ? '' : r.remaining < 0 ? `${h(-r.remaining)} over` : h(r.remaining)}
                  </span>
                  <span>{r.level && <UsedBar percent={r.usedPercent ?? 0} level={r.level} />}</span>
                </>
              ) : (
                <span className="hours-hidden" title="Only the lead and their managers see other people's hours">
                  Hours not shown
                </span>
              )}
              <span>
                {canEdit && r.active && (
                  <button type="button" className="icon-btn" aria-label={`Take ${r.name} off the task`} onClick={() => onUnassign(r.employeeId, r.name)}>
                    ×
                  </button>
                )}
              </span>
            </div>
          ))}
          <div className="hours-row hours-total" data-testid="hours-total">
            <span>Total</span>
            <span>{total.taskLimit != null ? h(total.taskLimit) : ''}</span>
            <span>{h(total.logged)}</span>
            <span>{h(total.approved)}</span>
            {total.someWithoutLimit ? (
              <span style={{ gridColumn: 'span 3', color: 'var(--text-2)', fontWeight: 400 }}>Some people have no limit</span>
            ) : (
              <span style={total.remaining != null && total.remaining < 0 ? { color: 'var(--danger)' } : undefined}>
                {total.remaining == null ? '' : total.remaining < 0 ? `${h(-total.remaining)} over` : h(total.remaining)}
              </span>
            )}
          </div>
        </div>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
        Each person logs their own time on {taskId(task)}; one person&apos;s hours never count toward another&apos;s limit. Logged and approved hours fill in from timesheets once time tracking is on.
      </span>
    </div>
  );
}

function UsedBar({ percent, level }: { percent: number; level: keyof typeof LEVEL_COLOR }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-testid="used-bar" data-level={level}>
      <span style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--chip)', overflow: 'hidden', minWidth: 36 }}>
        <span style={{ display: 'block', height: '100%', width: `${Math.min(percent, 100)}%`, background: LEVEL_COLOR[level] }} />
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--text-2)' }}>{percent}%</span>
    </span>
  );
}

/** The limit: "8 h" / "No limit"; the lead, owners and admins click to edit (Enter saves, Escape cancels). */
function LimitCell({ task, row, onSaved }: { task: ApiTask; row: ApiHoursRow; onSaved: (t: ApiTask) => void }) {
  const { flash } = useStore();
  const [draft, setDraft] = useState<string | null>(null);
  const label = row.hourLimit == null ? 'No limit' : h(row.hourLimit);
  if (!task.canManage || !row.active) return <span style={{ color: row.hourLimit == null ? 'var(--muted)' : undefined }}>{label}</span>;
  if (draft === null)
    return (
      <button type="button" className="ghost ghost-sm" data-testid="limit-edit" onClick={() => setDraft(row.hourLimit == null ? '' : String(row.hourLimit))} style={{ textAlign: 'left', padding: '2px 6px' }}>
        {label}
      </button>
    );
  const error = draft.trim() ? quarterHourError(Number(draft)) : null;
  const save = async () => {
    if (error) return;
    const next = draft.trim() ? Number(draft) : null;
    if (next === row.hourLimit) return setDraft(null);
    try {
      const saved = await tasksApi.setHourLimit(task.id, row.employeeId, next);
      setDraft(null);
      onSaved(saved);
      flash(next == null ? `${row.name} has no limit on ${taskId(task)}` : `${row.name}'s limit on ${taskId(task)} is ${h(next)}`);
    } catch (err) {
      flash(projectError(err));
    }
  };
  return (
    <span style={{ display: 'flex', flexDirection: 'column' }}>
      <input
        className="ghost ghost-sm"
        type="number"
        min={0.25}
        step={0.25}
        autoFocus
        aria-label={`Hour limit for ${row.name}`}
        data-testid="limit-input"
        value={draft}
        placeholder="No limit"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') setDraft(null);
        }}
        style={{ width: 72, borderColor: error ? 'var(--danger)' : undefined }}
      />
      {error && <span style={{ fontSize: 11, color: 'var(--danger)' }}>{error}</span>}
    </span>
  );
}
