import { useEffect } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { type IconName } from '../components/icons';
import { enabledModules } from '../components/modules';
import { nameProblem, phoneProblem } from '../lib/account';
import { paths } from '../lib/paths';
import { funnelOptions } from '../store/selectors';
import { useStore } from '../store/store';
import { NotificationsTab } from './settings/NotificationsTab';
import { Card, Dropdown, Row, TextField } from './settings/parts';
import { GlassShell, NavRow } from './settings/Shell';

// Language (en, sr, de) and date format (DD.MM.YYYY, MM/DD/YYYY, YYYY-MM-DD) are still in the
// profile and its API, but aren't shown (CD-223): nothing applies them yet, so offering them would
// promise something the app doesn't do. Bring the two rows back once the app is translated and
// formats dates by them. The start page is in the API too, but everyone lands on Home (CD-288).

/** The pages of your account (CD-525 spec 1, design G-Profile). The design's Security page is not here: it has nothing the app does yet. */
const PAGES = [
  { k: 'profile', label: 'Profile', icon: 'profile', description: 'How you show up for the people you work with.' },
  { k: 'preferences', label: 'Preferences', icon: 'preferences', description: 'How Pultly works for you. Others keep their own preferences.' },
  { k: 'notifications', label: 'Notifications', icon: 'bell', description: 'The emails you get from this workspace.' },
] as const satisfies readonly { k: string; label: string; icon: IconName; description: string }[];

/**
 * Your account: Profile, Preferences and Notifications, each its own page (`/profile`,
 * `/profile/preferences`, `/profile/notifications`) in the same glass shell as Workspace settings
 * (CD-525 spec, CD-524), without the search box. Every change saves on its own and says so in a
 * toast; a failed save says "Could not save. Try again." and the saved value comes back. Name, job
 * title and phone are yours in every workspace; the default funnel and the notifications apply to
 * the current workspace. Passwords belong to the sign-in provider.
 */
export function Profile() {
  const { page = 'profile' } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { s, session, settingsToasts } = useStore();
  const name = s.profile.name || session.userName;
  // A new page starts at the top, like Settings.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  // Every save says so in the settings toast, as in Workspace settings (CD-525 spec 5).
  useEffect(() => {
    settingsToasts(true);
    return () => settingsToasts(false);
  }, [settingsToasts]);
  // `/profile#notifications` was the members' notification settings (CD-523): it opens the page now.
  if (page === 'profile' && hash === '#notifications') return <Navigate to={paths.account('notifications')} replace />;
  const current = PAGES.find((p) => p.k === page);
  if (!current) return <Navigate to={paths.profile} replace />;

  return (
    <GlassShell
      label="Your account"
      testId="account-nav"
      head={
        <span className="gs-side-who">
          <b>Your account</b>
          <span title={name} data-testid="account-name">
            {name}
          </span>
        </span>
      }
      nav={PAGES.map((p) => (
        <NavRow key={p.k} k={p.k} label={p.label} icon={p.icon} on={p.k === current.k} onClick={() => navigate(paths.account(p.k === 'profile' ? undefined : p.k))} />
      ))}
      title={current.label}
      search={false}
    >
      <div className="gs-page gs-account" data-testid="account-content" data-page={current.k}>
        <p className="gs-lede">{current.description}</p>
        {current.k === 'profile' && <ProfilePage />}
        {current.k === 'preferences' && <PreferencesPage />}
        {current.k === 'notifications' && <NotificationsTab />}
      </div>
    </GlassShell>
  );
}

/**
 * Full name, job title and phone save when they are left or on Enter. An empty name or a phone
 * with anything but digits, spaces, parentheses and a leading + shows why under the field and isn't
 * saved; leaving the page puts the saved value back.
 */
function ProfilePage() {
  const { s, patchProfile } = useStore();
  const p = s.profile;
  return (
    <Card testId="profile-card">
      <Row label="Full name">
        <TextField label="Full name" value={p.name} validate={nameProblem} onSave={(v) => patchProfile({ name: v.trim() })} placeholder="Your name" width={280} testId="profile-name" />
      </Row>
      <Row label="Job title">
        <TextField label="Job title" value={p.title} onSave={(v) => patchProfile({ title: v })} placeholder="e.g. Sales lead" width={280} testId="profile-title" />
      </Row>
      <Row label="Phone">
        <TextField label="Phone" value={p.phone} validate={phoneProblem} onSave={(v) => patchProfile({ phone: v })} placeholder="+381 60 123 4567" type="tel" width={280} testId="profile-phone" />
      </Row>
      <Row label="Sign-in email" desc="Used to sign in and for every email Pultly sends you.">
        <span className="gs-ro" data-testid="profile-email">
          {p.email || '—'}
        </span>
      </Row>
    </Card>
  );
}

/** The default funnel; with CRM off in the workspace the row stays, disabled (CD-524's rule for modules that are off). */
function PreferencesPage() {
  const { s, patchProfile } = useStore();
  const p = s.profile;
  const crmOff = !enabledModules(s.workspace.modules).includes('crm');
  // No default (or one whose funnel was deleted) means the first funnel; say which one that is.
  const funnels = funnelOptions(s);
  const defaultFunnel = s.funnels[p.defaultFunnelId] ? p.defaultFunnelId : '';
  const funnelChoices = [{ value: '', label: `First funnel${funnels[0] ? ` (${funnels[0].label})` : ''}` }, ...funnels];
  return (
    <Card testId="preferences-card">
      <Row label="Default funnel" desc={crmOff ? 'CRM is off in this workspace.' : 'The funnel new opportunities start in when you create them.'} dim={crmOff} data={crmOff ? { 'data-off': 'true' } : undefined}>
        <Dropdown label="Default funnel" value={defaultFunnel} options={funnelChoices} onChange={(v) => patchProfile({ defaultFunnelId: v })} width={260} disabled={crmOff} testId="default-funnel" />
      </Row>
    </Card>
  );
}
