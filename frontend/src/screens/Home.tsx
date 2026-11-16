import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeaderRight, usePopover } from '../components/HeaderTools';
import { Icon } from '../components/icons';
import { Logo } from '../components/Logo';
import { homeModules, type ModuleDef, moduleMatches } from '../components/modules';
import type { ApiTenant } from '../lib/api';
import { paths } from '../lib/paths';
import { useWaiting } from '../store/home';
import { useStore } from '../store/store';
import '../styles/home.css';

/** "Good morning" until noon, "Good afternoon" until six, then "Good evening". */
function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "Simplicity Labs" → "SL". */
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';

const ROLE: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/** Rows of "Waiting for you" shown before "Show all N". */
const FIRST_ROWS = 5;

/**
 * Home (CD-288, spec in the issue, board S-Home): where everyone lands, after sign-in and after
 * switching workspace. A glass top bar (Pultly, the workspace switcher, the bell and the avatar
 * menu), the date and a greeting, "Find a module", one tile per module this person can open in
 * this workspace (`homeModules`: on in Workspace settings and allowed for their role) in two
 * groups, and "Waiting for you" (`useWaiting`). No counts, previews or widget boxes.
 */
export function Home() {
  const { s, session, canEditWorkspace } = useStore();
  const [q, setQ] = useState('');
  const [allRows, setAllRows] = useState(false);
  const all = homeModules(session.tenant.role, s.workspace.modules);
  const modules = all.filter((m) => !m.settings);
  const waiting = useWaiting(new Set(modules.map((m) => m.id)));
  const shown = all.filter((m) => moduleMatches(m, q));
  const daily = shown.filter((m) => !m.planning);
  const planning = shown.filter((m) => m.planning);
  const rows = allRows ? waiting.items : waiting.items.slice(0, FIRST_ROWS);
  const now = new Date();
  const tz = s.workspace.timezone || undefined;
  const first = (s.profile.name || session.userName).trim().split(/\s+/)[0];

  const tile = (m: ModuleDef) => (
    <Link key={m.id} to={m.to!} className="home-tile" data-module={m.id}>
      <span className={`home-icon home-icon-${m.id}`} aria-hidden="true">
        <Icon name={m.icon} size={32} />
      </span>
      <span className="home-name">{m.settings ? 'Settings' : m.name}</span>
      <span className="home-line">{m.description}</span>
    </Link>
  );

  return (
    // gs-tokens: the redesign's glass tokens, shared with Workspace settings (global.css).
    <div className="home-page gs-tokens" data-testid="home">
      <div className="home-blobs" aria-hidden="true">
        <span className="home-blob home-blob-1" />
        <span className="home-blob home-blob-2" />
        <span className="home-blob home-blob-3" />
      </div>
      <header className="home-bar home-glass">
        <span className="home-brand">
          <span className="home-brand-tile">
            <Logo height={18} onDark wordmark={false} />
          </span>
          <span className="home-brand-name">Pultly</span>
        </span>
        <WorkspaceSwitcher />
        <span className="home-bar-right">
          <HeaderRight />
        </span>
      </header>

      <div className="home">
        <div className="home-hello">
          <span className="home-date">
            {/* The workspace's day, as "Waiting for you" counts Today and Yesterday. */}
            {now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: tz })}, {now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: tz })}
          </span>
          <h1 className="home-greeting">{first ? `${greeting(now)}, ${first}` : greeting(now)}</h1>
          {modules.length > 0 && (
            <label className="home-search home-glass">
              <Icon name="search" size={16} />
              <input
                type="search"
                aria-label="Find a module"
                placeholder="Find a module"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQ('')}
                data-testid="home-search"
              />
            </label>
          )}
        </div>

        {modules.length === 0 ? (
          <div className="home-card home-glass home-empty" data-testid="home-empty">
            {canEditWorkspace ? (
              <>
                <span>No modules are on yet.</span>
                <Link to={paths.settings('modules')} className="home-btn home-btn-primary">
                  Turn on modules
                </Link>
              </>
            ) : (
              <span>No modules are on for you yet. Ask an admin of {session.tenant.name} to give you access.</span>
            )}
          </div>
        ) : (
          <>
            <div className="home-card home-glass">
              <nav aria-label="Modules" className="home-grid" data-testid="home-modules">
                {daily.map(tile)}
                {planning.length > 0 && (
                  <div className="home-divider" role="separator">
                    <span>Planning and management, a few times a year</span>
                  </div>
                )}
                {planning.map(tile)}
              </nav>
            </div>
            {shown.length === 0 && <p className="home-none">No module matches that. Try “time” or “sales”.</p>}

            <section className="home-waiting" aria-labelledby="home-waiting-title" data-testid="home-waiting">
              <div className="home-waiting-head">
                <h2 id="home-waiting-title">Waiting for you</h2>
                <span>From all your modules</span>
              </div>
              <div className="home-waiting-list home-glass">
                {waiting.items.length === 0 ? (
                  <p className="home-waiting-empty">{waiting.loading ? 'Loading' : 'Nothing is waiting for you.'}</p>
                ) : (
                  rows.map((w) => {
                    const m = all.find((x) => x.id === w.module);
                    return (
                      <div key={w.key} className="home-waiting-row" data-module={w.module}>
                        <span className={`home-mini home-icon-${w.module}`} aria-hidden="true">
                          {m && <Icon name={m.icon} size={17} />}
                        </span>
                        <span className="home-waiting-text">
                          <span>{w.text}</span>
                          <span className="home-waiting-meta">{w.meta}</span>
                        </span>
                        <Link to={w.to} className="home-btn">
                          {w.action}
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
              {!allRows && waiting.items.length > FIRST_ROWS && (
                <button type="button" className="home-more" onClick={() => setAllRows(true)} data-testid="home-waiting-more">
                  Show all {waiting.items.length}
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The workspace switcher in Home's top bar: the workspace's initials and name, and a glass menu
 * with every workspace of this person. Picking another loads Home for that workspace.
 */
function WorkspaceSwitcher() {
  const { session } = useStore();
  const pop = usePopover();
  const tenants = [...session.tenants].sort((a, b) => a.name.localeCompare(b.name));
  const pick = (t: ApiTenant) => {
    pop.setOpen(false);
    if (t.id !== session.tenant.id) session.switchTenant(t.id);
  };
  // Opening focuses the current workspace; arrow keys, Home and End move between the rows.
  useEffect(() => {
    if (pop.open) pop.ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [pop.open, pop.ref]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const rows = Array.from(pop.ref.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? []);
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : (at + (e.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length;
    rows[next]?.focus();
  };
  return (
    <div ref={pop.ref} className="home-ws">
      <button type="button" className="home-ws-btn" aria-haspopup="menu" aria-expanded={pop.open} onClick={() => pop.setOpen(!pop.open)} data-testid="home-workspace">
        <span className="home-ws-tile">{initials(session.tenant.name)}</span>
        <span className="home-ws-name">{session.tenant.name}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {pop.open && (
        <div className="home-menu" role="menu" aria-label="Workspaces" onKeyDown={onKeyDown}>
          <div className="home-menu-head">Workspaces</div>
          {tenants.map((t) => (
            <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === session.tenant.id} className="home-menu-row" onClick={() => pick(t)}>
              <span className="home-ws-tile home-ws-tile-lg">{initials(t.name)}</span>
              <span className="home-menu-text">
                <span>{t.name}</span>
                <span className="home-menu-sub">{ROLE[t.role] ?? t.role}</span>
              </span>
              {t.id === session.tenant.id && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
