import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { type ApiMe, type ApiPendingInvitation, type ApiUserOnboarding, type ApiUserOnboardingStep, crmApi, getTenantId, setTenantId } from '../lib/api';
import { signOut } from '../lib/auth';
import { CURRENCIES } from '../store/seed';
import { Centered, Problem } from './AuthScreens';

const STEP_LABELS: Record<ApiUserOnboardingStep, string> = { workspace: 'Workspace', profile: 'About you', team: 'Invite your team' };
const hint = { fontSize: 12, fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: 'var(--text-2)' } as const;
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Onboarding after the first sign-up (CD-115), before the app itself:
 *
 * 1. **Workspace**: join the workspace an invitation waits for, or create one (name, main
 *    currency, time zone). An invite link is handled before this screen (AcceptInvite).
 * 2. **About you**: full name (required) and job title (optional).
 * 3. **Invite your team**: owners only; up to ten addresses with a role, or "Skip for now".
 *
 * Each finished step is saved on the server, so a refresh resumes at the next one. Someone who
 * finished onboarding but has no workspace left (they left it) only sees the workspace step.
 */
export function Onboarding({ me: initial, onDone }: { me: ApiMe; onDone: (tenantId: string) => void }) {
  const [me, setMe] = useState(initial);
  const state = me.onboarding;
  // The workspace onboarding continues in: the one just created or joined, else the saved one.
  const tenant = me.tenants.find((t) => t.id === getTenantId()) ?? me.tenants.find((t) => t.role === 'owner') ?? me.tenants[0] ?? null;
  const steps = state.required ? state.steps : [{ key: 'workspace' as const, done: false, skippable: false }];
  const current = steps.find((s) => !s.done)?.key ?? null;

  const refresh = async (next?: ApiUserOnboarding) => {
    const fresh = next ? { ...me, onboarding: next } : await crmApi.me();
    const t = fresh.tenants.find((x) => x.id === getTenantId()) ?? fresh.tenants[0];
    if (!fresh.onboarding.required && t) return onDone(t.id);
    setMe(fresh);
  };
  const joined = async (tenantId: string) => {
    setTenantId(tenantId);
    if (!state.required) return onDone(tenantId);
    await refresh();
  };

  // Every step done (the server marks the user onboarded with the last one): on to the app.
  const finished = !current && tenant ? tenant.id : null;
  useEffect(() => {
    if (finished) onDone(finished);
  }, [finished, onDone]);
  if (finished) return <Centered title="Loading…" />;

  const progress = <Progress steps={steps} current={current ?? 'workspace'} />;
  if (current === 'workspace' || !tenant) return <WorkspaceStep me={me} invitations={state.invitations} progress={progress} onDone={joined} />;
  if (current === 'profile') return <ProfileStep me={me} workspace={tenant.name} progress={progress} onDone={refresh} />;
  return <TeamStep workspace={tenant.name} progress={progress} onDone={refresh} />;
}

function Progress({ steps, current }: { steps: { key: ApiUserOnboardingStep }[]; current: ApiUserOnboardingStep }) {
  if (steps.length < 2) return null;
  const at = steps.findIndex((s) => s.key === current);
  return (
    <div className="onboarding-progress" data-testid="onboarding-progress">
      <span>
        Step {at + 1} of {steps.length} · {STEP_LABELS[current]}
      </span>
      <ol aria-hidden="true">
        {steps.map((s, i) => (
          <li key={s.key} className={i < at ? 'done' : i === at ? 'current' : ''} />
        ))}
      </ol>
    </div>
  );
}

function SignOutButton() {
  return (
    <button type="button" className="btn btn-secondary" onClick={() => void signOut().then(() => window.location.reload())}>
      Sign out
    </button>
  );
}

function WorkspaceStep({ me, invitations, progress, onDone }: { me: ApiMe; invitations: ApiPendingInvitation[]; progress: ReactNode; onDone: (tenantId: string) => Promise<void> }) {
  const [creating, setCreating] = useState(invitations.length === 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const signedInAs = me.user.email ?? me.user.displayName ?? 'you';

  if (!creating) {
    const join = async (id: string) => {
      setBusy(id);
      setError('');
      try {
        const tenant = await crmApi.acceptPendingInvitation(id);
        await onDone(tenant.id);
      } catch (err) {
        setError(errText(err));
        setBusy(null);
      }
    };
    return (
      <Centered title={invitations.length === 1 ? `Join ${invitations[0]!.tenantName}` : 'Join your team'} sub={`You are signed in as ${signedInAs}, and a workspace is waiting for you.`}>
        {progress}
        <ul className="onboarding-invites">
          {invitations.map((inv) => (
            <li key={inv.id}>
              <div>
                <strong>{inv.tenantName}</strong>
                <span>
                  {inv.invitedBy ?? 'A teammate'} invited you as {inv.role === 'admin' ? 'an admin' : 'a member'}
                </span>
              </div>
              <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void join(inv.id)}>
                {busy === inv.id ? 'Joining…' : 'Accept and join'}
              </button>
            </li>
          ))}
        </ul>
        <Problem>{error}</Problem>
        <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setCreating(true)}>
          Create a new workspace instead
        </button>
      </Centered>
    );
  }
  return <CreateWorkspace signedInAs={signedInAs} invited={invitations.length > 0} progress={progress} onBack={() => setCreating(false)} onDone={onDone} />;
}

function CreateWorkspace({
  signedInAs,
  invited,
  progress,
  onBack,
  onDone,
}: {
  signedInAs: string;
  invited: boolean;
  progress: ReactNode;
  onBack: () => void;
  onDone: (tenantId: string) => Promise<void>;
}) {
  const zones = useMemo(() => {
    const all = Intl.supportedValuesOf('timeZone');
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return { own: own && all.includes(own) ? own : 'Europe/Belgrade', all };
  }, []);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [timezone, setTimezone] = useState(zones.own);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const tenant = await crmApi.createTenant(name.trim(), currency, timezone);
      await onDone(tenant.id);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  return (
    <Centered title="Create your workspace" sub={`Signed in as ${signedInAs}. A workspace holds your team's pipeline; it starts with two sales funnels you can edit.`}>
      {progress}
      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="form-label">
          Company or team name
          <input className="form-input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pultly Studio" maxLength={100} />
        </label>
        <label className="form-label">
          Main currency
          <select className="form-input" aria-label="Main currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <span style={hint}>Reports add up deals in this currency. Each deal can have its own.</span>
        </label>
        <label className="form-label">
          Time zone
          <select className="form-input" aria-label="Time zone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.all.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <span style={hint}>For due dates and the daily digest. You can change both in Settings.</span>
        </label>
        <Problem>{error}</Problem>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
      {invited ? (
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          Back to my invitation
        </button>
      ) : (
        <SignOutButton />
      )}
    </Centered>
  );
}

function ProfileStep({ me, workspace, progress, onDone }: { me: ApiMe; workspace: string; progress: ReactNode; onDone: (next: ApiUserOnboarding) => Promise<void> }) {
  // A name the sign-in didn't have is often the email address itself: don't offer that as the name.
  const known = me.user.displayName && me.user.displayName !== me.user.email ? me.user.displayName : '';
  const [name, setName] = useState(known);
  const [jobTitle, setJobTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onDone(await crmApi.saveOnboardingProfile(name.trim(), jobTitle.trim()));
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  return (
    <Centered title="About you" sub={`This is how your colleagues in ${workspace} see you on deals, tasks and emails.`}>
      {progress}
      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="form-label">
          Full name
          <input className="form-input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ana Petrović" maxLength={100} />
        </label>
        <label className="form-label">
          Job title <span style={hint}>(optional)</span>
          <input className="form-input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Account executive" maxLength={100} />
        </label>
        <Problem>{error}</Problem>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </Centered>
  );
}

const MAX_INVITES = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Row = { email: string; role: 'member' | 'admin'; error?: string };

function TeamStep({ workspace, progress, onDone }: { workspace: string; progress: ReactNode; onDone: (next: ApiUserOnboarding) => Promise<void> }) {
  const [rows, setRows] = useState<Row[]>([
    { email: '', role: 'member' },
    { email: '', role: 'member' },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const filled = rows.filter((r) => r.email.trim());
  const invalid = filled.some((r) => !EMAIL.test(r.email.trim()));
  const edit = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch, error: undefined } : r)));

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await onDone(await crmApi.finishOnboardingTeam());
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    // One at a time; a row that fails stays with its reason, the ones that went out are removed.
    const left: Row[] = [];
    for (const r of rows) {
      if (!r.email.trim()) continue;
      try {
        await crmApi.invite(r.email.trim(), r.role);
      } catch (err) {
        left.push({ ...r, error: errText(err) });
      }
    }
    if (left.length === 0) return finish();
    setRows(left);
    setBusy(false);
  };
  return (
    <Centered title="Invite your team" sub={`Pultly works best with the people you sell with. Each one gets an email with a link to join ${workspace}.`}>
      {progress}
      <form onSubmit={(e) => void send(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                type="email"
                aria-label={`Email ${i + 1}`}
                value={r.email}
                onChange={(e) => edit(i, { email: e.target.value })}
                placeholder="colleague@company.com"
                style={{ flex: 1, minWidth: 0 }}
              />
              <select className="form-input" aria-label={`Role ${i + 1}`} value={r.role} onChange={(e) => edit(i, { role: e.target.value as Row['role'] })} style={{ width: 'auto' }}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Problem>{r.error}</Problem>
          </div>
        ))}
        {rows.length < MAX_INVITES && (
          <button type="button" className="onboarding-add" onClick={() => setRows([...rows, { email: '', role: 'member' }])}>
            + Add another
          </button>
        )}
        <span style={hint}>Admins can also change the funnels, templates and settings. You can invite more people later in Settings → Team.</span>
        <Problem>{error || (invalid ? 'Check the email addresses.' : '')}</Problem>
        <button type="submit" className="btn btn-primary" disabled={busy || filled.length === 0 || invalid}>
          {busy ? 'Sending…' : filled.length > 1 ? `Send ${filled.length} invitations` : 'Send invitation'}
        </button>
      </form>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void finish()}>
        Skip for now
      </button>
    </Centered>
  );
}
