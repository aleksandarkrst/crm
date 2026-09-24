import { FieldRow, GhostInput, GhostSelect, Switch } from '../components/ui';
import { Screen } from '../components/Layout';
import { funnelOptions, initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import type { Profile as ProfileT } from '../store/types';

const selectStyle = { width: '100%' } as const;
const note = { fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 } as const;

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'sr', label: 'Srpski' },
  { value: 'de', label: 'Deutsch' },
];
const DATE_FORMATS = ['DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const START_PAGES = [
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'overview', label: 'Overview' },
  { value: 'today', label: 'Today' },
  { value: 'contacts', label: 'Contacts' },
];

/**
 * Your own profile. Every change is saved as you make it; a failed save shows why. Name, job
 * title, phone and the preferences are yours in every workspace; the default funnel and the
 * digest apply to the current workspace. Passwords belong to the sign-in provider.
 */
export function Profile() {
  const { s, patchProfile, session } = useStore();
  const p = s.profile;
  const setP = (k: keyof ProfileT) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => patchProfile({ [k]: e.target.value });
  const funnels = funnelOptions(s);

  return (
    <Screen title="Profile settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <div className="avatar" style={{ width: 48, height: 48, fontSize: 15, fontWeight: 600 }}>
              {initialsOf(p.name || session.userName)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name || session.userName}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{[p.title, p.email].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          <FieldRow label="Full name">
            <GhostInput value={p.name} onChange={setP('name')} placeholder="Your name" />
          </FieldRow>
          <FieldRow label="Job title">
            <GhostInput value={p.title} onChange={setP('title')} placeholder="e.g. Sales lead" />
          </FieldRow>
          <FieldRow label="Email">
            <span className="field-value" title="Your email comes from your sign-in and is changed there.">
              {p.email || '—'}
            </span>
          </FieldRow>
          <FieldRow label="Phone">
            <GhostInput value={p.phone} onChange={setP('phone')} placeholder="+381 …" />
          </FieldRow>
          <span style={{ ...note, marginTop: 8 }}>Changes are saved as you type. Your email and password are managed by your sign-in provider.</span>
        </div>

        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            Preferences
          </div>
          <FieldRow label="Language">
            <GhostSelect style={selectStyle} value={p.language} onChange={setP('language')} options={LANGUAGES} />
          </FieldRow>
          <FieldRow label="Date format">
            <GhostSelect style={selectStyle} value={p.dateFormat} onChange={setP('dateFormat')} options={DATE_FORMATS} />
          </FieldRow>
          <span style={{ ...note, margin: '2px 0 6px' }}>Language and date format are saved for later: the app is in English with its own date style for now.</span>
          <FieldRow label="Start page">
            <GhostSelect style={selectStyle} value={p.startPage} onChange={setP('startPage')} options={START_PAGES} />
          </FieldRow>
          <FieldRow label="Default funnel">
            <GhostSelect style={selectStyle} value={p.defaultFunnelId} onChange={setP('defaultFunnelId')} options={funnels} />
          </FieldRow>
          <span style={{ ...note, margin: '2px 0 0' }}>The pipeline opens on your default funnel in {session.tenant.name}.</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 2px', borderTop: '1px solid var(--divider)', marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Daily digest email</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Every morning: your overdue tasks, tasks due today and deals with no next step in {session.tenant.name}. More in Settings → Notifications.</span>
            </div>
            <Switch on={p.digest} onClick={() => patchProfile({ digest: !p.digest })} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn btn-secondary" onClick={session.signOut}>
            Sign out
          </button>
        </div>

        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Workspace</span>
          <FieldRow label="Current">
            {session.tenants.length > 1 ? (
              <GhostSelect style={selectStyle} value={session.tenant.id} onChange={(e) => session.switchTenant(e.target.value)} options={session.tenants.map((t) => ({ value: t.id, label: t.name }))} />
            ) : (
              <span className="field-value">{session.tenant.name}</span>
            )}
          </FieldRow>
          <FieldRow label="Your role">
            <span className="field-value" style={{ textTransform: 'capitalize' }}>
              {session.tenant.role}
            </span>
          </FieldRow>
        </div>
      </div>
    </Screen>
  );
}
