import { useEffect, useState } from 'react';
import { DateRangePicker } from '../../components/DateRangePicker';
import { Modal, ModalHeader } from '../../components/ui';
import { type ApiRequestPreview, type ApiTimeOffReason, type ApiTimeOffRequest, TIME_OFF_TYPE_LABEL, type TimeOffType, timeOffApi } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { dateLabel } from '../employee/parts';

const days = (n: number) => `${n} ${n === 1 ? 'working day' : 'working days'}`;
const todayMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Request time off (CD-165, spec 8.4; one date range picker since CD-350): type, reason (paid
 * leave, other absence), dates and a note.
 * While the dates are picked the form shows the working days ("6 working days (excludes 1 May
 * Praznik rada)"), the vacation balance before and after, the paid leave warnings and who
 * approves; what can't be submitted says why. Admins pick the employee. Every request waits for its
 * approver except the CEO's own, which is approved automatically (CD-350).
 */
export function RequestDialog({ employeeId, employees, admin, onClose }: { employeeId: string; employees?: { id: string; fullName: string }[]; admin: boolean; onClose: (saved?: ApiTimeOffRequest) => void }) {
  const { flash } = useStore();
  const [employee, setEmployee] = useState(employeeId);
  const [type, setType] = useState<TimeOffType>('vacation');
  const [reasonId, setReasonId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<ApiRequestPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const needsReason = type === 'paid_leave' || type === 'other_absence';
  const { data: reasons } = useProjectsRead<ApiTimeOffReason[]>(needsReason, () => timeOffApi.reasons.list(type === 'paid_leave' ? 'paid_leave' : 'other_absence'), `timeoff:reasons:${type}`, 'timeOffRev');
  const activeReasons = (reasons ?? []).filter((r) => r.active);

  // The live preview, a moment after the last change.
  useEffect(() => {
    if (!startDate || !endDate || endDate < startDate || (needsReason && !reasonId)) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      timeOffApi.requests
        .preview({ employeeId: employee, type, reasonId: needsReason ? reasonId : null, startDate, endDate })
        .then((p) => live && (setPreview(p), setPreviewError(null)))
        .catch((err) => live && (setPreview(null), setPreviewError(projectError(err))));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [employee, type, reasonId, startDate, endDate, needsReason]);

  const types: TimeOffType[] = admin ? ['vacation', 'paid_leave', 'unpaid_leave', 'other_absence'] : ['vacation', 'paid_leave', 'unpaid_leave'];
  const blocked = !preview || !!preview.refusal || !!preview.shortfall;
  const forOther = employee !== employeeId;
  const submit = async () => {
    if (!startDate || !endDate) return setProblem('Pick the dates');
    if (needsReason && !reasonId) return setProblem('Pick a reason');
    setBusy(true);
    setProblem(null);
    try {
      const saved = await timeOffApi.requests.create({ employeeId: employee, type, reasonId: needsReason ? reasonId : null, startDate, endDate, note: note.trim() || null });
      flash(saved.status === 'approved' ? `Approved: ${days(saved.workingDays)} of ${TIME_OFF_TYPE_LABEL[saved.type].toLowerCase()}` : `Request sent: ${days(saved.workingDays)}`);
      onClose(saved);
    } catch (err) {
      setProblem(projectError(err));
      setBusy(false);
    }
  };

  return (
    <Modal maxWidth={520} onBackdrop={() => !busy && onClose()}>
      <ModalHeader title="Request time off" sub="Whole working days. Weekends and public holidays are not counted." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="request-dialog">
        {admin && employees && (
          <label className="policy-field">
            <span className="th">Employee</span>
            <select className="form-input" value={employee} onChange={(e) => setEmployee(e.target.value)} data-testid="request-employee">
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="policy-field-row">
          <label className="policy-field">
            <span className="th">Type</span>
            <select
              className="form-input"
              value={type}
              onChange={(e) => {
                setType(e.target.value as TimeOffType);
                setReasonId('');
              }}
              data-testid="request-type"
            >
              {types.map((t) => (
                <option key={t} value={t}>
                  {TIME_OFF_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          {needsReason && (
            <label className="policy-field">
              <span className="th">Reason</span>
              <select className="form-input" value={reasonId} onChange={(e) => setReasonId(e.target.value)} data-testid="request-reason">
                <option value="">Pick a reason</option>
                {activeReasons.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.maxDays !== null ? ` (up to ${r.maxDays} ${r.maxDays === 1 ? 'day' : 'days'})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="policy-field">
          <span className="th">Dates</span>
          {/* One picker for the first and last day (CD-350): click a day, then another; one click twice is a single day. */}
          <DateRangePicker
            label="Dates"
            value={startDate && endDate ? { from: startDate, to: endDate } : null}
            month={(startDate || todayMonth()).slice(0, 7)}
            placeholder="Pick the first and last day"
            onChange={(range) => {
              setStartDate(range.from);
              setEndDate(range.to);
            }}
            testId="request-dates"
          />
        </div>
        <PreviewLine preview={preview} error={previewError} type={type} forOther={forOther} />
        <label className="policy-field">
          <span className="th">Note to the approver</span>
          <textarea className="form-input" rows={2} maxLength={500} value={note} placeholder="Optional. Do not enter health information." onChange={(e) => setNote(e.target.value)} data-testid="request-note" />
        </label>
        {problem && (
          <span className="emp-error" role="alert" data-testid="request-problem">
            {problem}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onClose()}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || blocked} onClick={() => void submit()} data-testid="request-submit">
            {busy ? 'Sending…' : preview?.autoApproved ? 'Take time off' : 'Send request'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** "6 working days (excludes 1 May Praznik rada) · 20 → 14 days left · goes to Ana Petrović". */
function PreviewLine({ preview, error, type, forOther }: { preview: ApiRequestPreview | null; error: string | null; type: TimeOffType; forOther: boolean }) {
  if (error) return <span className="emp-error">{error}</span>;
  if (!preview) return <span className="emp-note">Pick the dates to see the working days.</span>;
  const excluded = preview.excluded.length ? ` (excludes ${preview.excluded.map((x) => `${dateLabel(x.date)} ${x.name.replace(/\s*\(.*\)$/, '')}`).join(', ')})` : '';
  const whose = forOther ? 'The request' : 'Your request';
  const approver = preview.autoApproved ? (forOther ? 'Approved automatically: they are the CEO' : "Approved automatically: you're the CEO") : preview.approver ? (preview.approver.kind === 'self' ? (forOther ? 'They approve it themselves (no other Admin)' : 'You approve it yourself (no other Admin)') : `${whose} goes to ${preview.approver.approvers.map((a) => a.fullName).join(', ') || 'the Admins'}`) : null;
  return (
    <div className="request-preview" data-testid="request-preview">
      <span style={{ fontSize: 13, fontWeight: 500 }}>
        {days(preview.workingDays)}
        {excluded}
      </span>
      {preview.balance && (
        <span className="emp-note" data-testid="request-balance">
          Vacation days available: {preview.balance.before.available} now, {preview.balance.after.available} after this request
          {preview.balance.pools.length > 1 ? ` (${preview.balance.pools.map((p) => `${p.days} from ${p.poolYear}`).join(', ')})` : ''}
        </span>
      )}
      {preview.refusal && (
        <span className="emp-error" data-testid="request-refusal">
          {preview.refusal.message}
        </span>
      )}
      {preview.shortfall && !preview.refusal && (
        <span className="emp-error" data-testid="request-shortfall">
          {forOther ? 'They have' : 'You have'} {preview.shortfall.available} {preview.shortfall.available === 1 ? 'day' : 'days'} available; this request needs {preview.shortfall.needed}.
        </span>
      )}
      {preview.warnings.map((w) => (
        <span key={w} className="emp-note emp-warn">
          {w}
        </span>
      ))}
      {type === 'vacation' && !preview.refusal && !preview.shortfall && !preview.autoApproved && <span className="emp-note">{forOther ? 'The decision is issued when the manager approves.' : 'The decision is issued when your manager approves.'}</span>}
      {approver && <span className="emp-note">{approver}</span>}
    </div>
  );
}
