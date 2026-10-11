import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { askConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { addDays, type ApiApprovalRow, type ApiApprovals, approvalsApi, dayLabel, shortHours } from '../lib/timesheetApi';
import { projectError } from '../store/projects';
import { useStore } from '../store/store';
import { useApprovals } from '../store/timesheet';
import { DaySquares, WEEK_BADGE } from './approvals/parts';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Employee · Status · Days · Entered · actions (the handoff's list columns). */
const COLS = 'minmax(170px, 1.4fr) minmax(150px, 1fr) 150px 110px minmax(150px, auto)';
const short = (date: string) => DAY_SHORT[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]!;

function Panel({ title, rows, testId, line }: { title: string; rows: ApiApprovalRow[]; testId: string; line: (r: ApiApprovalRow) => string }) {
  return (
    <section className="card ap-panel" data-testid={testId}>
      <div className="ap-panel-title">
        <span className="caps">{title}</span>
        <strong>{rows.length}</strong>
      </div>
      {rows.length === 0 ? (
        <span className="emp-note">Nobody</span>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.employee.id}>
              <Link to={paths.approval(r.employee.id)}>{r.employee.name}</Link>
              <span className="emp-note"> · {line(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Approvals (CD-157, design `Timesheet.dc.html#cd-157`): the weeks the caller approves. At the top
 * who has not submitted, who was late and whose days are back with them; below one row per
 * employee with the week's status, a square per day, the hours and Approve. A row opens the
 * person's week, where days are approved or rejected one by one.
 */
export function Approvals() {
  const { s, flash } = useStore();
  const [params, setParams] = useSearchParams();
  const weekParam = params.get('week') ?? undefined;
  const { data, error, set } = useApprovals(weekParam);
  const [busy, setBusy] = useState<string | null>(null);
  const go = (monday: string | null) => setParams(monday ? { week: monday } : {});

  const approve = async (a: ApiApprovals, r: ApiApprovalRow) => {
    const hours = shortHours(r.enteredMinutes, a.timeFormat);
    const title = a.approvalMode === 'week' ? `Approve week ${a.weekNumber} for ${r.employee.name}?` : `Approve ${r.waiting} waiting ${r.waiting === 1 ? 'day' : 'days'} of ${r.employee.name}?`;
    if (
      !(await askConfirm({
        title,
        message: `${r.waiting} ${r.waiting === 1 ? 'day' : 'days'} · ${hours} h entered`,
        confirmLabel: 'Approve',
      }))
    )
      return;
    setBusy(r.employee.id);
    try {
      await approvalsApi.approve(r.employee.id, a.weekStart);
      set(await approvalsApi.list(weekParam));
      flash(a.approvalMode === 'week' ? `Week ${a.weekNumber} approved for ${r.employee.name}` : `${r.waiting} ${r.waiting === 1 ? 'day' : 'days'} approved for ${r.employee.name}`);
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(null);
  };

  if (!data) {
    return <Screen title="Approvals">{error ? <EmptyState title="Approvals could not be loaded" text={error} /> : <div className="ts-help">Loading</div>}</Screen>;
  }
  const a = data;
  const notSubmitted = a.rows.filter((r) => r.missing.length > 0);
  const late = a.rows.filter((r) => r.late);
  const returned = a.rows.filter((r) => r.returned > 0);
  const deadline = `${dayLabel(a.deadline.date)}, ${a.deadline.time}`;
  const timeZone = s.workspace?.timezone;
  return (
    <Screen title="Approvals">
      <div className="ts-toolbar">
        <button type="button" className="btn-plain ts-arrow" aria-label="Previous week" data-testid="ap-prev" onClick={() => go(addDays(a.weekStart, -7))}>
          ←
        </button>
        <button type="button" className="btn-plain" data-testid="ap-this-week" onClick={() => go(null)} disabled={!weekParam}>
          Latest due
        </button>
        <button type="button" className="btn-plain ts-arrow" aria-label="Next week" data-testid="ap-next" onClick={() => go(addDays(a.weekStart, 7))} disabled={a.weekStart >= a.thisWeek}>
          →
        </button>
        <span className="ts-week-label" data-testid="ap-week-label">
          {a.label}
        </span>
        <span className="ts-due">{a.deadlinePassed ? `Deadline was ${deadline}` : `Due ${deadline}`}</span>
      </div>
      {a.rows.length === 0 ? (
        <EmptyState title="Nobody to approve for" text="Approvals lists the timesheets of your direct reports. Admins see every employee with a required timesheet." testId="ap-empty" />
      ) : (
        <>
          {notSubmitted.length + late.length + returned.length === 0 ? (
            <div className="card ap-panel" data-testid="ap-all-good">
              <span className="emp-note">Everyone submitted on time.</span>
            </div>
          ) : (
            <div className="ap-panels">
              <Panel
                title={a.deadlinePassed ? 'Not submitted' : 'Not yet submitted'}
                rows={notSubmitted}
                testId="ap-not-submitted"
                line={(r) => `${shortHours(r.enteredMinutes, a.timeFormat)} of ${shortHours(r.expectedMinutes, a.timeFormat)} h · missing ${r.missing.map(short).join(', ')}`}
              />
              <Panel title="Late" rows={late} testId="ap-late" line={(r) => (r.autoSubmitted ? 'auto-submitted' : 'submitted late')} />
              <Panel title="Rejected, waiting for the employee" rows={returned} testId="ap-returned" line={(r) => `${r.returned} ${r.returned === 1 ? 'day' : 'days'}`} />
            </div>
          )}
          <div className="ap-table" data-testid="ap-table">
            <div className="table-head ap-row" style={{ gridTemplateColumns: COLS }}>
              <span className="th">Employee</span>
              <span className="th">Status</span>
              <span className="th">Days</span>
              <span className="th">Entered</span>
              <span />
            </div>
            {a.rows.map((r) => (
              <div className="table-row ap-row" style={{ gridTemplateColumns: COLS }} key={r.employee.id} data-testid="ap-row" data-employee={r.employee.id} data-status={r.status}>
                <span className="ap-who">
                  <Link to={paths.approval(r.employee.id, a.weekStart)} className="ap-name">
                    {r.employee.name}
                  </Link>
                  {r.employee.jobTitle && <span className="emp-note">{r.employee.jobTitle}</span>}
                </span>
                <span className="ap-status">
                  <span className={`badge ${WEEK_BADGE[r.status]}`}>{r.statusLabel}</span>
                  {r.late && <span className="badge badge-danger">Late</span>}
                  {r.autoSubmitted && <span className="badge badge-neutral">Auto-submitted</span>}
                  {r.resubmitted > 0 && <span className="badge badge-neutral">Resubmitted</span>}
                  {r.onBehalf && <span className="badge badge-neutral">Entered on behalf</span>}
                </span>
                <DaySquares days={r.days} />
                <span>
                  {shortHours(r.enteredMinutes, a.timeFormat)} of {shortHours(r.expectedMinutes, a.timeFormat)} h
                </span>
                <span className="ap-actions">
                  {r.right && r.waiting > 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy === r.employee.id || !r.approvable}
                      title={r.approvable ? undefined : 'Approve the week once every required day is submitted'}
                      data-testid="ap-approve"
                      onClick={() => void approve(a, r)}
                    >
                      {a.approvalMode === 'week' ? 'Approve week' : `Approve all (${r.waiting})`}
                    </button>
                  ) : (
                    !r.right && <span className="emp-note">Read only</span>
                  )}
                  <Link to={paths.approval(r.employee.id, a.weekStart)} className="btn-plain">
                    Open
                  </Link>
                </span>
              </div>
            ))}
          </div>
          <div className="ts-help">
            Day squares: green approved, blue submitted, amber rejected, grey draft, hatched no entry needed.
            {timeZone ? ` Times in ${timeZone}.` : ''}
          </div>
        </>
      )}
    </Screen>
  );
}
