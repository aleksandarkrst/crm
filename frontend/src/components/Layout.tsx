import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { paths } from '../lib/paths';
import { Modals } from '../modals/Modals';
import { overdueTasks } from '../store/selectors';
import { useStore } from '../store/store';
import { GettingStarted } from './GettingStarted';
import { CommandPalette } from './CommandPalette';
import { HeaderCenter, HeaderRight } from './HeaderTools';
import { Icon } from './icons';
import { Logo } from './Logo';
import { ModuleSwitcher, SWITCHER_KEYS } from './ModuleSwitcher';

const NAV = [
  // `phone`: in the bottom bar on phones; the others are under "More" there (CD-70).
  { to: paths.overview, label: 'Overview', icon: 'M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6' },
  { to: paths.pipeline, label: 'Pipeline', icon: 'M4 5h5v14H4zM15 5h5v9h-5z', phone: true },
  { to: paths.today, label: 'Today', icon: 'M5 5h14v14H5zM9 12l2 2 4-4', phone: true },
  { to: paths.calendar(), label: 'Calendar', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4' },
  { to: paths.visitPlans, label: 'Visit plans', icon: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  { to: paths.companies, label: 'Companies', icon: 'M4 20V6.5L11 4v16M11 20h9V10h-9M14.5 13h2M14.5 16.5h2M7 8.5h1M7 12h1M7 15.5h1', phone: true },
  { to: paths.contacts, label: 'Contacts', icon: 'M12 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM5 20c1.2-3.1 4-4.7 7-4.7s5.8 1.6 7 4.7', phone: true },
  { to: paths.products, label: 'Products', icon: 'M20 8.5 12 4 4 8.5v7L12 20l8-4.5v-7ZM4 8.5 12 13m0 0 8-4.5M12 13v7' },
  // Owners and admins only (CD-135).
  { to: paths.reports(), label: 'Reports', icon: 'M5 20V10M10 20V4M15 20v-7M20 20v-4M3 20h18', managers: true },
];
/** The sidebar items this person sees: Reports is for owners and admins. */
const navFor = (role: string) => NAV.filter((n) => !('managers' in n) || role === 'owner' || role === 'admin');
const NAV_BOTTOM = [
  {
    to: '/settings',
    label: 'Settings',
    icon: 'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.63 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.39.3.61.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Z',
  },
];

/** `badge`: a count on the icon (overdue tasks on Today). */
function NavItem({ to, label, icon, badge, phone }: { to: string; label: string; icon: string; badge?: number; phone?: boolean; managers?: boolean }) {
  return (
    <NavLink to={to} className={phone ? 'nav-item' : 'nav-item nav-desktop'} style={{ textDecoration: 'none', width: '100%' }}>
      {({ isActive }) => {
        const fg = isActive ? '#F5F7F6' : '#93A39B';
        return (
          <span className="nav-item-inner" style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: '100%', padding: '2px 0 4px', color: fg }}>
            <span className="nav-icon" style={{ width: 46, height: 42, borderRadius: 11, background: isActive ? 'var(--green-500)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon} />
              </svg>
              {!!badge && (
                <span data-testid="nav-badge" title={`${badge} overdue`} style={{ position: 'absolute', top: 0, right: 14, minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, background: '#B42318', color: '#FFFFFF', fontSize: 10.5, fontWeight: 600, lineHeight: '17px', textAlign: 'center' }}>
                  {badge}
                </span>
              )}
            </span>
            <span className="nav-label" style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.01em', lineHeight: 1.2, textAlign: 'center' }}>{label}</span>
          </span>
        );
      }}
    </NavLink>
  );
}

function Sidebar() {
  const { s, session } = useStore();
  // The profile name follows edits on the Profile screen; the session name is the signed-in user.
  const name = s.profile.name || session.userName;
  const overdue = overdueTasks(s).length;
  const [switcher, setSwitcher] = useState(false);
  const logo = useRef<HTMLButtonElement>(null);
  // Closing hands focus back to the Pultly mark (when it's on screen: not on phones).
  const closeSwitcher = useCallback(() => {
    setSwitcher(false);
    if (logo.current?.offsetParent) logo.current.focus();
  }, []);
  // ⌘J / Ctrl J opens (and closes) the module switcher from anywhere (CD-214).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setSwitcher((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <aside className="app-sidebar" style={{ width: 96, flex: '0 0 96px', background: 'var(--forest)', color: '#F5F7F6', padding: '18px 8px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, position: 'sticky', top: 0, height: '100vh', zIndex: 10 }}>
      <div className="nav-desktop">
        <button
          ref={logo}
          type="button"
          className="ws-logo"
          data-testid="module-switcher"
          title={`${session.tenant.name} · modules and workspaces (${SWITCHER_KEYS})`}
          aria-haspopup="dialog"
          aria-expanded={switcher}
          onClick={() => (switcher ? closeSwitcher() : setSwitcher(true))}
        >
          <Logo height={26} onDark wordmark={false} />
        </button>
      </div>
      {switcher && <ModuleSwitcher onClose={closeSwitcher} trigger={logo} />}
      <nav style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%' }}>
        {navFor(session.tenant.role).map((n) => (
          <NavItem key={n.to} {...n} badge={n.to === paths.today ? overdue : undefined} />
        ))}
        <MoreMenu name={name} onModules={() => setSwitcher(true)} />
      </nav>
    </aside>
  );
}

/**
 * Phones only (CD-70): the bottom bar holds the four everyday screens; "More" opens a sheet with
 * the rest, the profile, the module switcher (a bottom sheet there, CD-214) and the workspace
 * switch. Hidden on wider screens by CSS.
 */
function MoreMenu({ name, onModules }: { name: string; onModules: () => void }) {
  const { session } = useStore();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const more = [...navFor(session.tenant.role).filter((n) => !('phone' in n && n.phone)), ...NAV_BOTTOM, { to: paths.profile, label: `Profile · ${name}`, icon: 'M12 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM5 20c1.2-3.1 4-4.7 7-4.7s5.8 1.6 7 4.7' }];
  const active = more.some((n) => pathname.startsWith(n.to));
  const fg = active || open ? '#F5F7F6' : '#93A39B';
  const others = session.tenants.filter((t) => t.id !== session.tenant.id);
  return (
    <>
      <button type="button" className="nav-more" aria-expanded={open} aria-label="More" data-testid="nav-more" onClick={() => setOpen(!open)} style={{ color: fg }}>
        <span className="nav-icon" style={{ background: active ? 'var(--green-500)' : 'transparent' }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="1.7" strokeLinecap="round">
            <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />
          </svg>
        </span>
        <span className="nav-label">More</span>
      </button>
      {open && (
        <>
          <div className="more-backdrop" onClick={() => setOpen(false)} />
          <div className="more-sheet" role="menu" data-testid="more-sheet">
            {more.map((n) => (
              <NavLink key={n.to} to={n.to} className="menu-item" role="menuitem" onClick={() => setOpen(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d={n.icon} />
                </svg>
                <span className="menu-item-title">{n.label}</span>
              </NavLink>
            ))}
            <button
              type="button"
              className="menu-item"
              role="menuitem"
              data-testid="more-modules"
              onClick={() => {
                setOpen(false);
                onModules();
              }}
            >
              <Icon name="apps" size={18} />
              <span className="menu-item-title">Modules and workspaces</span>
            </button>
            <div className="menu-divider" />
            <div className="caps-muted menu-label">Workspace · {session.tenant.name}</div>
            {others.map((t) => (
              <button key={t.id} type="button" className="menu-item" role="menuitem" onClick={() => session.switchTenant(t.id)}>
                <span className="menu-item-title">Switch to {t.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function Layout() {
  const { s, set } = useStore();
  // Ctrl K / ⌘K opens (and closes) the command palette from anywhere (CD-80).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        set((x) => ({ paletteOpen: !x.paletteOpen }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);
  return (
    <div style={{ display: 'flex', minHeight: '100vh', color: 'var(--ink)', background: 'var(--white)' }}>
      <Sidebar />
      <main className="app-main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <GettingStarted />
        <Outlet />
      </main>
      <Modals />
      {s.paletteOpen && <CommandPalette />}
      {s.toast && <div className="toast">{s.toast}</div>}
    </div>
  );
}

/**
 * Header + content frame for one screen (CD-80): the screen's name on the left ("Companies /
 * Company" on a record, with a link back), search and "+" in the middle, notifications and the
 * account menu on the right. Records show their own name in the page, not in the header.
 */
export function Screen({ title, parent, children }: { title: string; parent?: { label: string; to: string }; children: ReactNode }) {
  return (
    <>
      <header className="screen-header">
        <div className="header-title">
          {parent && (
            <>
              <Link to={parent.to} className="crumb-link header-parent">
                {parent.label}
              </Link>
              <span className="header-sep" aria-hidden>
                /
              </span>
            </>
          )}
          <h1>{title}</h1>
        </div>
        <HeaderCenter />
        <HeaderRight />
      </header>
      <div className="screen-content" style={{ padding: '18px 30px 44px', flex: 1, background: 'var(--white)' }}>
        {children}
      </div>
    </>
  );
}
