import { type FormEvent, useEffect, useState } from 'react';
import { authMode, signInAgain } from '../lib/auth';
import { sessionRestored, watchSession } from '../lib/session';
import { useSignupOptions } from './AuthScreens';
import { Modal, ModalHeader } from './ui';

/**
 * Shown over the app when the session ended and couldn't be renewed (CD-88). Requests wait while
 * it is open (lib/session.ts), so nothing typed is lost: signing in again sends them. Signing in
 * happens right here (the password) or in a popup (Google), so this page and its unsaved edits stay.
 */
export function SessionEndedDialog({ email, name, onSignOut }: { email: string; name: string; onSignOut: () => void }) {
  const [ended, setEnded] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const options = useSignupOptions();

  useEffect(() => watchSession(setEnded), []);

  if (!ended) return null;

  const oidc = authMode === 'oidc';
  const again = async (google: boolean) => {
    setBusy(true);
    setError('');
    try {
      const now = await signInAgain({ email, name, password, google });
      if (email && now && now.toLowerCase() !== email.toLowerCase()) {
        setError(`You signed in as ${now}. Sign in as ${email} to save your changes, or sign out.`);
      } else {
        setPassword('');
        sessionRestored();
      }
    } catch (err) {
      setError(oidc && err instanceof Error ? err.message : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void again(false);
  };

  return (
    <Modal maxWidth={420} z={80}>
      <ModalHeader title="Your session ended" sub={`Sign in again to save your changes. Nothing you entered is lost while this is open.${email ? ` Signed in as ${email}.` : ''}`} />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {oidc && (
          <>
            <input type="email" autoComplete="username" value={email} readOnly hidden />
            <label className="form-label">
              Password
              <input className="form-input" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {options.google && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void again(true)}>
                Continue with Google
              </button>
            )}
          </>
        )}
        {error && <div style={{ fontSize: 12.5, color: '#B42318', lineHeight: 1.5 }}>{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onSignOut} title="Changes not saved yet are lost">
            Sign out
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || (oidc && !password)} autoFocus={!oidc}>
            {busy ? 'Signing in…' : 'Sign in again'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
