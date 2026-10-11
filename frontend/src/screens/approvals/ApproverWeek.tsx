import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { askConfirm } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Screen } from '../../components/Layout';
import { paths } from '../../lib/paths';
import { addDays, type ApiTimesheetWeek, approvalsApi, dayLabel, dayName, shortHours } from '../../lib/timesheetApi';
import { projectError } from '../../store/projects';
import { useStore } from '../../store/store';
import { useApproverWeek } from '../../store/timesheet';
import { DAY_STATUS, WEEK_BADGE, when } from './parts';
import { RejectDialog } from './RejectDialog';

const DAY_BADGE = { draft: 'badge-neutral', submitted: 'badge-brand', rejected: 'badge-warn', approved: 'badge-brand' } as const;

/**
 * One person's week for their approver (CD-157, design `#cd-157b`): the status and flags, one block
 * per day with every entry's project, task or work order, hours and note, and Approve or Reject
 * (a required comment) per day in Day by day mode, or for the whole week.
 */
export function ApproverWeek() {
  const { id } = useParams<{ id: string }>();
  const { s, flash } = useStore();
  const [params, setParams] = useSearchParams();
  const weekParam = params.get('week') ?? undefined;
  const { data, error, set } = useApproverWeek(id, weekParam);
  const [rejecting, setRejecting] = useState<{ dates: string[]; whole: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const go = (monday: string) => setParams({ week: monday });
  const timeZone = s.workspace?.timezone;

  const approve = async (w: ApiTimesheetWeek, dates?: string[]) => {
    const waiting = dates ?? w.days.filter((d) => d.status === 'submitted').map((d) => d.date);
    const minutes = w.days.filter((d) => waiting.includes(d.date)).reduce((a, d) => a + d.minutes, 0);
    const title = !dates ? (w.settings.approvalMode === 'week' ? `Approve week ${w.weekNumber}?` : `Approve all ${waiting.length} waiting days?`) : `Approve ${dayName(dates[0]!)}?`;
    if (!(await askConfirm({ title, message: `${waiting.length} ${waiting.length === 1 ? 'day' : 'days'} · ${shortHours(minutes, w.settings.timeFormat)} h entered`, confirmLabel: 'Approve' }))) return;
    setBusy(true);
    try {
      set(await approvalsApi.approve(w.employee!.id, w.weekStart, w.settings.approvalMode === 'day' ? waiting : undefined));
      flash(dates ? `${dayName(dates[0]!)} approved` : `Week ${w.weekNumber} approved`);
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };

  const reject = async (w: ApiTimesheetWeek, dates: string[], whole: boolean, comment: string): Promise<string | null> => {
    try {
      set(await approvalsApi.return(w.employee!.id, w.weekStart, comment, whole ? undefined : dates));
      setRejecting(null);
      flash(whole ? `Week ${w.weekNumber} rejected` : `${dates.map(dayName).join(', ')} rejected`);
      return null;
    } catch (err) {
      return projectError(err);
    }
  };

  if (!data || !data.week.employee) {
    return (
      <Screen title="Approvals" parent={{ label: 'Approvals', to: paths.approvals() }}>
        {error ? <EmptyState title="This week could not be loaded" text={error} /> : <div className="ts-help">Loading</div>}
      </Screen>
    );
  }
  const { week: w, right } = data;
  const employee = w.employee!;
  const dayMode = w.settings.approvalMode === 'day';
  const waiting = w.days.filter((d) => d.status === 'submitted').map((d) => d.date);
  const blocked = w.days.some((d) => d.required && (d.status === 'draft' || d.status === 'rejected'));
  const canApproveWeek = right && waiting.length > 0 && (dayMode || !blocked);
  const entered = w.days.reduce((a, d) => a + d.minutes, 0);
  const firstName = employee.name.split(' ')[0]!;
  const shown = w.days.filter((d) => d.required || d.minutes > 0);
  return (
    <Screen title={`${employee.name} · week ${w.weekNumber}`} parent={{ label: 'Approvals', to: paths.approvals(w.weekStart) }}>
      <div className="ts-toolbar">
        <button type="button" className="btn-plain ts-arrow" aria-label="Previous week" onClick={() => go(addDays(w.weekStart, -7))}>
          ←
        </button>
        <button type="button" className="btn-plain ts-arrow" aria-label="Next week" onClick={() => go(addDays(w.weekStart, 7))} disabled={w.weekStart >= w.thisWeek}>
          →
        </button>
        <span className="ts-week-label">{w.label}</span>
        <span className={`badge ${WEEK_BADGE[w.status]}`} data-testid="ap-week-status">
          {w.statusLabel}
        </span>
        {w.late && <span className="badge badge-danger">Late</span>}
        {w.autoSubmitted && <span className="badge badge-neutral">Auto-submitted</span>}
        <span className="ts-due" data-testid="ap-week-summary">
          {shortHours(entered, w.settings.timeFormat)} h entered · {waiting.length} {waiting.length === 1 ? 'day' : 'days'} waiting {right ? 'for you' : 'for the approver'}
        </span>
        <span style={{ flex: 1 }} />
        {right && waiting.length > 0 && (
          <>
            <button type="button" className="btn-plain" disabled={busy} data-testid="ap-reject-week" onClick={() => setRejecting({ dates: waiting, whole: true })}>
              {dayMode ? 'Reject all waiting days' : 'Reject week'}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || !canApproveWeek} title={canApproveWeek ? undefined : 'Approve the week once every required day is submitted'} data-testid="ap-approve-week" onClick={() => void approve(w)}>
              {dayMode ? `Approve all waiting days (${waiting.length})` : 'Approve week'}
            </button>
          </>
        )}
      </div>
      {right === 'override' && <div className="ts-help">Their manager approves this timesheet; your decision is recorded as an Admin override.</div>}
      {!right && <div className="ts-help">You can see this week but not approve it.</div>}
      {shown.length === 0 && <EmptyState title="No entry needed" text="No working day in this week falls inside the employment, and no hours were entered." />}
      {shown.map((d) => {
        const rows = w.rows.filter((r) => r.cells[d.date]);
        return (
          <section className="card ap-day" key={d.date} data-testid="ap-day" data-date={d.date} data-status={d.status}>
            <header className="ap-day-head">
              <strong>{dayName(d.date)}</strong>
              <span className="emp-note">{dayLabel(d.date)}</span>
              <span className={`badge ${DAY_BADGE[d.status]}`}>{DAY_STATUS[d.status]}</span>
              <span className="ap-hours">
                {shortHours(d.minutes, w.settings.timeFormat)} of {shortHours(d.expectedMinutes, w.settings.timeFormat)} h
              </span>
              {d.holiday && <span className="emp-note">Public holiday · {d.holiday.name}</span>}
              <span style={{ flex: 1 }} />
              {dayMode && right && d.status === 'submitted' && (
                <>
                  <button type="button" className="btn-plain" disabled={busy} data-testid="ap-reject-day" onClick={() => setRejecting({ dates: [d.date], whole: false })}>
                    Reject
                  </button>
                  <button type="button" className="btn btn-primary" disabled={busy} data-testid="ap-approve-day" onClick={() => void approve(w, [d.date])}>
                    Approve
                  </button>
                </>
              )}
            </header>
            {d.status === 'rejected' && d.comment && (
              <p className="ap-comment" data-testid="ap-day-comment">
                Rejected{d.returnedBy ? ` by ${d.returnedBy}` : ''}
                {d.returnedAt ? ` · ${when(d.returnedAt, timeZone)}` : ''}: <q>{d.comment}</q>
              </p>
            )}
            {d.status === 'approved' && d.approvedAt && (
              <p className="ap-comment ap-approved">
                Approved{d.approvedBy ? ` by ${d.approvedBy}` : ''} on {when(d.approvedAt, timeZone)} · locked
              </p>
            )}
            {rows.length === 0 ? (
              <p className="emp-note" style={{ padding: '10px 14px', margin: 0 }}>
                No hours entered.
              </p>
            ) : (
              <table className="ap-entries">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Task or work order</th>
                    <th style={{ textAlign: 'right' }}>Hours</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const cell = r.cells[d.date]!;
                    return (
                      <tr key={r.key} data-testid="ap-entry">
                        <td>{r.path}</td>
                        <td>
                          {r.code} {r.name}
                        </td>
                        <td className="num">{shortHours(cell.minutes, w.settings.timeFormat)}</td>
                        <td className="emp-note">{cell.note ?? (cell.entries > 1 ? `${cell.entries} entries` : '')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
      {rejecting && <RejectDialog dates={rejecting.dates} whole={rejecting.whole && !dayMode} firstName={firstName} onClose={() => setRejecting(null)} onReject={(comment) => reject(w, rejecting.dates, rejecting.whole && !dayMode, comment)} />}
    </Screen>
  );
}
