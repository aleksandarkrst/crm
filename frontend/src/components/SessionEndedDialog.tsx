import { useEffect, useState } from 'react';
import { authMode, signInAgain } from '../lib/auth';
import { sessionRestored, watchSession } from '../lib/session';
import { Modal, ModalHeader } from './ui';

/**
 * Shown over the app when the session ended and couldn't be renewed (CD-88). Requests wait while
 * it is open (lib/session.ts), so nothing typed is lost: signing in again sends them. Signing in
 * happens in a popup, so this page and its unsaved edits stay.
 */
export function SessionEndedDialog({ email, name, onSignOut }: { email: string; name: string; onSignOut: () => void }) {
  const [ended, setEnded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => watchSession(setEnded), []);

  if (!ended) return null;

  const again = async () => {
    setBusy(true);
    setError('');
    try {
      const now = await signInAgain({ email, name });
      if (email && now && now.toLowerCase() !== email.toLowerCase()) {
        setError(`You signed in as ${now}. Sign in as ${email} to save your changes, or sign out.`);
      } else {
        sessionRestored();
      }
    } catch {
      setError(authMode === 'oidc' ? 'The sign-in window was closed or blocked. Allow pop-ups for this site and try again.' : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal maxWidth={420} z={80}>
      <ModalHeader title="Your session ended" sub={`Sign in again to save your changes. Nothing you entered is lost while this is open.${email ? ` Signed in as ${email}.` : ''}`} />
      {error && <div style={{ fontSize: 12.5, color: '#B42318', lineHeight: 1.5 }}>{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onSignOut} title="Changes not saved yet are lost">
          Sign out
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} autoFocus onClick={() => void again()}>
          {busy ? 'Signing in…' : 'Sign in again'}
        </button>
      </div>
    </Modal>
  );
}
