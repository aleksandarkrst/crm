import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { useStore } from '../../store/store';
import { Row, TextField } from './parts';

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
 * General → Logo (CD-378; the design's logo tile since CD-524): printed at the top of the meeting
 * minutes PDF sent to customers. Hovering the tile shows a pen; a click picks the image (PNG or JPG,
 * at most 1 MB, checked before it is sent). Upload and Remove save at once and say so in a toast.
 */
export function LogoRow() {
  const { s, canEditWorkspace, setLogo, removeLogo, flash } = useStore();
  const logo = useLogo();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const has = !!s.workspace.logoUpdatedAt;
  const run = async (action: () => Promise<string | null>, done: string) => {
    setBusy(true);
    setError('');
    const problem = await action();
    setBusy(false);
    if (problem) setError(problem);
    else flash(done);
  };
  const pick = (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('The logo must be a PNG or JPG image.');
    if (f.size > MAX_BYTES) return setError('The logo can be at most 1 MB. Choose a smaller image.');
    void run(() => setLogo(f), 'Logo updated');
  };
  const face = logo.url ? <img src={logo.url} alt="Workspace logo" data-testid="workspace-logo-img" /> : <span>{initials(s.workspace.name)}</span>;
  return (
    <Row label="Logo" desc="Shown in the module switcher and on documents. Click it to upload a PNG or JPG, up to 1 MB." error={error || (logo.failed ? "The logo can't be shown. Reload the page, or upload it again." : '')} testId="workspace-info">
      {canEditWorkspace && has && (
        <button type="button" className="gs-btn" data-testid="workspace-logo-remove" disabled={busy} onClick={() => void run(removeLogo, 'Logo removed')}>
          Remove
        </button>
      )}
      {canEditWorkspace ? (
        <>
          <input ref={input} type="file" accept="image/png,image/jpeg" hidden data-testid="workspace-logo-input" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="gs-logo" data-testid="workspace-logo-pick" aria-label={has ? 'Change the logo' : 'Add a logo'} title={has ? 'Change the logo' : 'Add a logo'} disabled={busy} onClick={() => input.current?.click()}>
            {face}
            <span className="pen" aria-hidden="true">
              <Icon name="pencil" size={18} />
            </span>
          </button>
        </>
      ) : (
        <span className="gs-logo" data-testid="workspace-logo">
          {face}
        </span>
      )}
    </Row>
  );
}

/** General → Name (CD-378): required; saved when the field is left. */
export function NameRow() {
  const { s, setWorkspace, canEditWorkspace } = useStore();
  return (
    <Row label="Name" desc="Shown in the module switcher and in emails">
      <TextField label="Workspace name" testId="workspace-info-name" value={s.workspace.name} maxLength={MAX_NAME} disabled={!canEditWorkspace} validate={(v) => (v.trim() ? '' : 'Enter the workspace name.')} onSave={(v) => setWorkspace({ name: v.trim() })} />
    </Row>
  );
}
