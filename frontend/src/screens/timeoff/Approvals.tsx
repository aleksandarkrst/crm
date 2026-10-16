import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { Modal, ModalHeader } from '../../components/ui';
import { paths } from '../../lib/paths';
import { type ApiApprovalRow, type ApiCalendar, type ApiTimeOffRequest, TIME_OFF_TYPE_LABEL, timeOffApi, type TimeOffType } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { dateLabel } from '../employee/parts';
import { periodLabel } from './RequestsList';

/** The pending approvals of the caller (managers and Admins), for the sidebar badge. */
export function usePendingApprovals(enabled: boolean): number {
  const { data } = useProjectsRead<{ pending: number }>(enabled, () => timeOffApi.approvals.count(), 'timeoff:approvals:count', 'timeOffRev');
  return data?.pending ?? 0;
}

const days = (n: number) => `${n} ${n === 1 ? 'working day' : 'working days'}`;

/**
 * The Approvals tab (CD-166, spec 9.2): one row per pending request the caller decides, with the
 * type and reason, dates, working days, when it was submitted, the note, the vacation balance after
 * approval, who else is away ("Also away: Marko (vacation 12 to 16 Oct)") and the warnings; Approve
 * (one click), Reject (a comment), and "Approve selected". On phones the rows become cards.
 */
export function ApprovalsTab() {
  const { flash } = useStore();
  const { data, error, reload } = useProjectsRead<ApiApprovalRow[]>(true, () => timeOffApi.approvals.list(), 'timeoff:approvals', 'timeOffRev');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApiTimeOffRequest | null>(null);
  if (error) return <EmptyState title="Approvals could not be loaded" text={error} />;
  if (!data) return <div className="ts-help">Loading</div>;
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ids = [...selected].filter((id) => data.some((r) => r.id === id));
  const approve = async (r: ApiApprovalRow) => {
    setBusy(r.id);
    try {
      await timeOffApi.requests.approve(r.id);
      flash(`Approved: ${r.employee.fullName}, ${periodLabel(r)}`);
      await reload();
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(null);
  };
  const approveSelected = async () => {
    setBusy('bulk');
    try {
      const res = await timeOffApi.approvals.approveMany(ids);
      flash(res.failed.length ? `${res.approved.length} approved; ${res.failed.length} could not be: ${res.failed.map((f) => f.message).join('; ')}` : `${res.approved.length} ${res.approved.length === 1 ? 'request' : 'requests'} approved`);
      setSelected(new Set());
      await reload();
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(null);
  };
  return (
    <div className="bal-page" data-testid="approvals-tab">
      {data.length > 1 && (
        <div className="bal-filters">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={ids.length === data.length} onChange={() => setSelected(ids.length === data.length ? new Set() : new Set(data.map((r) => r.id)))} aria-label="Select all" />
            Select all
          </label>
          <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={!ids.length || busy !== null} onClick={() => void approveSelected()} data-testid="approve-selected">
            Approve selected{ids.length ? ` (${ids.length})` : ''}
          </button>
        </div>
      )}
      <section className="card card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
        {data.length === 0 && <span className="emp-note">Nothing waiting for your decision.</span>}
        {data.map((r) => (
          <div key={r.id} className="apr-row" data-testid="approval-row" data-request={r.id}>
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.employee.fullName}`} style={{ marginTop: 3 }} />
            <div className="req-main">
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                <Link to={paths.employee(r.employee.id)}>{r.employee.fullName}</Link> · {TIME_OFF_TYPE_LABEL[r.type]}
                {r.reason ? ` · ${r.reason.name}` : ''}
              </span>
              <span style={{ fontSize: 13 }}>
                {periodLabel(r)} · {days(r.workingDays)} · submitted {dateLabel(r.submittedAt.slice(0, 10))}
                {r.submittedBy && r.submittedBy.userId !== r.employee.id ? '' : ''}
              </span>
              {r.note && <span className="emp-note">Note: {r.note}</span>}
              {r.balanceAfter !== null && <span className="emp-note">Vacation days left after approval: {r.balanceAfter}</span>}
              {r.alsoAway.length > 0 && <span className="emp-note">Also away: {r.alsoAway.map((a) => `${a.fullName} (${a.what} ${periodLabel(a)}${a.status === 'pending' ? ', pending' : ''})`).join(', ')}</span>}
              {r.startDatePassed && <span className="emp-note emp-warn">Start date passed</span>}
              {r.twoWeekPartMissing && <span className="emp-note emp-warn">The two-week part of this year's leave was not taken yet</span>}
              {r.warnings.map((w) => (
                <span key={w} className="emp-note emp-warn">
                  {w}
                </span>
              ))}
            </div>
            <span className="apr-actions">
              <button type="button" className="btn-plain" disabled={busy !== null} onClick={() => setRejecting(r)} data-testid="approval-reject">
                Reject
              </button>
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void approve(r)} data-testid="approval-approve">
                Approve
              </button>
            </span>
          </div>
        ))}
      </section>
      {rejecting && (
        <RejectDialog
          request={rejecting}
          onClose={(done) => {
            setRejecting(null);
            if (done) void reload();
          }}
        />
      )}
    </div>
  );
}

/** Reject: the comment the employee reads (spec 9.2). */
function RejectDialog({ request, onClose }: { request: ApiTimeOffRequest; onClose: (done?: boolean) => void }) {
  const { flash } = useStore();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    if (!comment.trim()) return setProblem('A comment is needed: the employee reads it');
    setBusy(true);
    try {
      await timeOffApi.requests.reject(request.id, comment.trim());
      flash(`Rejected: ${request.employee.fullName}, ${periodLabel(request)}`);
      onClose(true);
    } catch (err) {
      setProblem(projectError(err));
      setBusy(false);
    }
  };
  return (
    <Modal maxWidth={440} onBackdrop={() => !busy && onClose()}>
      <ModalHeader title="Reject this request?" sub={`${request.employee.fullName} · ${TIME_OFF_TYPE_LABEL[request.type]}, ${periodLabel(request)}`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="reject-dialog">
        <label className="policy-field">
          <span className="th">Comment</span>
          <input className="form-input" value={comment} maxLength={500} placeholder="Why, in a sentence the employee will read" onChange={(e) => setComment(e.target.value)} data-testid="reject-comment" />
        </label>
        {problem && (
          <span className="emp-error" role="alert">
            {problem}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onClose()}>
            Back
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()} data-testid="reject-save">
            Reject
          </button>
        </div>
      </div>
    </Modal>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const shiftMonth = (month: string, by: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const LEGEND: { type: TimeOffType; label: string }[] = [
  { type: 'vacation', label: 'Vacation' },
  { type: 'paid_leave', label: 'Paid leave' },
  { type: 'unpaid_leave', label: 'Unpaid leave' },
  { type: 'other_absence', label: 'Other absence' },
];

/**
 * The team calendar (CD-166, spec 9.5): a month, employees as rows and days as columns, weekends
 * and holidays shaded, a cell per absence (pending hatched lighter). Managers see their reports,
 * Admins everyone with unit and manager filters, employees themselves.
 */
export function CalendarTab({ month, onMonth }: { month: string; onMonth: (m: string) => void }) {
  const { s, session, employeeCard } = useStore();
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const [unitId, setUnitId] = useState('');
  const [managerId, setManagerId] = useState('');
  const { data, error } = useProjectsRead<ApiCalendar>(true, () => timeOffApi.calendar(month, { unitId: unitId || undefined, managerId: managerId || undefined }), `timeoff:calendar:${month}:${unitId}:${managerId}`, 'timeOffRev');
  const orgRev = s.orgRev;
  useEffect(() => {
    if (admin) void employeeCard.ensurePickers();
  }, [admin, employeeCard, orgRev]);
  if (error) return <EmptyState title="The calendar could not be loaded" text={error} />;
  const title = `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
  const daysInMonth = data ? Number(data.to.slice(8, 10)) : 0;
  const dates = Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const holidays = new Map((data?.holidays ?? []).map((h) => [h.date, h.name]));
  const byCell = new Map((data?.cells ?? []).map((c) => [`${c.employeeId}:${c.date}`, c]));
  const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const units = s.peoplePickers?.units ?? [];
  const managers = (s.peoplePickers?.employees ?? []).filter((e) => e.status !== 'inactive');
  return (
    <div className="bal-page" data-testid="calendar-tab">
      <div className="bal-filters">
        <button type="button" className="btn-plain" style={{ padding: '7px 10px' }} aria-label="Previous month" onClick={() => onMonth(shiftMonth(month, -1))}>
          ←
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, minWidth: 140, textAlign: 'center' }} data-testid="calendar-month">
          {title}
        </span>
        <button type="button" className="btn-plain" style={{ padding: '7px 10px' }} aria-label="Next month" onClick={() => onMonth(shiftMonth(month, 1))}>
          →
        </button>
        {admin && (
          <>
            <select className="form-input" value={unitId} onChange={(e) => setUnitId(e.target.value)} aria-label="Unit">
              <option value="">All units</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <select className="form-input" value={managerId} onChange={(e) => setManagerId(e.target.value)} aria-label="Manager">
              <option value="">All managers</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {!data ? (
        <div className="ts-help">Loading</div>
      ) : data.employees.length === 0 ? (
        <span className="emp-note">Nobody to show.</span>
      ) : (
        <div className="cal-wrap">
          <table className="cal-table">
            <thead>
              <tr>
                <th className="cal-name">Employee</th>
                {dates.map((date) => (
                  <th key={date} className={weekday(date) >= 5 || holidays.has(date) ? 'cal-off' : undefined} title={holidays.get(date)}>
                    <span style={{ display: 'block', fontSize: 10 }}>{DAY_SHORT[weekday(date)]}</span>
                    {Number(date.slice(8, 10))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => (
                <tr key={e.id} data-testid="calendar-row">
                  <td className="cal-name">
                    <Link to={paths.employee(e.id)} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                      {e.fullName}
                    </Link>
                    {e.unitName && <span className="emp-note"> · {e.unitName}</span>}
                  </td>
                  {dates.map((date) => {
                    const cell = byCell.get(`${e.id}:${date}`);
                    const off = weekday(date) >= 5;
                    const holiday = holidays.get(date);
                    return (
                      <td key={date} className={holiday ? 'cal-holiday' : off ? 'cal-off' : undefined} title={cell ? `${TIME_OFF_TYPE_LABEL[cell.type]}${cell.status === 'pending' ? ' (pending)' : ''}` : holiday}>
                        {cell && <span className="cal-day" data-type={cell.type} data-status={cell.status} aria-label={`${e.fullName}: ${TIME_OFF_TYPE_LABEL[cell.type]}${cell.status === 'pending' ? ', pending' : ''}`} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="cal-legend">
        {LEGEND.map((l) => (
          <span key={l.type}>
            <span className="cal-day" data-type={l.type} />
            {l.label}
          </span>
        ))}
        <span>
          <span className="cal-day" data-type="vacation" data-status="pending" />
          Pending
        </span>
        <span>
          <span className="cal-day cal-holiday" style={{ border: '1px solid var(--border)', boxSizing: 'border-box' }} />
          Weekend or holiday
        </span>
      </div>
    </div>
  );
}
