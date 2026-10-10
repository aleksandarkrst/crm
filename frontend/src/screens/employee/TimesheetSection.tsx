import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { paths } from '../../lib/paths';
import { useStore } from '../../store/store';
import { dateLabel, Row } from './parts';

/** The read-only CD-161 block; server permissions decide whether it is visible. */
export function TimesheetSection({ id }: { id: string }) {
  const { s, employeeCard } = useStore();
  useEffect(() => { void employeeCard.loadMyEmployeeId(); }, [employeeCard]);
  useEffect(() => {
    void employeeCard.timesheetSummary(id);
  }, [id, s.timesheetRev, s.peopleRev, employeeCard]);
  const result = s.employeeTimesheets[id];
  if (result?.status === 'hidden') return null;
  const summary = result?.status === 'ready' ? result.summary : undefined;
  return (
    <section className="card card-pad emp-timesheet" data-testid="employee-timesheet">
      <h3>Timesheet</h3>
      {!summary ? <p className="emp-note" role={result?.status === 'error' ? 'alert' : undefined}>{result?.status === 'error' ? 'Timesheet summary could not be loaded.' : 'Loading timesheet summary'}</p>
        : !summary.applicable ? <p className="emp-note">Not applicable — timesheet not required.</p>
          : <>
            <div className="emp-timesheet-stats">
              <div><span className="caps">Late (12 months)</span><strong className={summary.lateCount ? 'emp-timesheet-late' : undefined}>{summary.lateCount}</strong><span className="emp-note">{summary.autoSubmittedCount} auto-submitted</span></div>
              <div><span className="caps">Weeks with returned days</span><strong>{summary.returnedWeekCount}</strong><span className="emp-note">Last 12 months</span></div>
            </div>
            <Row label="Last week"><span>{summary.lastWeek.statusLabel}{summary.lastWeek.late ? ' · Late' : ''}</span></Row>
            <p className="emp-note">{dateLabel(summary.from)} to {dateLabel(summary.through)}</p>
            <h4>Recent late weeks</h4>
            {summary.recent.length === 0 ? <p className="emp-note">No late submissions in the last 12 months.</p> : summary.recent.map((week) => <div key={week.weekStart} className="emp-timesheet-week">
              <strong>{week.label}</strong>
              <span className="emp-note">Deadline: {dateLabel(week.deadline.date)}, {week.deadline.time}</span>
              {week.firstSubmittedAt && <span className="emp-note">First submitted: {new Date(week.firstSubmittedAt).toLocaleString('en-GB', { timeZone: s.workspace?.timezone ?? 'UTC' })}</span>}
              <span className={week.autoSubmitted ? 'badge badge-neutral' : 'badge badge-danger'}>{week.detail}</span>
            </div>)}
            {s.myEmployeeId === id && <Link className="btn btn-secondary" to={paths.timesheet(summary.lastWeek.weekStart)}>Open timesheet</Link>}
            <p className="emp-note">Visible to the employee, their managers and Admins. The count cannot be edited.</p>
          </>}
    </section>
  );
}
