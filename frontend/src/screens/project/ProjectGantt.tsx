import { Link } from 'react-router-dom';
import { paths } from '../../lib/paths';
import { type ApiTask, TASK_STATUSES, taskId } from '../../lib/tasksApi';
import { dueText, todayIso } from '../../store/tasks';
import { useTerms } from '../../store/terms';

const DAY = 26;
const LABEL = 230;
const HEAD = 30;
const BAND = 30;
const ROW = 38;
const MS_DAY = 86_400_000;

const dayOf = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / MS_DAY);
const isoOf = (day: number) => new Date(day * MS_DAY).toISOString().slice(0, 10);

type Line = { kind: 'band'; label: string } | { kind: 'task'; task: ApiTask };

/**
 * The Plan tab's Gantt (CD-269, design v2 §2): a bar per task from its start to its due date (one
 * day when it has only one of them), grouped by stage in bands, with today marked. An arrow runs
 * from the due date of the task it waits for to its start; a task that starts before that one is
 * due says so ("Starts before T-3 is due (12 Oct)"). Tasks without dates are listed without a bar.
 */
export function ProjectGantt({ tasks, bands }: { tasks: ApiTask[]; bands: { id: string; label: string; tasks: ApiTask[] }[] }) {
  const terms = useTerms();
  const dated = tasks.filter((t) => t.startDate || t.dueDate);
  if (!tasks.length) return <div className="hint-box">No {terms.tasks} yet. Add the first one with New {terms.task}.</div>;
  const today = dayOf(todayIso());
  const days = dated.flatMap((t) => [t.startDate, t.dueDate].filter((d): d is string => !!d).map(dayOf));
  const first = Math.min(today, ...days) - 2;
  const last = Math.max(today, ...days) + 3;
  const width = (last - first + 1) * DAY;
  const span = (t: ApiTask) => {
    const s = dayOf(t.startDate ?? t.dueDate!);
    const e = dayOf(t.dueDate ?? t.startDate!);
    return { from: Math.min(s, e), to: Math.max(s, e) };
  };

  // Rows top to bottom, with each task's vertical centre for the arrows.
  // Within a stage, by start (undated last), then by number.
  const order = (a: ApiTask, b: ApiTask) => (a.startDate ?? a.dueDate ?? '9999').localeCompare(b.startDate ?? b.dueDate ?? '9999') || a.number - b.number;
  const lines: Line[] = bands.flatMap((b) => [{ kind: 'band' as const, label: b.label }, ...[...b.tasks].sort(order).map((task) => ({ kind: 'task' as const, task }))]);
  const centre = new Map<string, number>();
  let y = 0;
  for (const l of lines) {
    if (l.kind === 'task') centre.set(l.task.id, y + ROW / 2);
    y += l.kind === 'band' ? BAND : ROW;
  }
  const height = y;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  /** A task that starts before the one it waits for is due. */
  const early = (t: ApiTask) => {
    const dep = t.waitsForTaskId ? byId.get(t.waitsForTaskId) : undefined;
    return dep?.dueDate && t.startDate && t.startDate <= dep.dueDate && dep.status !== 'done' ? dep : null;
  };
  const arrows = tasks.flatMap((t) => {
    const dep = t.waitsForTaskId ? byId.get(t.waitsForTaskId) : undefined;
    if (!dep || !(dep.startDate || dep.dueDate) || !(t.startDate || t.dueDate)) return [];
    const x1 = (span(dep).to - first + 1) * DAY;
    const x2 = (span(t).from - first) * DAY;
    const y1 = centre.get(dep.id)!;
    const y2 = centre.get(t.id)!;
    const bend = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
    return [{ id: t.id, d: `M ${x1} ${y1} H ${bend} V ${y2} H ${x2}`, warn: !!early(t) }];
  });

  // Day ticks: the 1st and every Monday get a date.
  const ticks: { x: number; label: string }[] = [];
  for (let d = first; d <= last; d++) {
    const date = new Date(d * MS_DAY);
    if (date.getUTCDate() === 1 || date.getUTCDay() === 1) ticks.push({ x: (d - first) * DAY, label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) });
  }

  return (
    <div className="gantt" data-testid="plan-gantt">
      <div style={{ width: LABEL + width, position: 'relative' }}>
        <div className="gantt-head" style={{ height: HEAD }}>
          <span className="gantt-label caps-muted" style={{ width: LABEL }}>
            {terms.Task}
          </span>
          <span style={{ position: 'relative', width, height: HEAD }}>
            {ticks.map((t) => (
              <span key={t.x} className="gantt-tick" style={{ left: t.x }}>
                {t.label}
              </span>
            ))}
          </span>
        </div>
        <div style={{ position: 'relative' }}>
          {lines.map((l, i) =>
            l.kind === 'band' ? (
              <div key={`band-${i}`} className="gantt-band" style={{ height: BAND }}>
                <span style={{ position: 'sticky', left: 0, padding: '0 12px', fontWeight: 600 }}>{l.label}</span>
              </div>
            ) : (
              <div key={l.task.id} className="gantt-row" data-testid="gantt-row" data-task={taskId(l.task)} style={{ height: ROW }}>
                <span className="gantt-label" style={{ width: LABEL }}>
                  <Link to={paths.task(l.task.id)} className="pt-main" style={{ fontWeight: 600, color: 'var(--ink)', textDecoration: 'none' }}>
                    <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{taskId(l.task)}</span> {l.task.name}
                  </Link>
                  {early(l.task) && (
                    <span className="gantt-warn" data-testid="gantt-warning">
                      Starts before {taskId(early(l.task)!)} is due ({dueText(early(l.task)!.dueDate)})
                    </span>
                  )}
                </span>
                <span style={{ position: 'relative', width, height: ROW }}>
                  {l.task.startDate || l.task.dueDate ? (
                    <span
                      className="gantt-bar"
                      data-testid="gantt-bar"
                      title={`${taskId(l.task)} · ${l.task.startDate ? dueText(l.task.startDate) : '…'} → ${l.task.dueDate ? dueText(l.task.dueDate) : '…'}`}
                      style={{
                        left: (span(l.task).from - first) * DAY + 2,
                        width: (span(l.task).to - span(l.task).from + 1) * DAY - 4,
                        background: TASK_STATUSES.find((s) => s.id === l.task.status)!.dot,
                        opacity: l.task.status === 'done' ? 0.55 : 1,
                      }}
                    />
                  ) : (
                    <span style={{ position: 'absolute', left: 8, top: 11, fontSize: 12, color: 'var(--muted)' }}>No dates</span>
                  )}
                </span>
              </div>
            ),
          )}
          <span className="gantt-today" style={{ left: LABEL + (today - first) * DAY + DAY / 2, height }} title={`Today, ${dueText(isoOf(today))}`} />
          <svg width={width} height={height} style={{ position: 'absolute', top: 0, left: LABEL, pointerEvents: 'none' }} aria-hidden="true">
            <defs>
              <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="#475750" />
              </marker>
              <marker id="gantt-arrow-warn" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" fill="#B4531B" />
              </marker>
            </defs>
            {arrows.map((a) => (
              <path key={a.id} d={a.d} fill="none" stroke={a.warn ? '#B4531B' : '#475750'} strokeWidth="1.4" markerEnd={`url(#${a.warn ? 'gantt-arrow-warn' : 'gantt-arrow'})`} data-testid="gantt-arrow" />
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
