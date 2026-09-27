import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, type ApiInvitePreview, type ApiMe, crmApi, getTenantId, setTenantId } from '../lib/api';
import { authMode, devLogin, getAccessToken, signIn, signOut } from '../lib/auth';
import { loadWorkspace, type WorkspaceData } from '../store/remote';
import { type Session, StoreProvider } from '../store/store';
import { CURRENCIES } from '../store/seed';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'no-workspace'; me: ApiMe }
  | { kind: 'invite'; me: ApiMe; token: string; preview: ApiInvitePreview | null; problem?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; me: ApiMe; tenantId: string; data: WorkspaceData };

/**
 * An invite link (/invite/<token>) is remembered for this tab, so it survives signing in first
 * (including the redirect to an OIDC provider and back).
 */
const INVITE_KEY = 'crm.inviteToken';
function pendingInvite(): string | null {
  const m = /^\/invite\/([A-Za-z0-9_-]+)$/.exec(window.location.pathname);
  if (m) {
    sessionStorage.setItem(INVITE_KEY, m[1]!);
    window.history.replaceState(null, '', '/');
  }
  return sessionStorage.getItem(INVITE_KEY);
}
const clearInvite = () => sessionStorage.removeItem(INVITE_KEY);

/**
 * Everything before the app itself: sign-in, picking or creating a workspace (tenant) and loading
 * its data. The store is created per workspace, so switching workspaces starts from a clean slate.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const start = useCallback(async (preferTenant?: string) => {
    setPhase({ kind: 'loading' });
    try {
      const invite = pendingInvite();
      if (!(await getAccessToken())) return setPhase({ kind: 'signed-out' });
      const me = await crmApi.me();
      if (invite && !preferTenant) {
        try {
          return setPhase({ kind: 'invite', me, token: invite, preview: await crmApi.previewInvitation(invite) });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) throw err;
          clearInvite();
          return setPhase({ kind: 'invite', me, token: invite, preview: null, problem: err instanceof Error ? err.message : String(err) });
        }
      }
      if (me.tenants.length === 0) return setPhase({ kind: 'no-workspace', me });
      const wanted = preferTenant ?? getTenantId();
      const tenant = me.tenants.find((t) => t.id === wanted) ?? me.tenants[0]!;
      setTenantId(tenant.id);
      setPhase({ kind: 'ready', me, tenantId: tenant.id, data: await loadWorkspace() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await signOut();
        return setPhase({ kind: 'signed-out' });
      }
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const me = phase.kind === 'ready' ? phase.me : null;
  const tenantId = phase.kind === 'ready' ? phase.tenantId : null;
  const session = useMemo<Session | null>(() => {
    const tenant = me?.tenants.find((t) => t.id === tenantId);
    if (!me || !tenant) return null;
    return {
      userId: me.user.id,
      userName: me.user.displayName || me.user.email || 'You',
      email: me.user.email || '',
      tenant,
      tenants: me.tenants,
      switchTenant: (id) => void start(id),
      createTenant: async (name) => {
        const created = await crmApi.createTenant(name);
        await start(created.id);
      },
      signOut: () => void signOut().then(() => setPhase({ kind: 'signed-out' })),
      // Saved renames update the session in place (the store for this workspace stays as it is).
      renameTenant: (name) =>
        setPhase((p) => (p.kind === 'ready' ? { ...p, me: { ...p.me, tenants: p.me.tenants.map((t) => (t.id === p.tenantId ? { ...t, name } : t)) } } : p)),
      renameUser: (name) => setPhase((p) => (p.kind === 'ready' ? { ...p, me: { ...p.me, user: { ...p.me.user, displayName: name } } } : p)),
    };
  }, [me, tenantId, start]);

  if (phase.kind === 'ready' && session)
    return (
      <StoreProvider key={session.tenant.id} data={phase.data} session={session}>
        {children}
      </StoreProvider>
    );
  if (phase.kind === 'signed-out') return <SignIn invited={!!sessionStorage.getItem(INVITE_KEY)} onDone={() => void start()} />;
  if (phase.kind === 'invite')
    return (
      <AcceptInvite
        phase={phase}
        onDone={(tenantId) => {
          clearInvite();
          void start(tenantId);
        }}
      />
    );
  if (phase.kind === 'no-workspace') return <CreateWorkspace me={phase.me} onDone={(id) => void start(id)} />;
  if (phase.kind === 'error')
    return (
      <Centered title="Could not load the workspace" sub={phase.message}>
        <button type="button" className="btn btn-primary" onClick={() => void start()}>
          Try again
        </button>
      </Centered>
    );
  return <Centered title="Loading…" />;
}

function Centered({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--white)', padding: 16 }}>
      <div className="card card-pad" style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: '#101828', color: '#F5F6F8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, fontWeight: 700 }}>C</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</div>
          {sub && <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 4 }}>{sub}</div>}
        </div>
        {children}
        <a href="/privacy.html" style={{ fontSize: 12, color: 'var(--muted-2)', alignSelf: 'center' }}>
          Privacy policy
        </a>
      </div>
    </div>
  );
}

function AcceptInvite({ phase, onDone }: { phase: Extract<Phase, { kind: 'invite' }>; onDone: (tenantId?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { preview, me } = phase;
  const signedInAs = me.user.email ?? me.user.displayName ?? 'you';
  if (!preview)
    return (
      <Centered title="This invite link doesn't work" sub={`${phase.problem ?? 'It may have expired or already been used.'} Ask for a new invitation.`}>
        <button type="button" className="btn btn-primary" onClick={() => onDone()}>
          Continue
        </button>
      </Centered>
    );
  const wrongUser = !!me.user.email && me.user.email.toLowerCase() !== preview.email;
  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      const tenant = await crmApi.acceptInvitation(phase.token);
      onDone(tenant.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Centered
      title={`Join ${preview.tenantName}`}
      sub={`${preview.invitedBy ?? 'A teammate'} invited ${preview.email} to join as ${preview.role === 'admin' ? 'an admin' : 'a member'}.`}
    >
      {wrongUser && (
        <div style={{ fontSize: 12.5, color: '#B42318', lineHeight: 1.5 }}>
          You are signed in as {signedInAs}. Sign out and sign in as {preview.email} to accept.
        </div>
      )}
      {error && <div style={{ fontSize: 12.5, color: '#B42318' }}>{error}</div>}
      <button type="button" className="btn btn-primary" disabled={busy || wrongUser} onClick={() => void accept()}>
        {busy ? 'Joining…' : 'Accept and join'}
      </button>
      {wrongUser ? (
        <button type="button" className="btn btn-secondary" onClick={() => void signOut().then(() => window.location.reload())}>
          Sign out
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            clearInvite();
            onDone();
          }}
        >
          Not now
        </button>
      )}
    </Centered>
  );
}

function SignIn({ onDone, invited }: { onDone: () => void; invited: boolean }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (authMode === 'oidc')
    return (
      <Centered title="Sign in to Cadence" sub={invited ? 'Sign in to accept your invitation.' : "You'll continue with your company's sign-in provider."}>
        <button type="button" className="btn btn-primary" onClick={() => void signIn()}>
          Sign in
        </button>
      </Centered>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await devLogin(email.trim(), name.trim() || email.trim());
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Centered title="Sign in to Cadence" sub={invited ? 'Sign in with the email address the invitation was sent to.' : 'Development sign-in: no password. Any email creates a user.'}>
      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="form-label">
          Email
          <input className="form-input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <label className="form-label">
          Name
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>
        {error && <div style={{ fontSize: 12.5, color: '#B42318' }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Centered>
  );
}

function CreateWorkspace({ me, onDone }: { me: ApiMe; onDone: (tenantId: string) => void }) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const tenant = await crmApi.createTenant(name.trim(), currency);
      onDone(tenant.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <Centered title="Create your workspace" sub={`Signed in as ${me.user.email ?? me.user.displayName ?? 'you'}. A workspace holds your team's pipeline; it starts with two sales funnels you can edit.`}>
      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="form-label">
          Company or team name
          <input className="form-input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cadence Studio" />
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
          <span style={{ fontSize: 12, fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: 'var(--text-2)' }}>Reports add up deals in this currency. Each deal can have its own.</span>
        </label>
        {error && <div style={{ fontSize: 12.5, color: '#B42318' }}>{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
      <button type="button" className="btn btn-secondary" onClick={() => void signOut().then(() => window.location.reload())}>
        Sign out
      </button>
    </Centered>
  );
}
