import { Link } from 'react-router-dom';
import { paths } from '../../lib/paths';
import type { ApiDayStatus, ApiStatusRow } from '../../lib/timesheetApi';
import { useStore } from '../../store/store';
import { useTeamStatus } from '../../store/timesheet';

/**
 * The counters of Today's status (spec 12.1), in the design's order. `always`: shown even at 0;
 * Out of office (absences whose type the caller may not see) and Not employed only when there are any.
 */
export const STATUS_COUNTERS: { status: ApiDayStatus; label: string; dot: string; always?: boolean }[] = [
  { status: 'working', label: 'Working', dot: 'var(--green-500)', always: true },
  { status: 'business_trip', label: 'Business trip', dot: 'var(--lime)', always: true },
  { status: 'time_off', label: 'Vacation and other time off', dot: 'var(--warn)', always: true },
  { status: 'sick_leave', label: 'Sick leave', dot: 'var(--danger)', always: true },
  { status: 'out_of_office', label: 'Out of office', dot: 'var(--text-2)' },
  { status: 'public_holiday', label: 'Public holiday', dot: 'var(--brand)', always: true },
  { status: 'non_working', label: 'Not a working day', dot: 'var(--muted)', always: true },
  { status: 'not_employed', label: 'Not employed', dot: 'var(--dashed)' },
];

export const statusCounts = (rows: readonly ApiStatusRow[]): Record<ApiDayStatus, number> => {
  const out = Object.fromEntries(STATUS_COUNTERS.map((c) => [c.status, 0])) as Record<ApiDayStatus, number>;
  for (const r of rows) out[r.status] += 1;
  return out;
};

const BADGE: Record<ApiDayStatus, string> = {
  working: 'badge badge-brand',
  business_trip: 'badge tst-badge-trip',
  time_off: 'badge badge-warn',
  sick_leave: 'badge badge-danger',
  out_of_office: 'badge badge-neutral',
  public_holiday: 'badge badge-neutral',
  non_working: 'badge badge-neutral',
  not_employed: 'badge badge-neutral',
};

export function StatusBadge({ status, label }: { status: ApiDayStatus; label: string }) {
  return <span className={BADGE[status]}>{label}</span>;
}

/** Last week's timesheet: its status, and Late or Not submitted. */
export function TimesheetCell({ t }: { t: ApiStatusRow['timesheet'] }) {
  if (!t) return <span className="emp-note">—</span>;
  return (
    <span className="tst-ts">
      <Link to={paths.approvals(t.weekStart)} className="emp-note">
        {t.label}
      </Link>
      {t.late && <span className="badge badge-warn">Late</span>}
      {t.notSubmitted && t.label !== 'Not submitted' && <span className="badge badge-danger">Not submitted</span>}
    </span>
  );
}

const AWAY: ReadonlySet<ApiDayStatus> = new Set(['business_trip', 'time_off', 'sick_leave', 'out_of_office']);

/**
 * The Today screen's "Team today" card (spec 12.1): for managers, the counters for their direct
 * and indirect reports and the names of those away. Nothing for people without reports.
 */
export function TeamTodayCard() {
  const { s } = useStore();
  const { data } = useTeamStatus(s.visitScope.seesTeam, undefined, 'reports');
  const rows = (data?.rows ?? []).filter((r) => r.status !== 'not_employed');
  if (!rows.length) return null;
  const counts = statusCounts(rows);
  const away = rows.filter((r) => AWAY.has(r.status));
  const counters = STATUS_COUNTERS.filter((c) => c.status !== 'not_employed' && (counts[c.status] > 0 || c.status === 'working'));
  return (
    <section className="card tst-card" data-testid="team-today">
      <div className="tst-card-head">
        <span className="caps">Team today</span>
        <Link to={paths.teamStatus()} className="emp-note">
          Today's status
        </Link>
      </div>
      <div className="tst-card-counts">
        {counters.map((c) => (
          <span key={c.status} className="tst-card-count" data-testid={`team-today-${c.status}`}>
            <span className="tst-dot" style={{ background: c.dot }} />
            <strong>{counts[c.status]}</strong>
            <span className="emp-note">{c.label}</span>
          </span>
        ))}
      </div>
      {away.length > 0 && (
        <ul className="tst-card-away">
          {away.map((r) => (
            <li key={r.id}>
              <Link to={paths.employee(r.id)}>{r.name}</Link>
              <span className="emp-note">
                {' · '}
                {r.label}
                {r.detail ? `, ${r.detail.charAt(0).toLowerCase()}${r.detail.slice(1)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
