import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useStore } from '../store/store';
import { Logo } from './Logo';
import '../styles/header.css';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member' } as const;

/**
 * The Pultly mark at the top of the sidebar opens the workspace switcher (CD-23): your workspaces with
 * the current one marked, and a new workspace. Switching reuses the session's `switchTenant`, which
 * loads the other workspace from scratch.
 */
export function WorkspaceSwitcher() {
  const { session } = useStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setCreating(false);
    setName('');
    setError('');
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const tenants = [...session.tenants].sort((a, b) => a.name.localeCompare(b.name));
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await session.createTenant(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="ws-logo"
        data-testid="workspace-switcher"
        title={`Workspace: ${session.tenant.name} · switch workspace`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Logo height={26} onDark wordmark={false} />
      </button>
      {open && (
        <div className="menu-pop ws-pop" role="menu" data-testid="workspace-menu">
          <div className="caps-muted menu-label">Workspaces</div>
          {tenants.map((t) => {
            const current = t.id === session.tenant.id;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className={current ? 'menu-item ws-item current' : 'menu-item ws-item'}
                onClick={() => {
                  close();
                  if (!current) session.switchTenant(t.id);
                }}
              >
                <span className="ws-initial">{t.name.trim().charAt(0).toUpperCase() || '?'}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <span className="menu-item-title ws-name">{t.name}</span>
                  <span className="menu-item-sub">{ROLE_LABEL[t.role] ?? t.role}</span>
                </span>
                {current && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Current workspace">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            );
          })}
          <div className="menu-divider" />
          {creating ? (
            <form onSubmit={(e) => void create(e)} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 6px 6px' }}>
              <input className="box-input" autoFocus placeholder="Workspace name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New workspace name" />
              {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
              <div style={{ display: 'flex', gap: 7, justifyContent: 'flex-end' }}>
                <button type="button" className="btn-plain" style={{ padding: '6px 11px', fontSize: 12.5 }} onClick={() => setCreating(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ padding: '6px 11px', fontSize: 12.5 }} disabled={busy || !name.trim()}>
                  {busy ? 'Creating…' : 'Create workspace'}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="menu-item" onClick={() => setCreating(true)}>
              <span className="menu-item-title" style={{ color: 'var(--brand)' }}>+ New workspace</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
