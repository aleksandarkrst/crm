import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, FormField, Icon, Logo } from '../components/ds';
import { useLang } from '../lang';

// Sign up and sign in are designed screens only: the forms and the Google button aren't
// connected to the app's auth yet (CD-204 follow-up).

function GoogleButton() {
  const { t } = useLang();
  return (
    <Button variant="secondary" className="btn-google">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      <span>{t.google}</span>
    </Button>
  );
}

/** Dark panel with the logo, a title and three points on the left; the form on the right. */
function AuthShell({ title, points, children }: { title: string; points: string[]; children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-aside">
          <Link to="/" aria-label="Pultly home"><Logo height={30} onDark /></Link>
          <div className="auth-aside-title">{title}</div>
          <div className="auth-points">
            {points.map((pt) => <div key={pt} className="auth-point"><i aria-hidden="true">✓</i><span>{pt}</span></div>)}
          </div>
        </div>
        <div className="auth-form">{children}</div>
      </div>
    </main>
  );
}

export function Signup() {
  const { lang, t } = useLang();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); setSent(true); };
  return (
    <AuthShell title={t.suPanelTitle} points={t.suPoints}>
      {sent ? (
        <div className="sent">
          <span className="sent-icon"><Icon name="mail" size={20} /></span>
          <div className="auth-title">{t.sentTitle}</div>
          <div className="sent-body">{t.sentBody.replace('{email}', email || (lang === 'sr' ? 'vašu adresu' : 'your address'))}</div>
          <Link to="/">← {t.backHome}</Link>
        </div>
      ) : (
        <form className="auth-form" style={{ padding: 0 }} onSubmit={submit}>
          <div>
            <div className="auth-title">{t.suTitle}</div>
            <div className="auth-sub">{t.suSub}</div>
          </div>
          <GoogleButton />
          <div className="or-line">{t.orEmail}</div>
          <FormField label={t.fName} name="name" autoComplete="name" placeholder="Ana Petrović" />
          <FormField label={t.fEmail} name="email" type="email" autoComplete="email" placeholder="ana@studio.rs" value={email} onChange={(e) => setEmail(e.target.value)} />
          <FormField label={t.fCompany} name="company" autoComplete="organization" placeholder="Studio Petrović" />
          <FormField label={t.fPassword} name="password" type="password" autoComplete="new-password" placeholder={t.fPasswordPh} />
          <Button type="submit" className="btn-block">{t.createAccount}</Button>
          <div className="legal">{t.legal}</div>
          <div className="switch-auth">{t.haveAccount} <Link to="/signin">{t.signIn}</Link></div>
        </form>
      )}
    </AuthShell>
  );
}

export function Signin() {
  const { t } = useLang();
  return (
    <AuthShell title={t.siPanelTitle} points={t.siPoints}>
      <form className="auth-form" style={{ padding: 0 }} onSubmit={(e) => e.preventDefault()}>
        <div>
          <div className="auth-title">{t.siTitle}</div>
          <div className="auth-sub">{t.siSub}</div>
        </div>
        <GoogleButton />
        <div className="or-line">{t.orEmail}</div>
        <FormField label={t.fEmail} name="email" type="email" autoComplete="email" placeholder="ana@studio.rs" />
        <FormField label={t.fPassword} name="password" type="password" autoComplete="current-password" />
        <div className="forgot"><Link to="/signin">{t.forgot}</Link></div>
        <Button type="submit" className="btn-block">{t.signIn}</Button>
        <div className="switch-auth">{t.noAccount} <Link to="/signup">{t.createOne}</Link></div>
      </form>
    </AuthShell>
  );
}
