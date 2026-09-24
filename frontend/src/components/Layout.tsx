import { type ReactNode, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { crmApi } from '../lib/api';
import { paths } from '../lib/paths';
import { Modals } from '../modals/Modals';
import { initialsOf, overdueTasks } from '../store/selectors';
import { useStore } from '../store/store';
import { HeaderTools } from './HeaderTools';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const NAV = [
  { to: paths.overview, label: 'Overview', icon: 'M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6' },
  { to: paths.pipeline, label: 'Pipeline', icon: 'M4 5h5v14H4zM15 5h5v9h-5z' },
  { to: paths.today, label: 'Today', icon: 'M5 5h14v14H5zM9 12l2 2 4-4' },
  { to: paths.companies, label: 'Companies', icon: 'M4 20V6.5L11 4v16M11 20h9V10h-9M14.5 13h2M14.5 16.5h2M7 8.5h1M7 12h1M7 15.5h1' },
  { to: paths.contacts, label: 'Contacts', icon: 'M12 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6ZM5 20c1.2-3.1 4-4.7 7-4.7s5.8 1.6 7 4.7' },
  { to: paths.products, label: 'Products', icon: 'M20 8.5 12 4 4 8.5v7L12 20l8-4.5v-7ZM4 8.5 12 13m0 0 8-4.5M12 13v7' },
];
const NAV_BOTTOM = [
  {
    to: '/settings',
    label: 'Settings',
    icon: 'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.63 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.12.22.39.3.61.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.49 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4Z',
  },
];

/** `badge`: a count on the icon (overdue tasks on Today). */
function NavItem({ to, label, icon, badge }: { to: string; label: string; icon: string; badge?: number }) {
  return (
    <NavLink to={to} style={{ textDecoration: 'none', width: '100%' }}>
      {({ isActive }) => {
        const fg = isActive ? '#F5F6F8' : '#98A2B3';
        return (
          <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: '100%', padding: '2px 0 4px', color: fg }}>
            <span style={{ width: 46, height: 42, borderRadius: 11, background: isActive ? '#14503C' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon} />
              </svg>
              {!!badge && (
                <span data-testid="nav-badge" title={`${badge} overdue`} style={{ position: 'absolute', top: 0, right: 14, minWidth: 17, height: 17, padding: '0 5px', borderRadius: 9, background: '#B42318', color: '#FFFFFF', fontSize: 10.5, fontWeight: 600, lineHeight: '17px', textAlign: 'center' }}>
                  {badge}
                </span>
              )}
            </span>
            <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.01em', lineHeight: 1.2, textAlign: 'center' }}>{label}</span>
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
  return (
    <aside className="app-sidebar" style={{ width: 96, flex: '0 0 96px', background: '#101828', color: '#F5F6F8', padding: '18px 8px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, position: 'sticky', top: 0, height: '100vh', zIndex: 10 }}>
      <WorkspaceSwitcher />
      <nav style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%' }}>
        {NAV.map((n) => (
          <NavItem key={n.to} {...n} badge={n.to === paths.today ? overdue : undefined} />
        ))}
      </nav>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, width: '100%' }}>
        {NAV_BOTTOM.map((n) => (
          <NavItem key={n.to} {...n} />
        ))}
        <NavLink to={paths.profile} title={`Profile settings · ${name}`} data-testid="sidebar-avatar" style={{ textDecoration: 'none' }}>
          {({ isActive }) => (
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: isActive ? '#CBE3DA' : '#E7F2EE', color: '#14503C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>
              {initialsOf(name)}
            </div>
          )}
        </NavLink>
      </div>
    </aside>
  );
}

function GettingStarted() {
  const { s, set, session } = useStore();
  const [busy, setBusy] = useState(false);
  if (session.tenant.role === 'member' || s.profile.onboardingDismissed) return null;
  const customisedFunnel = Object.values(s.funnels).some((f) => f.stages.length > 0);
  const items = [
    { done: customisedFunnel, label: 'Set up your funnel', to: paths.settings('funnels') },
    { done: s.catalog.length > 0, label: 'Add products', to: paths.products },
    { done: s.leads.length > 0, label: 'Import or add your first deals', to: paths.pipeline },
    { done: s.team.length > 1, label: 'Invite a colleague', to: paths.settings('team') },
  ];
  if (items.every((x) => x.done)) return null;
  const dismiss = async () => {
    setBusy(true);
    await crmApi.dismissOnboarding();
    set((x) => ({ profile: { ...x.profile, onboardingDismissed: true } }));
  };
  return (
    <section className="getting-started" aria-label="Getting started">
      <div><strong>Get started with Cadence</strong><span>{items.filter((x) => x.done).length} of 4 complete</span></div>
      <div className="getting-started-items">
        {items.map((item) => <Link key={item.label} to={item.to} className={item.done ? 'done' : ''}><span>{item.done ? '✓' : '○'}</span>{item.label}</Link>)}
      </div>
      <button type="button" disabled={busy} onClick={() => void dismiss()}>Dismiss</button>
    </section>
  );
}

export function Layout() {
  const { s } = useStore();
  return (
    <div style={{ display: 'flex', minHeight: '100vh', color: 'var(--ink)', background: 'var(--white)' }}>
      <Sidebar />
      <main className="app-main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <GettingStarted />
        <Outlet />
      </main>
      <Modals />
      {s.toast && <div className="toast">{s.toast}</div>}
    </div>
  );
}

/**
 * Header + content frame for one screen. `onTitleChange` makes the title inline-editable
 * (deal and contact screens); `crumb` shows "Parent / Current" above the content.
 */
export function Screen({ title, onTitleChange, crumb, children }: { title: string; onTitleChange?: (v: string) => void; crumb?: { label: string; to: string }; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <>
      <header className="screen-header" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '11px 24px', background: 'var(--white)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 5 }}>
        <div>
          {onTitleChange ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
              <input
                className="ghost"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
                style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, borderRadius: 8, padding: '3px 8px', marginLeft: -8, minWidth: 240, width: 'auto' }}
              />
              <span style={{ fontSize: 13, color: 'var(--muted)', opacity: hover ? 1 : 0 }}>✎</span>
            </div>
          ) : (
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{title}</h1>
          )}
        </div>
        <HeaderTools />
      </header>
      <div className="screen-content" style={{ padding: '18px 30px 44px', flex: 1, background: 'var(--white)' }}>
        {crumb && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
            <Link to={crumb.to} className="crumb-link">
              {crumb.label}
            </Link>
            <span>/</span>
            <span style={{ color: 'var(--ink)' }}>{title}</span>
          </div>
        )}
        {children}
      </div>
    </>
  );
}
