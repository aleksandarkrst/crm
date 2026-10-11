import { useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { dayName } from '../../lib/timesheetApi';

/** Resubmit rejected days (CD-158, design `#cd-158`): only they go back to the approver, with an optional reply to the comment. */
export function ResubmitDialog({ dates, onClose, onResubmit }: { dates: string[]; onClose: () => void; onResubmit: (reply: string | null) => Promise<string | null> }) {
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const what = dates.length === 1 ? dayName(dates[0]!) : `${dates.length} rejected days`;

  const resubmit = async () => {
    setBusy(true);
    const failure = await onResubmit(reply.trim() || null);
    if (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Modal maxWidth={440} onBackdrop={onClose}>
      <ModalHeader title={`Resubmit ${what}?`} sub="Only the rejected days go back to your approver; the other days keep their status. A reply to the comment is optional." />
      <textarea className="box-input" rows={3} maxLength={1000} autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the comment (optional)" data-testid="ts-resubmit-reply" />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-plain" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void resubmit()} data-testid="ts-resubmit-confirm">
          {busy ? 'Resubmitting…' : dates.length === 1 ? `Resubmit ${dayName(dates[0]!)}` : `Resubmit ${dates.length} days`}
        </button>
      </div>
    </Modal>
  );
}
