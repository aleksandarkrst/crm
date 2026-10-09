import { Screen } from '../components/Layout';
import { useWorkload } from '../store/projects';
import { initialsOf } from '../store/selectors';
import { dueText } from '../store/tasks';

/**
 * Reports · Workload (CD-261, design v2 §9 `#workload`): remaining task hours per person and week
 * across open projects, by team, read-only. A task's remaining hours are its estimate (shared by its
 * people) minus what each logged, spread from its start (or today) to its due date. More than 40 h
 * in a week is red. Not in the sidebar: Ctrl/⌘K → Go to → Workload.
 */

const CAP_MINUTES = 40 * 60;
const COLS = 'minmax(220px, 1.5fr) repeat(8, minmax(72px, 1fr)) minmax(120px, 0.9fr)';

export function Workload() {
  const { data, error } = useWorkload();
  return (
    <Screen title="Reports · Workload">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }} data-testid="workload">
        <div className="filter-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.45, flex: '1 1 320px' }}>
            A read-only report of remaining task hours per person across open projects. To plan capacity, move work or approve time off, use Workforce → Planner.
          </span>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-2)', flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--danger-soft)' }} />
              Over 40 h
            </span>
          </div>
        </div>
        {error ? (
          <div className="hint-box">Couldn't load the workload: {error}</div>
        ) : !data ? (
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading the workload</div>
        ) : !data.teams.length ? (
          <div className="hint-box">Nobody has open work with an estimate in open projects.</div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflowX: 'auto', overflowY: 'hidden' }}>
            <div style={{ minWidth: 980 }}>
              <div className="table-head" style={{ gridTemplateColumns: COLS }}>
                <span className="th">Person</span>
                {data.weeks.map((w) => (
                  <span key={w} className="th" style={{ textAlign: 'center' }}>
                    {dueText(w)}
                  </span>
                ))}
                <span className="th">Projects</span>
              </div>
              {data.teams.map((team) => (
                <div key={team.name}>
                  <div style={{ padding: '9px 16px', background: 'var(--bg-soft)', borderBottom: '1px solid var(--divider)', fontSize: 13, fontWeight: 600 }}>{team.name}</div>
                  {team.rows.map((r) => (
                    <div key={r.employeeId} className="table-row" style={{ gridTemplateColumns: COLS, paddingTop: 8, paddingBottom: 8 }} data-testid="workload-row">
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <span className="avatar" style={{ width: 26, height: 26, fontSize: 10, fontWeight: 600 }}>
                          {initialsOf(r.name)}
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.jobTitle ?? ''}</span>
                        </span>
                      </span>
                      {r.cells.map((m, i) => {
                        const over = m > CAP_MINUTES;
                        const v = Math.round(m / 60);
                        return (
                          <span
                            key={data.weeks[i]}
                            data-testid="workload-cell"
                            style={{
                              height: 30,
                              borderRadius: 6,
                              background: over ? 'var(--danger-soft)' : 'var(--bg-soft)',
                              color: over ? 'var(--danger)' : 'var(--ink)',
                              fontSize: 12.5,
                              fontWeight: 500,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {v ? `${v} h` : ''}
                          </span>
                        );
                      })}
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.projects.join(' · ') || '—'}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Screen>
  );
}
