import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { SIGN_IN_URL, SIGN_UP_URL } from '../appLinks';
import { useLang } from '../lang';
import { ButtonLink, ChoicePill, Logo } from './ds';

function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-switch">
      <ChoicePill on={lang === 'en'} onClick={() => setLang('en')}>EN</ChoicePill>
      <ChoicePill on={lang === 'sr'} onClick={() => setLang('sr')}>SR</ChoicePill>
    </div>
  );
}

/** Product and Modules are sections of the home page: /#product, /#modules (see ScrollManager). */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useLang();
  return (
    <>
      <Link to="/#product" onClick={onNavigate}>{t.navProduct}</Link>
      <Link to="/#modules" onClick={onNavigate}>{t.navModules}</Link>
      <Link to="/blog" onClick={onNavigate}>{t.navBlog}</Link>
    </>
  );
}

function Header() {
  const { t } = useLang();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [pathname]);
  const close = () => setMenu(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="header-logo"><Logo height={30} /></Link>
        <nav className="main-nav wide-only"><NavLinks /></nav>
        <div style={{ flex: 1 }} />
        <div className="wide-only"><LangSwitch /></div>
        <div className="header-actions">
          <ButtonLink variant="secondary" href={SIGN_IN_URL}>{t.signIn}</ButtonLink>
          <ButtonLink className="wide-only" href={SIGN_UP_URL}>{t.tryCta}</ButtonLink>
          <button type="button" className="menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <span /><span /><span />
          </button>
        </div>
      </div>
      <div className={menu ? 'mobile-menu open' : 'mobile-menu'}>
        <NavLinks onNavigate={close} />
        <div className="mobile-menu-lang">
          <span className="caps">{t.langLabel}</span>
          <LangSwitch />
        </div>
        <ButtonLink className="btn-block" href={SIGN_UP_URL}>{t.tryCta}</ButtonLink>
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useLang();
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <Logo height={30} />
          <div className="footer-tag">{t.footTag}</div>
        </div>
        <div className="footer-col">
          <div className="caps">{t.footProduct}</div>
          <Link to="/#product">{t.navProduct}</Link>
          <Link to="/#modules">{t.navModules}</Link>
          <Link to="/blog">{t.navBlog}</Link>
        </div>
        <div className="footer-col">
          <div className="caps">{t.footAccount}</div>
          <a href={SIGN_IN_URL}>{t.signIn}</a>
          <a href={SIGN_UP_URL}>{t.createAccount}</a>
        </div>
      </div>
      <div className="wrap footer-bottom">© 2026 Pultly</div>
    </footer>
  );
}

/** Every page: header and footer around it. */
export function SiteLayout() {
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
    </>
  );
}

/**
 * On every navigation: scroll to the #section the link names (under the 68px sticky header),
 * otherwise to the top.
 */
export function ScrollManager() {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return; }
    const timer = setTimeout(() => {
      const el = document.getElementById(hash.slice(1));
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 68, behavior: 'smooth' });
    }, 60);
    return () => clearTimeout(timer);
  }, [hash, key]);
  return null;
}
