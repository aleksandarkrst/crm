import { useEffect, useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import { type ApiCopyPreview, type ApiCopyResult, timesheetApi } from '../../lib/timesheetApi';
import { projectError } from '../../store/projects';

type Mode = 'rows' | 'hours';
const CHOICES: { id: Mode; title: string; text: string }[] = [
  { id: 'rows', title: 'Rows only', text: "Adds last week's tasks and work orders, empty." },
  { id: 'hours', title: 'Rows and hours', text: 'Copies hours day by day into empty cells. Never overwrites, skips days off and days over 12 h.' },
];

/** "2 rows will be skipped: WO-1029 is completed, task T-9 is in a closed project." */
export const skippedText = (skipped: ApiCopyPreview['skipped']) =>
  `${skipped.length} ${skipped.length === 1 ? 'row' : 'rows'} will be skipped: ${skipped.map((s) => `${s.label} ${s.reason}`).join(', ')}.`;

/** Copy last week (design `#cd-152b`): rows only (default) or rows and hours; says what it skips before copying. */
export function CopyDialog({ weekStart, onClose, onCopied }: { weekStart: string; onClose: () => void; onCopied: (result: ApiCopyResult) => void }) {
  const [mode, setMode] = useState<Mode>('rows');
  const [preview, setPreview] = useState<ApiCopyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    timesheetApi.copyPreview(weekStart).then(
      (p) => alive && setPreview(p),
      (err) => alive && setError(projectError(err)),
    );
    return () => {
      alive = false;
    };
  }, [weekStart]);

  const copy = async () => {
    setBusy(true);
    try {
      onCopied(await timesheetApi.copy(weekStart, mode));
    } catch (err) {
      setError(projectError(err));
      setBusy(false);
    }
  };
  const nothing = preview !== null && preview.rows === 0;
  return (
    <Modal maxWidth={560} onBackdrop={onClose}>
      <ModalHeader title={preview ? `Copy week ${preview.fromWeek} into week ${preview.toWeek}` : 'Copy last week'} sub="Only tasks and work orders you can still log on are copied." />
      {CHOICES.map((c) => (
        <label key={c.id} className={`ts-choice${mode === c.id ? ' on' : ''}`} data-testid={`ts-copy-${c.id}`}>
          <input type="radio" name="ts-copy" checked={mode === c.id} onChange={() => setMode(c.id)} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
          <span className="ts-radio" aria-hidden />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.title}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{c.text}</span>
          </span>
        </label>
      ))}
      {error && (
        <div className="hint-box" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {preview && preview.skipped.length > 0 && (
        <div className="hint-box" data-testid="ts-copy-skipped">
          {skippedText(preview.skipped)}
        </div>
      )}
      {nothing && <div className="hint-box">Last week has nothing you can still log on.</div>}
      <div className="modal-actions">
        <button type="button" className="btn-plain" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !preview || nothing} onClick={() => void copy()} data-testid="ts-copy-go">
          {busy ? 'Copying…' : 'Copy'}
        </button>
      </div>
    </Modal>
  );
}
