import { useEffect, useRef, useState } from 'react';
import { FieldRow } from '../../components/ui';
import { useStore } from '../../store/store';

/** The API refuses more (CD-378); checked here too so the message comes before the upload. */
const MAX_BYTES = 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg'];

/**
 * Settings → Workspace → Logo (CD-378): printed at the top of the meeting minutes PDF, next to the
 * workspace name. Owners and admins upload, replace and remove it; members see it.
 */
export function WorkspaceLogo() {
  const { s, canEditWorkspace, loadLogo, setLogo, removeLogo } = useStore();
  const version = s.workspace.logoUpdatedAt;
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const load = useRef(loadLogo);
  load.current = loadLogo;

  // The image behind auth, as an object URL; read again when the logo changes.
  useEffect(() => {
    if (!version) return setUrl(null);
    let alive = true;
    let made: string | null = null;
    load.current().then(
      (blob) => {
        if (!alive || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      () => undefined,
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [version]);

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) return setError('The logo must be a PNG or JPG image.');
    if (file.size > MAX_BYTES) return setError('The logo can be at most 1 MB. Choose a smaller image.');
    setError('');
    setBusy(true);
    const problem = await setLogo(file);
    setBusy(false);
    if (problem) setError(problem);
  };
  const remove = async () => {
    setError('');
    setBusy(true);
    const problem = await removeLogo();
    setBusy(false);
    if (problem) setError(problem);
  };

  return (
    <>
      <FieldRow label="Logo">
        <span className="ws-logo" data-testid="workspace-logo">
          {version ? (
            url ? <img className="ws-logo-img" src={url} alt="Workspace logo" data-testid="workspace-logo-img" /> : <span className="ws-logo-empty">Loading</span>
          ) : (
            <span className="ws-logo-empty">No logo</span>
          )}
          {canEditWorkspace && (
            <>
              <input ref={input} type="file" accept="image/png,image/jpeg" hidden data-testid="workspace-logo-input" onChange={(e) => void pick(e.target.files?.[0])} />
              <button type="button" className="btn-plain" disabled={busy} data-testid="workspace-logo-upload" onClick={() => input.current?.click()}>
                {busy ? 'Saving' : version ? 'Replace' : 'Upload logo'}
              </button>
              {version && (
                <button type="button" className="btn-plain" disabled={busy} data-testid="workspace-logo-remove" onClick={() => void remove()}>
                  Remove
                </button>
              )}
            </>
          )}
        </span>
      </FieldRow>
      {error && (
        <span className="ws-logo-error" role="alert" data-testid="workspace-logo-error">
          {error}
        </span>
      )}
      <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, margin: '2px 0 0' }}>PNG or JPG, up to 1 MB. Printed at the top of the meeting minutes PDF sent to customers.</span>
    </>
  );
}
