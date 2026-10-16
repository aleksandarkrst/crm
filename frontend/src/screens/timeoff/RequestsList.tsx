import { useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
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
          {r.canWithdraw && (
            <button type="button" className="btn-plain" disabled={busy === r.id} onClick={() => void withdraw(r)} data-testid="request-withdraw">
              Withdraw
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
