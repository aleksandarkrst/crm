import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, type ApiInvitePreview, type ApiMe, crmApi, getTenantId, setTenantId } from '../lib/api';
import { getAccessToken, signOut } from '../lib/auth';
import { loadWorkspace, type WorkspaceData } from '../store/remote';
import { type Session, StoreProvider } from '../store/store';
import { Centered, ForgotPassword, ResetPassword, SignIn, SignUp, VerifySignup } from './AuthScreens';
import { Onboarding } from './Onboarding';
import { SessionEndedDialog } from './SessionEndedDialog';

type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  /** Onboarding after the first sign-up (CD-115), or no workspace left to open. */
  | { kind: 'onboarding'; me: ApiMe }
  | { kind: 'invite'; me: ApiMe; token: string; preview: ApiInvitePreview | null; problem?: string }
  | { kind: 'error'; message: string }
  /** Signed in a new way (e.g. Google) with an email whose account signs in another way (CD-114). */
  | { kind: 'account-exists'; message: string }
  | { kind: 'ready'; me: ApiMe; tenantId: string; data: WorkspaceData };

/**
 * An invite link (/invite/<token>) is remembered for this tab, so it survives signing in first
 * (including the way through Google and back).
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
 * Everything before the app itself: sign-in, onboarding (creating or joining a workspace, CD-115)
 * and loading the workspace's data. The store is created per workspace, so switching workspaces starts from a clean slate.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const { pathname } = useLocation();
  const navigate = useNavigate();

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
      // New users go through onboarding before the app; returning users go straight in.
      if (me.onboarding.required || me.tenants.length === 0) return setPhase({ kind: 'onboarding', me });
      const wanted = preferTenant ?? getTenantId();
      const tenant = me.tenants.find((t) => t.id === wanted) ?? me.tenants[0]!;
      setTenantId(tenant.id);
      setPhase({ kind: 'ready', me, tenantId: tenant.id, data: await loadWorkspace() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await signOut();
        return setPhase({ kind: 'signed-out' });
      }
      if (err instanceof ApiError && err.status === 409 && (err.body as { code?: string } | null)?.code === 'account_exists')
        return setPhase({ kind: 'account-exists', message: err.message });
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

  const openWorkspace = useCallback((id: string) => void start(id), [start]);

  // Emailed links work whoever is signed in here: finishing one signs in its account.
  const signedIn = () => {
    navigate('/', { replace: true });
    void start();
  };
  if (pathname === '/signup/verify') return <VerifySignup onSignedIn={signedIn} />;
  if (pathname === '/reset-password') return <ResetPassword onSignedIn={signedIn} />;
  if (phase.kind === 'ready' && session)
    return (
      <StoreProvider key={session.tenant.id} data={phase.data} session={session}>
        {children}
        <SessionEndedDialog email={session.email} name={session.userName} onSignOut={session.signOut} />
      </StoreProvider>
    );
  if (phase.kind === 'signed-out')
    return pathname === '/signup' ? (
      <SignUp />
    ) : pathname === '/forgot-password' ? (
      <ForgotPassword />
    ) : (
      <SignIn
        invited={!!sessionStorage.getItem(INVITE_KEY)}
        onDone={() => {
          if (pathname === '/login') navigate('/', { replace: true });
          void start();
        }}
      />
    );
  if (phase.kind === 'account-exists')
    return (
      <Centered title="This email already has an account" sub={phase.message}>
        <button type="button" className="btn btn-primary" onClick={() => void signOut().then(() => setPhase({ kind: 'signed-out' }))}>
          Sign out
        </button>
      </Centered>
    );
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
  if (phase.kind === 'onboarding') return <Onboarding me={phase.me} onDone={openWorkspace} />;
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
