import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Modal, ModalHeader } from '../../components/ui';
import { useStore } from '../../store/store';

/** The API refuses more (CD-378); checked here too so the message comes before the upload. */
const MAX_BYTES = 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg'];

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
  if (!version) return { url: null, failed: false, loading: false };
  // Until the new version is read, the previous image stays.
  return { url: state.url, failed: state.version === version && state.failed, loading: state.version !== version && !state.url };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || 'W';

/**
 * Settings → Workspace → Workspace info (CD-378): the logo and the name, both printed at the top
 * of the meeting minutes PDF sent to customers. Owners and admins change them in a dialog (Edit);
 * members see them.
 */
export function WorkspaceInfo() {
  const { s, canEditWorkspace } = useStore();
  const logo = useLogo();
  const [open, setOpen] = useState(false);
  return (
    <div className="card card-pad ws-info" data-testid="workspace-info">
      <div className="card-title">Workspace info</div>
      <div className="ws-info-row">
        <span className="ws-avatar" data-testid="workspace-logo">
          {logo.url ? <img src={logo.url} alt="Workspace logo" data-testid="workspace-logo-img" /> : <span>{initials(s.workspace.name)}</span>}
        </span>
        <span className="ws-info-text">
          <span className="ws-info-label">Workspace name</span>
          <span className="ws-info-name">{s.workspace.name}</span>
          {logo.failed && <span className="ws-info-error">The logo can't be shown. Reload the page, or upload it again.</span>}
        </span>
        {canEditWorkspace && (
          <button type="button" className="btn btn-secondary" data-testid="workspace-info-edit" onClick={() => setOpen(true)}>
            Edit
          </button>
        )}
      </div>
      {open && <WorkspaceInfoModal current={logo.url} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** The dialog: pick a logo (click the circle), remove it, rename the workspace; Save applies it all. */
function WorkspaceInfoModal({ current, onClose }: { current: string | null; onClose: () => void }) {
  const { s, setWorkspace, setLogo, removeLogo } = useStore();
  const [name, setName] = useState(s.workspace.name);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(current);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (f: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!f) return;
    if (!TYPES.includes(f.type)) return setError('The logo must be a PNG or JPG image.');
    if (f.size > MAX_BYTES) return setError('The logo can be at most 1 MB. Choose a smaller image.');
    setError('');
    setFile(f);
    setRemoved(false);
    setPreview(await asDataUrl(f));
  };
  const save = async () => {
    setBusy(true);
    setError('');
    const problem = file ? await setLogo(file) : removed && current ? await removeLogo() : null;
    if (problem) {
      setBusy(false);
      return setError(problem);
    }
    if (name.trim() !== s.workspace.name) setWorkspace({ name: name.trim() });
    onClose();
  };

  return (
    <Modal maxWidth={480} onBackdrop={busy ? undefined : onClose}>
      <ModalHeader title="Workspace info" sub="The logo and name appear at the top of the meeting minutes PDF sent to customers." />
      <div className="ws-modal-logo">
        <input ref={input} type="file" accept="image/png,image/jpeg" hidden data-testid="workspace-logo-input" onChange={(e) => void pick(e.target.files?.[0])} />
        <button type="button" className="ws-avatar ws-avatar-lg" data-testid="workspace-logo-pick" aria-label={preview ? 'Change the logo' : 'Add a logo'} title={preview ? 'Change the logo' : 'Add a logo'} disabled={busy} onClick={() => input.current?.click()}>
          {preview ? <img src={preview} alt="Workspace logo" /> : <span>{initials(name)}</span>}
          <span className="ws-avatar-edit" aria-hidden="true">
            <Icon name="pencil" size={26} />
          </span>
        </button>
        <span className="ws-modal-formats">Formats: PNG, JPG, up to 1 MB.</span>
        {preview && (
          <button
            type="button"
            className="btn-plain"
            data-testid="workspace-logo-remove"
            disabled={busy}
            onClick={() => {
              setFile(null);
              setPreview(null);
              setRemoved(true);
            }}
          >
            Remove logo
          </button>
        )}
      </div>
      <label className="form-label">
        Workspace name
        <input className="form-input" data-testid="workspace-info-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      {error && (
        <span className="ws-info-error" role="alert" data-testid="workspace-logo-error">
          {error}
        </span>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={name.trim() && !busy ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!name.trim() || busy} data-testid="workspace-info-save" onClick={() => void save()}>
          {busy ? 'Saving' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}
