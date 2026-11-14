import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Screen } from '../components/Layout';
import { homeModules } from '../components/modules';
import { paths } from '../lib/paths';
import { useWaiting } from '../store/home';
import { useStore } from '../store/store';

/** "Good morning" until noon, "Good afternoon" until six, then "Good evening". */
function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * Home (CD-288, design "Home, all modules"): where everyone lands. The date and a greeting, a
 * search that narrows the tiles, and one tile per module this person can open in this workspace
 * (`homeModules`: turned on in Workspace settings and allowed for their role), each opening the
 * module. Nothing to open: an empty state that points to Workspace settings. No counts, previews
 * or widget boxes. "Waiting for you" (`useWaiting`) lists what needs this person in those modules.
 */
export function Home() {
  const { s, session, canEditWorkspace } = useStore();
  const [q, setQ] = useState('');
  const all = homeModules(session.tenant.role, s.workspace.modules);
  const modules = all.filter((m) => !m.settings);
  const waiting = useWaiting(new Set(modules.map((m) => m.id)));
  const query = q.trim().toLowerCase();
  const shown = all.filter((m) => !query || m.name.toLowerCase().includes(query) || m.description.toLowerCase().includes(query));
  const now = new Date();
  const first = (s.profile.name || session.userName).trim().split(/\s+/)[0];

  return (
    <Screen title="Home">
      <div className="home" data-testid="home">
        <div className="home-hello">
          <span className="home-date">
            {now.toLocaleDateString('en-GB', { weekday: 'long' })}, {now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}
          </span>
          <h2 className="home-greeting">{first ? `${greeting(now)}, ${first}` : greeting(now)}</h2>
          {modules.length > 0 && (
            <label className="home-search">
              <Icon name="search" size={16} />
              <input type="search" aria-label="Find a module" placeholder="Find a module" value={q} onChange={(e) => setQ(e.target.value)} data-testid="home-search" />
            </label>
          )}
        </div>
        {modules.length === 0 ? (
          <div className="empty-block" data-testid="home-empty">
            <span className="empty-block-title">No modules are turned on</span>
            <span className="empty-block-text">{canEditWorkspace ? 'Turn on the modules this workspace uses in Workspace settings.' : 'Ask an owner or admin to turn on modules in Workspace settings.'}</span>
            {canEditWorkspace && (
              <div className="empty-block-actions">
                <Link to={paths.settings('modules')} className="btn btn-primary">
                  Open Workspace settings
                </Link>
              </div>
            )}
          </div>
        ) : (
          <>
            <nav aria-label="Modules" className="home-grid" data-testid="home-modules">
              {shown.map((m) => (
                <Link key={m.id} to={m.to!} className="home-tile" data-module={m.id}>
                  <span className={`home-icon home-icon-${m.id}`} aria-hidden="true">
                    <Icon name={m.icon} size={32} />
                  </span>
                  <span className="home-name">{m.name}</span>
                  <span className="home-line">{m.description}</span>
                </Link>
              ))}
            </nav>
            {shown.length === 0 && <p className="home-none">No module matches that.</p>}
            <section className="home-waiting" aria-labelledby="home-waiting-title" data-testid="home-waiting">
              <div className="home-waiting-head">
                <h3 id="home-waiting-title">Waiting for you</h3>
                <span>From all your modules</span>
              </div>
              <div className="home-waiting-list">
                {waiting.items.length === 0 ? (
                  <p className="home-waiting-empty">{waiting.loading ? 'Loading' : 'Nothing is waiting for you.'}</p>
                ) : (
                  waiting.items.map((w) => {
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
                        <Link to={w.to} className="home-waiting-action">
                          {w.action}
                        </Link>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </Screen>
  );
}
