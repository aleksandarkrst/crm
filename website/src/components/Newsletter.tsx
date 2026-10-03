import { useState, type FormEvent } from 'react';
import { useLang } from '../lang';
import { Button } from './ds';

// Where signups are sent: a POST of { email, lang } as JSON. Not set yet, so the form only shows
// its thank-you message and nothing is stored (see website/README.md).
const NEWSLETTER_URL = import.meta.env.VITE_NEWSLETTER_URL || '';

type Status = 'idle' | 'sending' | 'done' | 'error';

/** The dark newsletter panel at the bottom of the home page, the blog and each article. */
export function Newsletter() {
  const { lang, t } = useLang();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!NEWSLETTER_URL) { setStatus('done'); return; }
    setStatus('sending');
    try {
      const res = await fetch(NEWSLETTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), lang }),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  };

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
                type="email"
                name="email"
                autoComplete="email"
                required
                aria-label={t.nlPlaceholder}
                placeholder={t.nlPlaceholder}
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle'); }}
              />
              <Button type="submit" className="btn-lg btn-lime" disabled={status === 'sending'}>{t.nlCta}</Button>
            </div>
            {status === 'error' && <p className="newsletter-error" role="alert">{t.nlError}</p>}
            <p className="newsletter-note">{t.nlNote}</p>
          </form>
        )}
      </div>
    </section>
  );
}
