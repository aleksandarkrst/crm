import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HeaderCenter, HeaderRight } from '../../components/HeaderTools';
import { Icon, type IconName } from '../../components/icons';
import { Logo } from '../../components/Logo';
import { paths } from '../../lib/paths';

/** One page in a settings sidebar: its icon and name, the current one a white pill (aria-current). */
export function NavRow({ k, label, icon, on, pill, onClick }: { k: string; label: string; icon: IconName; on: boolean; pill?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={'gs-nav-row' + (on ? ' on' : '')} aria-current={on ? 'page' : undefined} data-section={k} onClick={onClick}>
      <span className="ic">
        <Icon name={icon} size={17} />
      </span>
      <span className="label">{label}</span>
      {pill}
    </button>
  );
}

/**
 * The glass shell both settings areas share (CD-524 Workspace settings, CD-525 Profile settings):
 * the fixed glass sidebar (the logo tile back to the modules, a head, the pages), the glass top bar
 * with the page title, the bell and the avatar, and the page under it. Below 900 px the sidebar is a
 * row of pills above the content (global.css `.gs-*`).
 */
export function GlassShell({
  label,
  testId,
  head,
  nav,
  title,
  search = true,
  children,
  after,
}: {
  /** The sidebar's accessible name. */
  label: string;
  testId: string;
  /** Next to the logo tile: the workspace name, or who you are. */
  head: ReactNode;
  /** The NavRows. */
  nav: ReactNode;
  title: string;
  /** The top bar's search box (Workspace settings has it; Profile settings doesn't). */
  search?: boolean;
  children: ReactNode;
  /** Rendered after the main column (dialogs). */
  after?: ReactNode;
}) {
  return (
    <div className="gs">
      <span className="gs-blob" aria-hidden="true" style={{ width: 560, height: 560, left: -160, top: -200, background: 'var(--gs-blob-1)', opacity: 0.45 }} />
      <span className="gs-blob" aria-hidden="true" style={{ width: 440, height: 440, right: -100, top: 40, background: 'var(--gs-blob-2)', opacity: 0.5 }} />
      <span className="gs-blob" aria-hidden="true" style={{ width: 520, height: 380, left: '35%', bottom: -200, background: 'var(--gs-blob-3)', opacity: 0.45 }} />
      <aside className="gs-side gs-glass" aria-label={label} data-testid={testId}>
        <div className="gs-side-head">
          <Link className="gs-home" to={paths.home} aria-label="Back to all modules" title="All modules">
            <span className="mark" aria-hidden="true">
              <Logo height={14} onDark wordmark={false} />
            </span>
            <span className="back" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M11 6l-6 6 6 6" />
              </svg>
            </span>
          </Link>
          {head}
        </div>
        <nav className="gs-nav">{nav}</nav>
      </aside>
      <div className="gs-main">
        <header className={'gs-topbar gs-glass' + (search ? '' : ' no-search')}>
          <h1>{title}</h1>
          {search && <HeaderCenter create={false} />}
          <HeaderRight />
        </header>
        {children}
      </div>
      {after}
    </div>
  );
}
