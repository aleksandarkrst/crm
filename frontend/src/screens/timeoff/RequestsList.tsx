import { useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { Modal, ModalHeader } from '../../components/ui';
import { type ApiTimeOffRequest, REQUEST_STATUS_LABEL, TIME_OFF_TYPE_LABEL, timeOffApi } from '../../lib/timeOffApi';
import { projectError } from '../../store/projects';
import { useStore } from '../../store/store';
import { dateLabel } from '../employee/parts';

const BADGE: Record<ApiTimeOffRequest['status'], string> = { pending: 'badge badge-warn', approved: 'badge badge-brand', rejected: 'badge badge-danger', withdrawn: 'badge badge-neutral', cancelled: 'badge badge-neutral' };

/** "7 to 11 Jun 2027" or "7 Jun 2027". */
export const periodLabel = (r: Pick<ApiTimeOffRequest, 'startDate' | 'endDate'>) => (r.startDate === r.endDate ? dateLabel(r.startDate) : `${dateLabel(r.startDate)} to ${dateLabel(r.endDate)}`);

/**
 * The request list (CD-165, spec 8.5): type and reason, dates, working days, status, who decides
 * or decided, the comment, and Withdraw while pending. `withEmployee` adds the person (the
 * Requests tab of managers and Admins).
 */
export function RequestsList({ requests, withEmployee, onChanged }: { requests: ApiTimeOffRequest[]; withEmployee?: boolean; onChanged: () => void }) {
  const { flash } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'cancel' | 'shorten'; request: ApiTimeOffRequest } | null>(null);
  const withdraw = async (r: ApiTimeOffRequest) => {
    if (!(await askConfirm({ title: 'Withdraw this request?', message: `${TIME_OFF_TYPE_LABEL[r.type]}, ${periodLabel(r)}. The days go back to your balance; send a new request for other dates.`, confirmLabel: 'Withdraw', danger: true }))) return;
    setBusy(r.id);
    try {
      await timeOffApi.requests.withdraw(r.id);
      flash('Request withdrawn');
      onChanged();
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(null);
  };
  if (!requests.length) return <span className="emp-note">No requests yet.</span>;
  return (
    <div className="req-list" data-testid="requests">
      {requests.map((r) => (
        <div key={r.id} className="req-row" data-testid="request-row" data-status={r.status}>
          <div className="req-main">
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {withEmployee ? `${r.employee.fullName} · ` : ''}
              {TIME_OFF_TYPE_LABEL[r.type]}
              {r.reason ? ` · ${r.reason.name}` : ''}
            </span>
            <span style={{ fontSize: 13 }}>
              {periodLabel(r)} · {r.workingDays} {r.workingDays === 1 ? 'working day' : 'working days'}
            </span>
            {r.note && <span className="emp-note">Note: {r.note}</span>}
            {r.status === 'pending' && r.approver && (
              <span className="emp-note">{r.approver.kind === 'self' ? 'Self-approved (no other Admin)' : `Goes to ${r.approver.approvers.map((a) => a.fullName).join(', ') || 'the Admins'}`}</span>
            )}
            {r.recorded && <span className="emp-note">Recorded by {r.decidedBy?.name ?? 'an Admin'}: {r.recordReason}</span>}
            {!r.recorded && r.decidedBy && (
              <span className="emp-note">
                {REQUEST_STATUS_LABEL[r.status]} by {r.decidedBy.name}
                {r.decisionComment ? `: ${r.decisionComment}` : ''}
              </span>
            )}
            {r.warnings.map((w) => (
              <span key={w} className="emp-note emp-warn">
                {w}
              </span>
            ))}
          </div>
          <span className={BADGE[r.status]}>{REQUEST_STATUS_LABEL[r.status]}</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {r.canWithdraw && (
              <button type="button" className="btn-plain" disabled={busy === r.id} onClick={() => void withdraw(r)} data-testid="request-withdraw">
                Withdraw
              </button>
            )}
            {r.canCancel && (
              <button type="button" className="btn-plain" disabled={busy === r.id} onClick={() => setDialog({ kind: 'cancel', request: r })} data-testid="request-cancel">
                Cancel leave
              </button>
            )}
            {r.canShorten && (
              <button type="button" className="btn-plain" disabled={busy === r.id} onClick={() => setDialog({ kind: 'shorten', request: r })} data-testid="request-shorten">
                Shorten
              </button>
            )}
          </span>
        </div>
      ))}
      {dialog && (
        <ChangeDialog
          kind={dialog.kind}
          request={dialog.request}
          onClose={(changed) => {
            setDialog(null);
            if (changed) onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Working days (Monday to Friday) from `from` up to but not including `to`, for the five-day warning (A8). */
const weekdaysUntil = (from: string, to: string) => {
  let n = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += 86_400_000) if (![0, 6].includes(new Date(t).getUTCDay())) n++;
  return n;
};

/**
 * Cancel approved leave before it starts, or shorten leave that started (spec 9.4): a comment is
 * needed when it isn't the employee's own; cancelling fewer than five working days before the
 * start shows the Labor Law note (A8) but can still be saved.
 */
function ChangeDialog({ kind, request, onClose }: { kind: 'cancel' | 'shorten'; request: ApiTimeOffRequest; onClose: (changed?: boolean) => void }) {
  const { s, flash } = useStore();
  const own = s.myEmployeeId === request.employee.id;
  const [comment, setComment] = useState('');
  const [endDate, setEndDate] = useState(request.endDate);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const lateNotice = kind === 'cancel' && !own && weekdaysUntil(todayIso, request.startDate) < 5;
  const save = async () => {
    if ((kind === 'shorten' || !own) && !comment.trim()) return setProblem('A comment is needed');
    if (kind === 'shorten' && (endDate >= request.endDate || endDate < request.startDate)) return setProblem('Pick a new last day before the current one');
    setBusy(true);
    setProblem(null);
    try {
      if (kind === 'cancel') await timeOffApi.requests.cancel(request.id, comment.trim() || null);
      else await timeOffApi.requests.shorten(request.id, endDate, comment.trim());
      flash(kind === 'cancel' ? 'Leave cancelled; the days are back in the balance' : 'Leave shortened; the days after the new end are back in the balance');
      onClose(true);
    } catch (err) {
      setProblem(projectError(err));
      setBusy(false);
    }
  };
  return (
    <Modal maxWidth={440} onBackdrop={() => !busy && onClose()}>
      <ModalHeader title={kind === 'cancel' ? 'Cancel this leave?' : 'Shorten this leave'} sub={`${request.employee.fullName} · ${TIME_OFF_TYPE_LABEL[request.type]}, ${periodLabel(request)}`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid={`${kind}-dialog`}>
        {kind === 'shorten' && (
          <label className="policy-field">
            <span className="th">New last day</span>
            <input className="form-input" type="date" value={endDate} min={request.startDate} max={request.endDate} onChange={(e) => setEndDate(e.target.value)} data-testid="shorten-end" />
          </label>
        )}
        {lateNotice && <span className="emp-note emp-warn">The Labor Law allows the employer to change the time of leave at the latest 5 working days before it starts.</span>}
        <label className="policy-field">
          <span className="th">{own && kind === 'cancel' ? 'Comment (optional)' : 'Comment'}</span>
          <input className="form-input" value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} data-testid="change-comment" />
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
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()} data-testid="change-save">
            {kind === 'cancel' ? 'Cancel leave' : 'Shorten'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
