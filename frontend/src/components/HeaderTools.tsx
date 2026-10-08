import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { paths } from '../lib/paths';
import { initialsOf, isOverdue, isoLabel, leadById, todayIso } from '../store/selectors';
import { useStore } from '../store/store';
import { SEARCH_SHORTCUT } from './CommandPalette';
import { ICONS } from './commands';
import { currentModule } from './modules';
import { NewMenu } from './NewMenu';

/** The middle of every screen's header (CD-80): search (opens the command palette) and "+". */
export function HeaderCenter() {
  const { set, session } = useStore();
  const { pathname } = useLocation();
  // The Projects module searches its own records first (CD-229).
  const placeholder = currentModule(pathname, session.userId).id === 'projects' ? 'Search projects, deals, companies' : 'Search deals, companies, contacts';
  return (
    <div className="header-center">
      <button type="button" className="search-trigger" data-testid="global-search" aria-label="Search and commands" onClick={() => set({ paletteOpen: true })}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </svg>
        <span className="search-trigger-text">{placeholder}</span>
        <kbd className="kbd">{SEARCH_SHORTCUT}</kbd>
      </button>
      <NewMenu />
    </div>
  );
}

/** Closes a popover on a click outside it or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/** The right side of every screen's header (CD-80): notifications and the account menu. */
export function HeaderRight() {
  return (
    <div className="header-right">
      <Notifications />
      <AccountMenu />
    </div>
  );
}

/**
 * Your open tasks that are overdue or due today, from the tasks you own. Nothing is made up: with
 * no such task the bell says so.
 */
function Notifications() {
  const { s, session, openLead } = useStore();
  const pop = usePopover();
  const today = todayIso(s.workspace.timezone);
  const mine = s.leadTasks
    .filter((t) => !t.done && t.ownerId === session.userId && t.due && t.due <= today && s.leads.some((l) => l.id === t.leadId))
    .sort((a, b) => a.due.localeCompare(b.due));
  return (
    <div ref={pop.ref} className="new-menu">
      <button type="button" className="icon-round" data-testid="notifications" aria-label={mine.length ? `Notifications: ${mine.length}` : 'Notifications'} title="Notifications" aria-expanded={pop.open} onClick={() => pop.setOpen(!pop.open)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={ICONS.bell} />
        </svg>
        {mine.length > 0 && <span className="dot-badge">{mine.length > 9 ? '9+' : mine.length}</span>}
      </button>
      {pop.open && (
        <div className="menu-pop" role="menu" style={{ right: 0, width: 320 }} data-testid="notifications-pop">
          <div className="caps-muted menu-label">Your tasks due</div>
          {mine.length === 0 && <div className="search-empty">Nothing overdue or due today.</div>}
          {mine.slice(0, 8).map((t) => {
            const lead = leadById(s, t.leadId);
            const late = isOverdue(t, today);
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  pop.setOpen(false);
                  openLead(t.leadId);
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span className="menu-item-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.title}
                  </span>
                  <span className="search-item-sub">{lead?.title || lead?.company}</span>
                </span>
                <span className={late ? 'badge badge-danger' : 'badge badge-warn'} style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {late ? 'Overdue · ' + isoLabel(t.due) : 'Today'}
                </span>
              </button>
            );
          })}
          <div className="menu-divider" />
          <NavButton to={paths.today} label="Open Today" onDone={() => pop.setOpen(false)} />
          <NavButton to={paths.settings('notifications')} label="Notification settings" onDone={() => pop.setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function NavButton({ to, label, onDone }: { to: string; label: string; onDone: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      onClick={() => {
        onDone();
        navigate(to);
      }}
    >
      <span className="menu-item-title">{label}</span>
    </button>
  );
}

/** Your avatar: personal preferences, workspace settings (Team is a tab there, CD-223), and signing out. */
function AccountMenu() {
  const { s, session, canEditWorkspace } = useStore();
  const pop = usePopover();
  const name = s.profile.name || session.userName;
  const close = () => pop.setOpen(false);
  return (
    <div ref={pop.ref} className="new-menu">
      <button type="button" className="avatar-btn" data-testid="account-menu" aria-label={`Account · ${name}`} title={name} aria-expanded={pop.open} onClick={() => pop.setOpen(!pop.open)}>
        {initialsOf(name)}
      </button>
      {pop.open && (
        <div className="menu-pop" role="menu" style={{ right: 0, width: 250 }}>
          <div className="caps-muted menu-label">My account</div>
          <NavButton to={paths.profile} label="Personal preferences" onDone={close} />
          <div className="menu-divider" />
          <div className="caps-muted menu-label">Workspace · {session.tenant.name}</div>
          <NavButton to={paths.settings()} label={canEditWorkspace ? 'Workspace settings' : 'Settings'} onDone={close} />
          <div className="menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              session.signOut();
            }}
          >
            <span className="menu-item-title">Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
