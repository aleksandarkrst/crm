import { useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { dayName } from '../../lib/timesheetApi';

/** "Why are you rejecting Thursday?" (design `#cd-157b`): the comment is required; the employee is emailed it. */
export function RejectDialog({ dates, whole, firstName, onClose, onReject }: { dates: string[]; whole: boolean; firstName: string; onClose: () => void; onReject: (comment: string) => Promise<string | null> }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const what = whole ? 'the week' : dates.length === 1 ? dayName(dates[0]!) : `${dates.length} days`;
  const label = whole ? 'Reject week' : dates.length === 1 ? `Reject ${dayName(dates[0]!)}` : `Reject ${dates.length} days`;

  const reject = async () => {
    if (!comment.trim()) {
      setError('Enter a comment');
      return;
    }
    setBusy(true);
    const failure = await onReject(comment.trim());
    if (failure) {
      setError(failure);
      setBusy(false);
    }
  };

  return (
    <Modal maxWidth={440} onBackdrop={onClose}>
      <ModalHeader title={`Why are you rejecting ${what}? (required)`} sub={`${firstName} can edit only the rejected ${whole || dates.length > 1 ? 'days' : 'day'} and resubmit. They get an email with your comment.`} />
      <textarea className="box-input" rows={3} maxLength={1000} autoFocus value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What needs to change" data-testid="ap-reject-comment" />
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn-plain" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void reject()} data-testid="ap-reject-confirm">
          {busy ? 'Rejecting…' : label}
        </button>
      </div>
    </Modal>
  );
}
