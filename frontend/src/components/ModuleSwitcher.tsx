import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { type ApiTenant } from '../lib/api';
import { useStore } from '../store/store';
import { Icon } from './icons';
import { currentModule, LOCK_LABEL, lockReason, MODULES } from './modules';
import '../styles/header.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** The shortcut that opens the switcher, as the keyboard shows it. */
export const SWITCHER_KEYS = IS_MAC ? '⌘ J' : 'Ctrl J';

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || '?';
const members = (t: ApiTenant) => (t.memberCount === undefined ? null : `${t.memberCount} ${t.memberCount === 1 ? 'member' : 'members'}`);

/**
 * The module and workspace switcher (CD-214), opened from the Pultly mark at the top of the
 * sidebar, with ⌘J / Ctrl J, or from "More" on phones (a bottom sheet there). Modules first: the
 * current one (from the route) is marked, locked ones can't be picked. With 2+ workspaces a row
 * above them shows the workspace and opens the list; with one, its name next to "Modules" does.
 * Switching reuses the session's `switchTenant`, which loads the other workspace from scratch.
 * Arrow keys move between items; Escape, an outside click or a pick closes it.
 */
export function ModuleSwitcher({ onClose, trigger }: { onClose: () => void; trigger: RefObject<HTMLElement | null> }) {
  const { session } = useStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [view, setView] = useState<'modules' | 'workspaces'>('modules');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = currentModule(pathname);
  const tenants = [...session.tenants].sort((a, b) => a.name.localeCompare(b.name));
  const several = tenants.length > 1;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || trigger.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, trigger]);

  // Focus the current item of the view: the current module, or the current workspace.
  useEffect(() => {
    if (creating) return;
    const pop = ref.current;
    const first = pop?.querySelector<HTMLElement>('[data-nav][aria-current="true"]') ?? pop?.querySelector<HTMLElement>('[data-nav]');
    first?.focus();
  }, [view, creating]);

  /** Arrow keys: two columns in the module grid (up and down skip a row), one list elsewhere. */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.tagName === 'INPUT') return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-nav]') ?? []);
    if (items.length === 0) return;
    e.preventDefault();
    const at = active ? items.indexOf(active) : -1;
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else {
      const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
      const tiles = items.filter((el) => el.dataset.nav === 'module');
      const tile = active ? tiles.indexOf(active) : -1;
      const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (tile >= 0 && vertical && tiles[tile + (back ? -2 : 2)]) next = items.indexOf(tiles[tile + (back ? -2 : 2)]!);
      else next = at < 0 ? 0 : (at + (back ? -1 : 1) + items.length) % items.length;
    }
    items[next]?.focus();
  };

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
    <>
      <div className="mod-backdrop" aria-hidden />
      <div ref={ref} className="mod-pop" role="dialog" aria-label="Modules and workspaces" data-testid="module-switcher-pop" data-view={view} onKeyDown={onKeyDown}>
        {view === 'modules' ? (
          <>
            {several && (
              <button type="button" className="mod-ws-row" data-nav="row" data-testid="workspace-row" onClick={() => setView('workspaces')}>
                <span className="ws-initial mod-ws-initial">{initial(session.tenant.name)}</span>
                <span className="mod-text">
                  <span className="mod-caption">Workspace</span>
                  <span className="mod-ws-name">{session.tenant.name}</span>
                </span>
                <span className="mod-switch">Switch ›</span>
              </button>
            )}
            <div className="mod-label">
              <span className="caps-muted">Modules</span>
              {!several && (
                <button type="button" className="mod-label-ws" data-nav="row" data-testid="workspace-row" title="Workspaces" onClick={() => setView('workspaces')}>
                  {session.tenant.name} ›
                </button>
              )}
            </div>
            <div className="mod-grid" role="list">
              {MODULES.map((m) => {
                const locked = lockReason(m, session.tenant.role);
                const isCurrent = current?.id === m.id;
                return (
                  <div key={m.id} role="listitem" style={{ minWidth: 0 }}>
                    <button
                      type="button"
                      className={'mod-item' + (isCurrent ? ' current' : '') + (locked ? ' locked' : '')}
                      data-nav="module"
                      data-module={m.id}
                      aria-current={isCurrent ? 'true' : undefined}
                      aria-disabled={locked ? 'true' : undefined}
                      title={locked ? `${m.name}: ${LOCK_LABEL[locked]}` : m.description}
                      onClick={() => {
                        if (locked || !m.to) return;
                        onClose();
                        navigate(m.to);
                      }}
                    >
                      <span className="mod-tile">
                        <Icon name={m.icon} size={19} />
                      </span>
                      <span className="mod-text">
                        <span className="mod-name">{m.name}</span>
                        <span className="mod-desc">
                          {locked ? (
                            <>
                              <Icon name="lock" size={11} /> {LOCK_LABEL[locked]}
                            </>
                          ) : (
                            m.description
                          )}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mod-foot">
              <Icon name="apps" size={15} />
              <span style={{ flex: 1 }}>Jump to a module</span>
              <kbd className="kbd">{SWITCHER_KEYS}</kbd>
            </div>
          </>
        ) : (
          <>
            <div className="mod-list-head">
              <button type="button" className="mod-back" data-nav="back" onClick={() => setView('modules')}>
                ‹ Modules
              </button>
              <span className="caps-muted">Workspaces</span>
            </div>
            <div role="list" data-testid="workspace-list">
              {tenants.map((t) => {
                const isCurrent = t.id === session.tenant.id;
                const count = members(t);
                return (
                  <div key={t.id} role="listitem">
                    <button
                      type="button"
                      className={isCurrent ? 'ws-item mod-ws-item current' : 'ws-item mod-ws-item'}
                      data-nav="workspace"
                      data-workspace={t.name}
                      aria-current={isCurrent ? 'true' : undefined}
                      onClick={() => {
                        onClose();
                        if (!isCurrent) session.switchTenant(t.id);
                      }}
                    >
                      <span className="ws-initial mod-ws-initial">{initial(t.name)}</span>
                      <span className="mod-text">
                        <span className="mod-name ws-name">{t.name}</span>
                        {count && <span className="mod-desc">{count}</span>}
                      </span>
                      {isCurrent && (
                        <span className="mod-check" aria-label="Current workspace">
                          <Icon name="check" size={16} />
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mod-list-foot">
              {creating ? (
                <form onSubmit={(e) => void create(e)} className="mod-new-form">
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
                <button type="button" className="mod-new" data-nav="new" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={16} />
                  New workspace
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
