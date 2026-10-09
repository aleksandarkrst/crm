import type { ApiProjectReport } from '../../lib/projectsApi';
import { useProjectReport } from '../../store/projects';
import { initialsOf } from '../../store/selectors';
import { dueText, hours } from '../../store/tasks';
import { useTerms } from '../../store/terms';

/**
 * A project's Report tab (CD-261, design v2 §2 `#project-report`): a summary line, "By stage"
 * (Stage, Tasks, Estimate, Logged, Remaining, Done by estimate, Due) and "By person" (Person, Open,
 * Overdue, Estimate, Logged, Remaining, vs estimate). Hours compare with estimates; a task's
 * estimate is shared by its people, logged hours are each person's own (the API computes it).
 */

const STAGE_COLS = 'minmax(170px, 1.4fr) 80px 90px 90px 100px minmax(160px, 1.4fr) 90px';
const PERSON_COLS = 'minmax(190px, 1.5fr) 90px 80px 90px 90px 100px 100px';

const h = (minutes: number) => hours(minutes / 60)!;
const num = (minutes: number) => String(Number((minutes / 60).toFixed(2)));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "40% done by estimate. 14 of 20 hours logged against a budget of 100 hours; 8 hours remaining. …" */
export function reportSummary(r: ApiProjectReport, words: { task: string; tasks: string }, endDate: string | null): string {
  const s = r.summary;
  const parts = [
    `${s.donePercent}% done by estimate.`,
    s.budgetMinutes != null
      ? `${num(s.loggedMinutes)} of ${num(s.estimateMinutes)} hours logged against a budget of ${num(s.budgetMinutes)} hours; ${num(s.remainingMinutes)} hours remaining.`
      : `${num(s.loggedMinutes)} of ${num(s.estimateMinutes)} hours logged; ${num(s.remainingMinutes)} hours remaining.`,
  ];
  if (s.doneTasks && s.variancePercent != null) parts.push(`Finished ${words.tasks} ran ${Math.abs(s.variancePercent)}% ${s.variancePercent >= 0 ? 'over' : 'under'} estimate.`);
  if (s.lateTasks) {
    const late = `${plural(s.lateTasks, `${words.task} is`, `${words.tasks} are`)} late`;
    parts.push(s.onHoldTasks ? `${late} and ${plural(s.onHoldTasks, 'is', 'are')} on hold.` : `${late}.`);
  } else parts.push('Nothing is late.');
  if (s.forecast) parts.push(s.forecast.slipDays ? `Forecast finish is ${dueText(s.forecast.date)}, ${s.forecast.slipDays} days after the plan.` : `Forecast finish is on plan, ${dueText(endDate)}.`);
  return parts.join(' ');
}

export function ProjectReport({ projectId, endDate }: { projectId: string; endDate: string | null }) {
  const t = useTerms();
  const { data: report, error } = useProjectReport(projectId, true);
  if (error) return <div className="hint-box">Couldn't load the report: {error}</div>;
  if (!report) return <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading the report</div>;
  if (!report.summary.tasks) return <div className="hint-box">No {t.tasks} yet. The report fills in as {t.tasks} get estimates and time.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }} data-testid="project-report">
      <div className="hint-box" data-testid="report-summary">
        {reportSummary(report, t, endDate)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="card-title">By stage</span>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflowX: 'auto', overflowY: 'hidden' }}>
          <div style={{ minWidth: 760 }}>
            <div className="table-head" style={{ gridTemplateColumns: STAGE_COLS }}>
              {['Stage', t.Tasks, 'Estimate', 'Logged', 'Remaining', 'Done, by estimate', 'Due'].map((c) => (
                <span key={c} className="th">
                  {c}
                </span>
              ))}
            </div>
            {report.stages.map((r) => (
              <div key={r.id ?? 'none'} className="table-row" style={{ gridTemplateColumns: STAGE_COLS }} data-testid="report-stage">
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span>
                  {r.doneTasks} / {r.tasks}
                </span>
                <span>{h(r.estimateMinutes)}</span>
                <span style={{ color: r.overEstimate ? 'var(--danger)' : 'var(--ink)' }}>{h(r.loggedMinutes)}</span>
                <span>{h(r.remainingMinutes)}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--chip)', overflow: 'hidden' }}>
                    <span style={{ display: 'block', width: `${r.donePercent}%`, height: '100%', background: 'var(--brand)' }} />
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', width: 34, textAlign: 'right' }}>{r.donePercent}%</span>
                </span>
                <span style={{ color: r.lateTasks ? 'var(--danger)' : 'var(--text-2)' }}>{dueText(r.dueDate) ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="card-title">By person</span>
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflowX: 'auto', overflowY: 'hidden' }}>
          <div style={{ minWidth: 720 }}>
            <div className="table-head" style={{ gridTemplateColumns: PERSON_COLS }}>
              {['Person', 'Open', 'Overdue', 'Estimate', 'Logged', 'Remaining', 'vs estimate'].map((c) => (
                <span key={c} className="th">
                  {c}
                </span>
              ))}
            </div>
            {report.people.map((r) => (
              <div key={r.employeeId} className="table-row" style={{ gridTemplateColumns: PERSON_COLS }} data-testid="report-person">
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span className="avatar" style={{ width: 24, height: 24, fontSize: 9.5, fontWeight: 600 }}>
                    {initialsOf(r.name)}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                </span>
                <span>{r.openTasks}</span>
                <span style={{ color: r.lateTasks ? 'var(--danger)' : 'var(--ink)' }}>{r.lateTasks}</span>
                <span>{h(r.estimateMinutes)}</span>
                <span>{h(r.loggedMinutes)}</span>
                <span>{h(r.remainingMinutes)}</span>
                <span style={{ color: r.variancePercent != null && r.variancePercent > 5 ? 'var(--danger)' : 'var(--text-2)' }}>
                  {r.variancePercent == null ? '—' : `${r.variancePercent > 0 ? '+' : ''}${r.variancePercent}%`}
                </span>
              </div>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>"vs estimate" compares logged hours with estimates on finished {t.tasks} only.</span>
      </div>
    </div>
  );
}
