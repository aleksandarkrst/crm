import { FieldRow, GhostInput, GhostSelect, Switch } from '../components/ui';
import { Screen } from '../components/Layout';
import { initialsOf } from '../store/selectors';
import { useStore } from '../store/store';
import type { Profile as ProfileT } from '../store/types';

const selectStyle = { width: '100%' } as const;

export function Profile() {
  const { s, set, flash, session } = useStore();
  const p = s.profile;
  const name = p.name || 'Marko Jovanović';
  const title = p.title || 'Sales lead';
  const email = p.email || 'marko@cadence.rs';
  const setP = (k: keyof ProfileT) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const v = e.target.value;
    set((x) => ({ profile: { ...x.profile, [k]: v } }));
  };
  const pwNew = p.pwNew || '';
  const pwReady = !!p.pwCurrent && pwNew.length >= 10 && pwNew === p.pwConfirm;
  const pwHint = !pwNew ? 'At least 10 characters.' : pwNew.length < 10 ? 'New password is too short.' : pwNew !== p.pwConfirm ? 'Passwords do not match.' : 'Ready to update.';
  const digest = p.digest !== false;

  return (
    <Screen title="Profile settings">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <div className="avatar" style={{ width: 48, height: 48, fontSize: 15, fontWeight: 600 }}>
              {initialsOf(name)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                {title} · {email}
              </span>
            </div>
          </div>
          <FieldRow label="Full name">
            <GhostInput value={name} onChange={setP('name')} />
          </FieldRow>
          <FieldRow label="Job title">
            <GhostInput value={title} onChange={setP('title')} />
          </FieldRow>
          <FieldRow label="Email">
            <GhostInput value={email} onChange={setP('email')} />
          </FieldRow>
          <FieldRow label="Phone">
            <GhostInput value={p.phone || '+381 62 114 208'} onChange={setP('phone')} />
          </FieldRow>
        </div>

        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="card-title">Password</div>
          <label className="form-label" style={{ gap: 5 }}>
            Current password
            <input type="password" className="form-input" style={{ padding: '9px 10px', fontSize: 13.5 }} placeholder="••••••••" value={p.pwCurrent || ''} onChange={setP('pwCurrent')} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <label className="form-label" style={{ gap: 5 }}>
              New password
              <input type="password" className="form-input" style={{ padding: '9px 10px', fontSize: 13.5 }} placeholder="At least 10 characters" value={pwNew} onChange={setP('pwNew')} />
            </label>
            <label className="form-label" style={{ gap: 5 }}>
              Confirm new password
              <input type="password" className="form-input" style={{ padding: '9px 10px', fontSize: 13.5 }} placeholder="Repeat new password" value={p.pwConfirm || ''} onChange={setP('pwConfirm')} />
            </label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (!pwReady) return flash('Check the password fields first');
                set((x) => ({ profile: { ...x.profile, pwCurrent: '', pwNew: '', pwConfirm: '' } }));
                flash('Password updated');
              }}
            >
              Update password
            </button>
            <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>{pwHint}</span>
          </div>
        </div>

        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="card-title" style={{ marginBottom: 8 }}>
            Preferences
          </div>
          <FieldRow label="Language">
            <GhostSelect style={selectStyle} value={p.language || 'English'} onChange={setP('language')} options={['English', 'Srpski', 'Deutsch']} />
          </FieldRow>
          <FieldRow label="Date format">
            <GhostSelect style={selectStyle} value={p.dateFormat || 'DD.MM.YYYY'} onChange={setP('dateFormat')} options={['DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']} />
          </FieldRow>
          <FieldRow label="Start page">
            <GhostSelect style={selectStyle} value={p.startPage || 'Pipeline'} onChange={setP('startPage')} options={['Pipeline', 'Overview', 'Today', 'Contacts']} />
          </FieldRow>
          <FieldRow label="Default funnel">
            <GhostSelect style={selectStyle} value={p.defaultFunnel || s.funnels.smb.label} onChange={setP('defaultFunnel')} options={[s.funnels.smb.label, s.funnels.ent.label]} />
          </FieldRow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 0 2px', borderTop: '1px solid var(--divider)', marginTop: 8 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Daily digest email</span>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>One summary of stalled leads and today's tasks, sent at 8:00.</span>
            </div>
            <Switch on={digest} onClick={() => set((x) => ({ profile: { ...x.profile, digest: !(x.profile.digest !== false) } }))} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button type="button" className="btn btn-primary" onClick={() => flash('Profile saved')}>
            Save changes
          </button>
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
