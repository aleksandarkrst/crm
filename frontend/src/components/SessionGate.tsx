import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, type ApiMe, crmApi, getTenantId, setTenantId } from '../lib/api';
import { authMode, devLogin, getAccessToken, signIn, signOut } from '../lib/auth';
import { loadWorkspace, type WorkspaceData } from '../store/remote';
import { type Session, StoreProvider } from '../store/store';

type Phase = { kind: 'loading' } | { kind: 'signed-out' } | { kind: 'no-workspace'; me: ApiMe } | { kind: 'error'; message: string } | { kind: 'ready'; me: ApiMe; tenantId: string; data: WorkspaceData };

/**
 * Everything before the app itself: sign-in, picking or creating a workspace (tenant) and loading
 * its data. The store is created per workspace, so switching workspaces starts from a clean slate.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const start = useCallback(async (preferTenant?: string) => {
    setPhase({ kind: 'loading' });
    try {
      if (!(await getAccessToken())) return setPhase({ kind: 'signed-out' });
      const me = await crmApi.me();
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
      userName: me.user.displayName || me.user.email || 'You',
      email: me.user.email || '',
      tenant,
      tenants: me.tenants,
      switchTenant: (id) => void start(id),
      signOut: () => void signOut().then(() => setPhase({ kind: 'signed-out' })),
    };
  }, [me, tenantId, start]);

  if (phase.kind === 'ready' && session)
    return (
      <StoreProvider key={session.tenant.id} data={phase.data} session={session}>
        {children}
      </StoreProvider>
    );
  if (phase.kind === 'signed-out') return <SignIn onDone={() => void start()} />;
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
      </div>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (authMode === 'oidc')
    return (
      <Centered title="Sign in to Cadence" sub="You'll continue with your company's sign-in provider.">
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
    <Centered title="Sign in to Cadence" sub="Development sign-in: no password. Any email creates a user.">
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const tenant = await crmApi.createTenant(name.trim());
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
