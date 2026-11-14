import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/store';
import { Row } from './parts';

/** The API refuses more (CD-378); checked here too so the message comes before the upload. */
const MAX_BYTES = 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg'];
/** The API's limit for a workspace name. */
const MAX_NAME = 100;

/** A file or blob as a data: URL (nothing to revoke, so it can't turn into a broken image). */
const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** The workspace logo (behind auth), read again when it changes; `failed` when it can't be shown. */
function useLogo() {
  const { s, loadLogo } = useStore();
  const version = s.workspace.logoUpdatedAt;
  const load = useRef(loadLogo);
  load.current = loadLogo;
  const [state, setState] = useState<{ version: string | null; url: string | null; failed: boolean }>({ version: null, url: null, failed: false });
  useEffect(() => {
    if (!version) return;
    let alive = true;
    load
      .current()
      .then((blob) => (blob ? asDataUrl(blob) : null))
      .then(
        (url) => alive && setState({ version, url, failed: !url }),
        () => alive && setState({ version, url: null, failed: true }),
      );
    return () => {
      alive = false;
    };
  }, [version]);
  if (!version) return { url: null, failed: false };
  // Until the new version is read, the previous image stays.
  return { url: state.url, failed: state.version === version && state.failed };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || 'W';

/**
 * Settings → General → Logo (CD-378; a row since CD-524, design G-Settings): printed at the top of
 * the meeting minutes PDF sent to customers. Upload (PNG or JPG, at most 1 MB, checked before it is
 * sent) and Remove save at once; a refusal shows under the label.
 */
export function LogoRow() {
  const { s, canEditWorkspace, setLogo, removeLogo } = useStore();
  const logo = useLogo();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const has = !!s.workspace.logoUpdatedAt;
  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setError('');
    const problem = await action();
    setBusy(false);
    if (problem) setError(problem);
  };
  const pick = (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('The logo must be a PNG or JPG image.');
    if (f.size > MAX_BYTES) return setError('The logo can be at most 1 MB. Choose a smaller image.');
    void run(() => setLogo(f));
  };
  return (
    <Row label="Logo" hint="At the top of the meeting minutes PDF sent to customers. PNG or JPG, up to 1 MB." error={error || (logo.failed ? "The logo can't be shown. Reload the page, or upload it again." : '')} testId="workspace-info">
      <span className="ws-avatar" data-testid="workspace-logo">
        {logo.url ? <img src={logo.url} alt="Workspace logo" data-testid="workspace-logo-img" /> : <span>{initials(s.workspace.name)}</span>}
      </span>
      {canEditWorkspace && (
        <>
          <input ref={input} type="file" accept="image/png,image/jpeg" hidden data-testid="workspace-logo-input" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="btn-plain" data-testid="workspace-logo-pick" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Saving' : has ? 'Change logo' : 'Upload logo'}
          </button>
          {has && (
            <button type="button" className="btn-plain" data-testid="workspace-logo-remove" disabled={busy} onClick={() => void run(removeLogo)}>
              Remove
            </button>
          )}
        </>
      )}
    </Row>
  );
}

/** Settings → General → Name (CD-378): saved when the field is left; it can't be empty. */
export function NameRow() {
  const { s, setWorkspace, canEditWorkspace } = useStore();
  const saved = s.workspace.name;
  const [draft, setDraft] = useState(saved);
  const [empty, setEmpty] = useState(false);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setDraft(saved);
  }
  const commit = () => {
    const next = draft.trim();
    if (!next) return setEmpty(true);
    if (next !== saved) setWorkspace({ name: next });
    setDraft(next);
  };
  return (
    <Row label="Name" hint="Shown in the module switcher, in emails and on the meeting minutes PDF." error={empty ? 'Enter the workspace name. The saved one stays until you do.' : ''}>
      <input
        className="form-input"
        aria-label="Workspace name"
        data-testid="workspace-info-name"
        value={draft}
        maxLength={MAX_NAME}
        disabled={!canEditWorkspace}
        aria-invalid={empty}
        onChange={(e) => {
          setDraft(e.target.value);
          if (empty && e.target.value.trim()) setEmpty(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </Row>
  );
}
