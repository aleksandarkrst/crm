import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { currentModule, navFor, type NavDef, rememberModule, routeModule } from './modules';
import { ModuleSwitcher, SWITCHER_KEYS } from './ModuleSwitcher';

const SETTINGS = {
  to: '/settings',
  label: 'Settings',
  icon: 'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.63 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.39.3.61.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Z',
};
const PROFILE_ICON = 'M12 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM5 20c1.2-3.1 4-4.7 7-4.7s5.8 1.6 7 4.7';
/** The gap between sidebar items, and an item's height before one has been measured. */
const NAV_GAP = 6;
const NAV_ITEM_HEIGHT = 66;
const PHONE = '(max-width: 700px)';
/** Whether the screen at `pathname` is the page `to` (or one under it). */
const onPage = (pathname: string, to: string) => {
  const path = to.split('?')[0]!;
  return pathname === path || pathname.startsWith(path + '/');
};

/**
 * One sidebar item. `badge`: a count on the icon (overdue tasks on Today). `className`: where it
 * shows (`nav-desktop`: not in the phone bar; `nav-overflow`: under "More" on desktop).
 */
function NavItem({ to, label, icon, badge, className = '' }: { to: string; label: string; icon: string; badge?: number; className?: string }) {
  return (
    <NavLink to={to} className={('nav-item ' + className).trim()} style={{ textDecoration: 'none', width: '100%' }}>
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

/**
 * How many of `count` sidebar items fit in `nav` on desktop (CD-223): all of them, or as many as
 * fit next to a "More" item. Measured again whenever the sidebar's height changes. On phones (the
 * bottom bar) everything counts as fitting: the phone bar has its own "More".
 */
function useFit(nav: RefObject<HTMLElement | null>, count: number) {
  const [fit, setFit] = useState(count);
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      if (window.matchMedia(PHONE).matches) return setFit(count);
      const item = el.querySelector<HTMLElement>('.nav-item:not(.nav-overflow)');
      const h = item?.offsetHeight || NAV_ITEM_HEIGHT;
      const room = el.clientHeight;
      if (count * h + (count - 1) * NAV_GAP <= room) return setFit(count);
      setFit(Math.max(0, Math.floor((room + NAV_GAP) / (h + NAV_GAP)) - 1));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [nav, count]);
  return Math.min(fit, count);
}

/**
 * The sidebar (CD-223): the Pultly mark (home), the module switcher showing the module you're in,
 * that module's pages, and Settings at the bottom. Each module is its own app: the sidebar shows
 * only its pages; those that don't fit go under "More". On phones it is the bottom bar (CD-70).
 */
function Sidebar() {
  const { s, session } = useStore();
  const { pathname } = useLocation();
  // The profile name follows edits on the Profile screen; the session name is the signed-in user.
  const name = s.profile.name || session.userName;
  const overdue = overdueTasks(s).length;
  const module = currentModule(pathname, session.userId);
  const items = navFor(module, session.tenant.role, s.visitScope.seesTeam);
  // Settings and the profile keep the module you came from.
  const own = routeModule(pathname);
  useEffect(() => {
    if (own) rememberModule(session.userId, own);
  }, [own, session.userId]);
  const nav = useRef<HTMLElement>(null);
  const fit = useFit(nav, items.length);
  const [switcher, setSwitcher] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Closing hands focus back to the switcher button (when it's on screen: not on phones).
  const closeSwitcher = useCallback(() => {
    setSwitcher(false);
    if (trigger.current?.offsetParent) trigger.current.focus();
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
    <aside className="app-sidebar" style={{ width: 96, flex: '0 0 96px', background: 'var(--forest)', color: '#F5F7F6', padding: '18px 8px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, position: 'sticky', top: 0, height: '100vh', zIndex: 10 }}>
      <div className="nav-desktop side-top">
        <Link to="/" className="ws-logo" aria-label="Pultly home" title="Home">
          <Logo height={26} onDark wordmark={false} />
        </Link>
        <button
          ref={trigger}
          type="button"
          className="mod-trigger"
          data-testid="module-switcher"
          data-current-module={module.id}
          title={`${session.tenant.name} · modules and workspaces (${SWITCHER_KEYS})`}
          aria-label={`${module.name}: switch module or workspace`}
          aria-haspopup="dialog"
          aria-expanded={switcher}
          onClick={() => (switcher ? closeSwitcher() : setSwitcher(true))}
        >
          <span className="mod-trigger-tile">
            <Icon name={module.icon} size={18} />
          </span>
          <span className="mod-trigger-name">
            <span className="mod-trigger-text">{module.name}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </button>
      </div>
      {switcher && <ModuleSwitcher onClose={closeSwitcher} trigger={trigger} />}
      <nav ref={nav} aria-label={module.name} className="side-nav" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: NAV_GAP, width: '100%', flex: '1 1 0', minHeight: 0 }}>
        {items.map((n, i) => (
          <NavItem key={n.to} {...n} badge={n.to === paths.today ? overdue : undefined} className={(n.phone ? '' : 'nav-desktop ') + (i >= fit ? 'nav-overflow' : '')} />
        ))}
        {fit < items.length && <SideMore items={items.slice(fit)} />}
        <MoreMenu name={name} items={items.filter((n) => !n.phone)} onModules={() => setSwitcher(true)} />
      </nav>
      <div className="nav-desktop" style={{ width: '100%' }}>
        <NavItem {...SETTINGS} />
      </div>
    </aside>
  );
}

/**
 * Desktop (CD-223): the sidebar's pages that don't fit, behind a "⋯ More" item that opens a menu
 * to its right (the phone sheet's look). Arrow keys move between the pages; Escape or an outside
 * click closes it.
 */
function SideMore({ items }: { items: NavDef[] }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const active = items.some((n) => onPage(pathname, n.to));
  const fg = active || open ? '#F5F7F6' : '#93A39B';
  const close = useCallback((focus: boolean) => {
    setOpen(false);
    if (focus) button.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open, close]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const links = Array.from(pop.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
    const at = links.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : (at + (e.key === 'ArrowUp' ? -1 : 1) + links.length) % links.length;
    links[next]?.focus();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="side-more nav-desktop"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="sidebar-more"
        title={items.map((n) => n.label).join(', ')}
        onClick={() => (open ? close(false) : setOpen(true))}
        style={{ color: fg }}
      >
        <span className="nav-icon" style={{ background: active ? 'var(--green-500)' : 'transparent' }}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />
          </svg>
        </span>
        <span className="nav-label">More</span>
      </button>
      {open && (
        <div ref={pop} className="side-more-pop" role="menu" aria-label="More pages" data-testid="sidebar-more-pop" onKeyDown={onKeyDown}>
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} className="menu-item" role="menuitem" onClick={() => close(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={n.icon} />
              </svg>
              <span className="menu-item-title">{n.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Phones only (CD-70): the bottom bar holds the module's everyday screens; "More" opens a sheet
 * with its other pages, Settings, the profile, the module switcher (a bottom sheet there, CD-214)
 * and the workspace switch. Hidden on wider screens by CSS.
 */
function MoreMenu({ name, items, onModules }: { name: string; items: NavDef[]; onModules: () => void }) {
  const { session } = useStore();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const more = [...items, SETTINGS, { to: paths.profile, label: `Profile · ${name}`, icon: PROFILE_ICON }];
  const active = more.some((n) => onPage(pathname, n.to));
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
