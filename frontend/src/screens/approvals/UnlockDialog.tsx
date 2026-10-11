import { useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { dayLabel } from '../../lib/timesheetApi';

/** "Unlock Monday 5 Oct?" (CD-159, design `#cd-159`): Admins only; the reason (10 to 1,000 characters) goes to the employee and the approver. */
export function UnlockDialog({ date, firstName, onClose, onUnlock }: { date: string; firstName: string; onClose: () => void; onUnlock: (reason: string) => Promise<string | null> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unlock = async () => {
    if (reason.trim().length < 10) {
      setError('Give a reason of at least 10 characters');
      return;
    }
    setBusy(true);
    const failure = await onUnlock(reason.trim());
    if (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Modal maxWidth={440} onBackdrop={onClose}>
      <ModalHeader
        title={`Unlock ${dayLabel(date)}?`}
        sub={`The day goes back to ${firstName} as Rejected, to correct and resubmit. ${firstName} and the approver get an email with your reason. Only Admins can unlock.`}
      />
      <textarea
        className="box-input"
        rows={3}
        maxLength={1000}
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required, at least 10 characters)"
        data-testid="ap-unlock-reason"
      />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-plain" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void unlock()} data-testid="ap-unlock-confirm">
          {busy ? 'Unlocking…' : 'Unlock day'}
        </button>
      </div>
    </Modal>
  );
}
