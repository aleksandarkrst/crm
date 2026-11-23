import { Link } from 'react-router-dom';
import { paths } from '../../lib/paths';
import type { ApiDayStatus, ApiStatusRow } from '../../lib/timesheetApi';

/**
 * The counters of Today's status (spec 12.1), in the design's order. `always`: shown even at 0;
 * Not employed only when there are any.
 */
export const STATUS_COUNTERS: { status: ApiDayStatus; label: string; dot: string; always?: boolean }[] = [
  { status: 'working', label: 'Working', dot: 'var(--green-500)', always: true },
  { status: 'business_trip', label: 'Business trip', dot: 'var(--lime)', always: true },
  { status: 'time_off', label: 'Vacation and other time off', dot: 'var(--warn)', always: true },
  { status: 'sick_leave', label: 'Sick leave', dot: 'var(--danger)', always: true },
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
  public_holiday: 'badge badge-neutral',
  non_working: 'badge badge-neutral',
  not_employed: 'badge badge-neutral',
};

export function StatusBadge({ status, label }: { status: ApiDayStatus; label: string }) {
  return <span className={BADGE[status]}>{label}</span>;
}

/** Last week's timesheet: its status and Not submitted (no Late flag: nothing records when someone starts work, CD-350). */
export function TimesheetCell({ t }: { t: ApiStatusRow['timesheet'] }) {
  if (!t) return <span className="emp-note">—</span>;
  return (
    <span className="tst-ts">
      <Link to={paths.approvals(t.weekStart)} className="emp-note">
        {t.label}
      </Link>
      {t.notSubmitted && t.label !== 'Not submitted' && <span className="badge badge-danger">Not submitted</span>}
    </span>
  );
}
