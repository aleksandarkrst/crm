import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, type SignupOptions, type SignupProblem, signupApi } from '../lib/api';
import { authMode, devLogin, signIn, takeSignInProblem } from '../lib/auth';

/** The card every screen before the app uses: sign-in, creating an account, workspaces, invites. */
export function Centered({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
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

export const Problem = ({ children }: { children: ReactNode }) =>
  children ? (
    <div role="alert" style={{ fontSize: 12.5, color: '#B42318', lineHeight: 1.5 }}>
      {children}
    </div>
  ) : null;

const linkButton: CSSProperties = { background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--brand)', fontSize: 13, fontWeight: 500 };

/** "New to Cadence? Create account" and back: the way between signing in and creating an account. */
function SwitchTo({ question, label, to }: { question: string; label: string; to: string }) {
  const navigate = useNavigate();
  return (
    <div style={{ fontSize: 13, color: 'var(--text-2)', textAlign: 'center' }}>
      {question}{' '}
      <button type="button" style={linkButton} onClick={() => navigate(to)}>
        {label}
      </button>
    </div>
  );
}

function Or() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--muted-2)' }}>
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      or
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function GoogleButton({ connection }: { connection: string }) {
  return (
    <button type="button" className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={() => void signIn({ connection })}>
      <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
        <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
      </svg>
      Continue with Google
    </button>
  );
}

/** What this server offers for creating an account. Until it answers (or if it can't), email only. */
function useSignupOptions(): SignupOptions {
  const [options, setOptions] = useState<SignupOptions>({ email: true, google: null });
  useEffect(() => {
    signupApi
      .options()
      .then(setOptions)
      .catch(() => {});
  }, []);
  return options;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The first screen when signed out (/login and anything else): sign in, or go create an account. */
export function SignIn({ onDone, invited }: { onDone: () => void; invited: boolean }) {
  const options = useSignupOptions();
  const [problem] = useState(takeSignInProblem);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toSignup = <SwitchTo question="New to Cadence?" label="Create account" to="/signup" />;

  if (authMode === 'oidc')
    return (
      <Centered title="Sign in to Cadence" sub={invited ? 'Sign in to accept your invitation.' : 'Welcome back. Sign in with your email and password, or with Google.'}>
        <Problem>{problem}</Problem>
        <button type="button" className="btn btn-primary" onClick={() => void signIn()}>
          Sign in with email
        </button>
        {options.google && <GoogleButton connection={options.google} />}
        {toSignup}
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
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <Centered title="Sign in to Cadence" sub={invited ? 'Sign in with the email address the invitation was sent to.' : 'Development sign-in: no password. Any email creates a user.'}>
      <Problem>{problem}</Problem>
      <form onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="form-label">
          Email
          <input className="form-input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>
        <label className="form-label">
          Name
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>
        <Problem>{error}</Problem>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      {toSignup}
    </Centered>
  );
}

const RESEND_SECONDS = 60;

/**
 * /signup: create an account with Google, or with email: the address first, then a confirmation
 * email whose link leads to choosing a password (VerifySignup). The answer is the same whether or
 * not the address already has an account; the email itself says so.
 */
export function SignUp() {
  const options = useSignupOptions();
  const location = useLocation();
  const [email, setEmail] = useState(() => (location.state as { email?: string } | null)?.email ?? '');
  const [sentTo, setSentTo] = useState('');
  const [wait, setWait] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const send = async (address: string) => {
    setBusy(true);
    setError('');
    try {
      await signupApi.start(address);
      setSentTo(address);
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? 'Too many attempts. Wait a minute, then try again.' : errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo)
    return (
      <Centered title="Check your email" sub={`We sent a link to ${sentTo}. Open it to choose your password and finish creating your account. The link works for 24 hours.`}>
        <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
          Nothing there? Check your spam folder, or send it again. If this address already has an account, the email tells you how to sign in instead.
        </div>
        <Problem>{error}</Problem>
        <button type="button" className="btn btn-secondary" disabled={busy || wait > 0} onClick={() => void send(sentTo)}>
          {busy ? 'Sending…' : wait > 0 ? `Resend email (${wait}s)` : 'Resend email'}
        </button>
        <button
          type="button"
          style={{ ...linkButton, alignSelf: 'center' }}
          onClick={() => {
            setSentTo('');
            setError('');
          }}
        >
          Use a different email
        </button>
        <SwitchTo question="Already have an account?" label="Sign in" to="/login" />
      </Centered>
    );

  return (
    <Centered title="Create your Cadence account" sub="Choose how you'll sign in. You can create or join a workspace next.">
      {options.google && (
        <>
          <GoogleButton connection={options.google} />
          <Or />
        </>
      )}
      {options.email ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(email.trim().toLowerCase());
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <label className="form-label">
            Email
            <input className="form-input" type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </label>
          <Problem>{error}</Problem>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Continue with email'}
          </button>
        </form>
      ) : (
        <Problem>Creating an account with email isn't available yet{options.google ? '. Continue with Google instead.' : '.'}</Problem>
      )}
      <SwitchTo question="Already have an account?" label="Sign in" to="/login" />
    </Centered>
  );
}

const PROBLEM_TITLES: Record<SignupProblem['code'], string> = {
  invalid: "This link doesn't work",
  expired: 'This link has expired',
  used: 'This link was already used',
  exists: 'You already have an account',
};

type Verify =
  | { kind: 'checking' }
  | { kind: 'password'; email: string }
  | { kind: 'signing-in'; email: string }
  | { kind: 'problem'; problem: SignupProblem };

const asProblem = (err: unknown): SignupProblem | null => {
  if (!(err instanceof ApiError) || (err.status !== 410 && err.status !== 409)) return null;
  const body = err.body as Partial<SignupProblem> | null;
  return body?.code ? { code: body.code, message: body.message ?? err.message, email: body.email } : null;
};

const problemOr = (err: unknown): Verify => {
  const problem = asProblem(err);
  return { kind: 'problem', problem: problem ?? { code: 'invalid', message: `${errorText(err)}. Try the link again in a moment.` } };
};

/**
 * /signup/verify#<token>: the link from the confirmation email. Only a working link leads to
 * choosing a password; then the account is created and the user signed in.
 */
export function VerifySignup({ onSignedIn }: { onSignedIn: () => void }) {
  const navigate = useNavigate();
  const [token] = useState(() => window.location.hash.slice(1));
  const [state, setState] = useState<Verify>({ kind: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setState({ kind: 'problem', problem: { code: 'invalid', message: "The link is incomplete. Open it from the email again, or ask for a new one." } });
    signupApi.check(token).then(
      ({ email }) => setState({ kind: 'password', email }),
      (err: unknown) => setState(problemOr(err)),
    );
  }, [token]);

  const finish = async (email: string) => {
    setState({ kind: 'signing-in', email });
    if (authMode === 'oidc') return void signIn({ loginHint: email });
    await devLogin(email, email.split('@')[0]!);
    onSignedIn();
  };

  const submit = async (e: FormEvent, email: string) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError('');
    try {
      await signupApi.complete(token, password);
      await finish(email);
    } catch (err) {
      setBusy(false);
      if (asProblem(err)) return setState(problemOr(err));
      setError(err instanceof ApiError && err.status === 429 ? 'Too many attempts. Wait a minute, then try again.' : errorText(err));
    }
  };

  if (state.kind === 'checking') return <Centered title="Checking your link…" />;
  if (state.kind === 'signing-in')
    return (
      <Centered title="Your account is ready" sub={authMode === 'oidc' ? `Signing you in as ${state.email}. Enter the password you just chose.` : `Signing you in as ${state.email}…`}>
        {authMode === 'oidc' && (
          <button type="button" className="btn btn-primary" onClick={() => void signIn({ loginHint: state.email })}>
            Sign in
          </button>
        )}
      </Centered>
    );
  if (state.kind === 'problem') {
    const { code, message, email } = state.problem;
    const newEmail = code === 'invalid' || code === 'expired';
    return (
      <Centered title={PROBLEM_TITLES[code]} sub={message}>
        {newEmail && (
          <button type="button" className="btn btn-primary" onClick={() => navigate('/signup', { replace: true, state: { email: email ?? '' } })}>
            Send a new email
          </button>
        )}
        <button type="button" className={newEmail ? 'btn btn-secondary' : 'btn btn-primary'} onClick={() => navigate('/login', { replace: true })}>
          Sign in
        </button>
      </Centered>
    );
  }
  const { email } = state;
  return (
    <Centered title="Choose your password" sub={`Email confirmed: ${email}. Choose a password to finish creating your account.`}>
      <form onSubmit={(e) => void submit(e, email)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* For password managers: the account the new password belongs to. */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <label className="form-label">
          Password
          <input className="form-input" type="password" required autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        </label>
        <label className="form-label">
          Confirm password
          <input className="form-input" type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again" />
        </label>
        <Problem>{error}</Problem>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
    </Centered>
  );
}
