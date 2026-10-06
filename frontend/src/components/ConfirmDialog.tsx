import { useEffect, useState } from 'react';
import { Modal, ModalHeader } from './ui';

/**
 * The app's own "Are you sure?" (CD-228), instead of the browser's `window.confirm`: a dialog in
 * the design system. `askConfirm()` resolves to true when the person confirms, false when they
 * cancel (Cancel, Escape or a click on the backdrop). `<ConfirmHost />` (in the Layout) shows it.
 */
export interface ConfirmRequest {
  title: string;
  message?: string;
  /** The confirm button's label; "Continue" by default. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** A red confirm button, for deletions. */
  danger?: boolean;
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

let show: ((p: Pending) => void) | null = null;

export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    // No host on screen (tests, a page outside the Layout): the browser's own as a fallback.
    if (!show) return resolve(window.confirm([request.title, request.message].filter(Boolean).join('\n\n')));
    show({ ...request, resolve });
  });
}

export function ConfirmHost() {
  const [queue, setQueue] = useState<Pending[]>([]);
  useEffect(() => {
    show = (p) => setQueue((q) => [...q, p]);
    return () => {
      show = null;
    };
  }, []);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      answer(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request
  }, [current]);
  if (!current) return null;
  function answer(ok: boolean) {
    current!.resolve(ok);
    setQueue((q) => q.slice(1));
  }
  return (
    <Modal maxWidth={440} z={70} onBackdrop={() => answer(false)}>
      <div role="alertdialog" aria-modal="true" aria-label={current.title} data-testid="confirm-dialog" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ModalHeader title={current.title} sub={current.message ?? ''} />
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" data-testid="confirm-cancel" onClick={() => answer(false)}>
            {current.cancelLabel ?? 'Cancel'}
          </button>
          <button type="button" className={'btn btn-primary' + (current.danger ? ' btn-danger' : '')} data-testid="confirm-ok" autoFocus onClick={() => answer(true)}>
            {current.confirmLabel ?? 'Continue'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
