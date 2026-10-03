import { useState, type FormEvent } from 'react';
import { useLang } from '../lang';
import { Button } from './ds';

// Signups go to a MailerLite embedded form (Forms → Embedded forms in MailerLite), which adds
// people to its group and sends the confirmation email (double opt-in is set on the form). Both IDs
// are in the form's embed code: .../jsonp/<account id>/forms/<form id>/subscribe. They are public.
// Without them, the form only shows its thank-you message and nothing is stored.
const ACCOUNT_ID = import.meta.env.VITE_MAILERLITE_ACCOUNT_ID || '';
const FORM_ID = import.meta.env.VITE_MAILERLITE_FORM_ID || '';
const SUBSCRIBE_URL = ACCOUNT_ID && FORM_ID
  ? `https://assets.mailerlite.com/jsonp/${ACCOUNT_ID}/forms/${FORM_ID}/subscribe`
  : '';

type Status = 'idle' | 'sending' | 'done' | 'error';

/** The dark newsletter panel at the bottom of the home page, the blog and each article. */
export function Newsletter() {
  const { t } = useLang();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!SUBSCRIBE_URL) { setStatus('done'); return; }
    setStatus('sending');
    try {
      // The same fields MailerLite's own embed script sends.
      const body = new URLSearchParams({ 'fields[name]': name.trim(), 'fields[email]': email.trim(), 'ml-submit': '1', anticsrf: 'true' });
      const res = await fetch(SUBSCRIBE_URL, { method: 'POST', body });
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
      setStatus(res.ok && data?.success ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  };

  const edit = (set: (v: string) => void) => (v: string) => { set(v); if (status === 'error') setStatus('idle'); };

  return (
    <section className="section" style={{ paddingTop: 0 }}>
      <div className="wrap cta-panel" data-reveal>
        <div>
          <h2>{t.nlTitle}</h2>
          <p>{t.nlSub}</p>
        </div>
        {status === 'done' ? (
          <p className="newsletter-done" role="status">{t.nlDone}</p>
        ) : (
          <form className="newsletter-form" onSubmit={submit}>
            <div className="newsletter-row">
              <input
                className="newsletter-input"
                type="text"
                name="name"
                autoComplete="name"
                required
                aria-label={t.nlName}
                placeholder={t.nlName}
                value={name}
                onChange={(e) => edit(setName)(e.target.value)}
              />
              <input
                className="newsletter-input"
                type="email"
                name="email"
                autoComplete="email"
                required
                aria-label={t.nlPlaceholder}
                placeholder={t.nlPlaceholder}
                value={email}
                onChange={(e) => edit(setEmail)(e.target.value)}
              />
            </div>
            <Button type="submit" className="btn-lg btn-lime" disabled={status === 'sending'}>{t.nlCta}</Button>
            {status === 'error' && <p className="newsletter-error" role="alert">{t.nlError}</p>}
            <p className="newsletter-note">{t.nlNote}</p>
          </form>
        )}
      </div>
    </section>
  );
}
