import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { GhostSelect } from '../components/ui';
import { Icon, type IconName } from '../components/icons';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { funnelOptions } from '../store/selectors';
import { useStore } from '../store/store';
import type { Profile as ProfileT } from '../store/types';
import { NotificationsTab } from './settings/NotificationsTab';

// Language (en, sr, de) and date format (DD.MM.YYYY, MM/DD/YYYY, YYYY-MM-DD) are still in the
// profile and its API, but aren't shown (CD-223): nothing applies them yet, so offering them would
// promise something the app doesn't do. Bring the two rows back once the app is translated and
// formats dates by them. The start page is in the API too, but everyone lands on Home (CD-288).

/** The pages of your account (CD-525, design G-Profile). The design's Security page is not here: it has nothing the app does yet. */
const PAGES = [
  { k: 'profile', label: 'Profile', icon: 'profile', description: 'Your name, job title and phone. They are yours in every workspace.' },
  { k: 'preferences', label: 'Preferences', icon: 'preferences', description: 'How Pultly works for you. Others keep their own preferences.' },
  { k: 'notifications', label: 'Notifications', icon: 'bell', description: 'The emails you get from this workspace.' },
] as const satisfies readonly { k: string; label: string; icon: IconName; description: string }[];

/** A setting: what it is (and a hint) on the left, its control on the right. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="account-row">
      <div className="account-row-text">
        <span className="account-row-label">{label}</span>
        {hint && <span className="account-row-hint">{hint}</span>}
      </div>
      <div className="account-row-control">{children}</div>
    </div>
  );
}

/**
 * Your account: Profile, Preferences and Notifications, each its own page (`/profile`,
 * `/profile/preferences`, `/profile/notifications`) with the account's sidebar. Every change is
 * saved as you make it; a failed save shows why. Name, job title and phone are yours in every
 * workspace; the default funnel and the notifications apply to the current workspace. Passwords
 * belong to the sign-in provider.
 */
export function Profile() {
  const { page = 'profile' } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { s, session } = useStore();
  const name = s.profile.name || session.userName;
  // A new page starts at the top, like Settings.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  // `/profile#notifications` was the members' notification settings (CD-523): it opens the page now.
  if (page === 'profile' && hash === '#notifications') return <Navigate to={paths.account('notifications')} replace />;
  const current = PAGES.find((p) => p.k === page);
  if (!current) return <Navigate to={paths.profile} replace />;

  return (
    <Screen title="Profile settings">
      <div className="settings-frame">
        <nav className="settings-nav account-nav" aria-label="Your account" data-testid="account-nav">
          <div className="account-nav-head">
            <b>Your account</b>
            <span title={name}>{name}</span>
          </div>
          <div className="settings-nav-group">
            {PAGES.map((p) => (
              <button key={p.k} type="button" className={'settings-nav-item' + (p.k === current.k ? ' on' : '')} aria-current={p.k === current.k ? 'page' : undefined} data-section={p.k} onClick={() => navigate(paths.account(p.k === 'profile' ? undefined : p.k))}>
                <Icon name={p.icon} size={16} />
                {p.label}
              </button>
            ))}
          </div>
          {session.tenants.length > 1 && (
            <div className="account-nav-foot" data-testid="account-workspace">
              <GhostSelect className="form-input" aria-label="Current workspace" value={session.tenant.id} onChange={(e) => session.switchTenant(e.target.value)} options={session.tenants.map((t) => ({ value: t.id, label: t.name }))} chevron />
            </div>
          )}
        </nav>
        <div className="settings-content account-content" data-testid="account-content" data-page={current.k}>
          <div className="account-head">
            <div>
              <h2 className="settings-title">{current.label}</h2>
              <span className="settings-description">{current.description}</span>
            </div>
            <span className="autosave" data-testid="autosave">
              <Icon name="check" size={14} />
              Changes save automatically
            </span>
          </div>
          {current.k === 'profile' && <ProfilePage />}
          {current.k === 'preferences' && <PreferencesPage />}
          {current.k === 'notifications' && <NotificationsTab />}
        </div>
      </div>
    </Screen>
  );
}

function ProfilePage() {
  const { s, patchProfile, session, employeeCard } = useStore();
  const p = s.profile;
  // Your employee record in this workspace (milestone 13): "My employee card".
  const loadMine = employeeCard.loadMyEmployeeId;
  const mine = s.myEmployeeId;
  useEffect(() => {
    if (mine === undefined) void loadMine();
  }, [mine, loadMine]);
  const setP = (k: keyof ProfileT) => (e: React.ChangeEvent<HTMLInputElement>) => patchProfile({ [k]: e.target.value });
  return (
    <>
      <div className="card account-rows">
        <Row label="Full name">
          <input className="form-input" aria-label="Full name" value={p.name} onChange={setP('name')} placeholder="Your name" />
        </Row>
        <Row label="Job title">
          <input className="form-input" aria-label="Job title" value={p.title} onChange={setP('title')} placeholder="e.g. Sales lead" />
        </Row>
        <Row label="Phone">
          <input className="form-input" aria-label="Phone" type="tel" value={p.phone} onChange={setP('phone')} placeholder="+381 …" />
        </Row>
      </div>

      <div className="account-section">Email</div>
      <div className="card account-rows">
        <Row label="Sign-in email" hint="It comes from your sign-in and is changed there, with your password.">
          <span className="account-row-value" data-testid="profile-email">
            {p.email || '—'}
          </span>
        </Row>
      </div>

      {mine && (
        <p className="account-foot">
          Your employee card holds what HR uses in {session.tenant.name}.{' '}
          <Link to={paths.employee(mine)} data-testid="my-employee-card" style={{ color: 'var(--brand)', fontWeight: 600 }}>
            My employee card
          </Link>
        </p>
      )}

      <div className="account-section">Session</div>
      <div className="card account-rows">
        <Row label="Sign out" hint="Signs you out of Pultly in this browser.">
          <button type="button" className="btn btn-secondary" onClick={session.signOut}>
            Sign out
          </button>
        </Row>
      </div>
    </>
  );
}

function PreferencesPage() {
  const { s, patchProfile, session } = useStore();
  const p = s.profile;
  // No default (or one whose funnel was deleted) means the first funnel; say which one that is.
  const funnels = funnelOptions(s);
  const defaultFunnel = s.funnels[p.defaultFunnelId] ? p.defaultFunnelId : '';
  const funnelChoices = [{ value: '', label: `First funnel${funnels[0] ? ` (${funnels[0].label})` : ''}` }, ...funnels];
  return (
    <div className="card account-rows">
      <Row label="Default funnel" hint={`The pipeline opens on it in ${session.tenant.name}.`}>
        <GhostSelect className="form-input" aria-label="Default funnel" value={defaultFunnel} onChange={(e) => patchProfile({ defaultFunnelId: e.target.value })} options={funnelChoices} chevron />
      </Row>
    </div>
  );
}
