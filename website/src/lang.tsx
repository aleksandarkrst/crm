import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { COPY, type Copy, type Lang } from './content/copy';

const STORAGE_KEY = 'pultly.site.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'sr') return saved;
  } catch {
    // Storage blocked: fall back to the default.
  }
  return 'en';
}

interface LangValue { lang: Lang; t: Copy; setLang: (lang: Lang) => void }

const LangContext = createContext<LangValue | null>(null);

/** English by default; the choice is remembered in this browser. */
export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((next: Lang) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* not remembered, still switched */ }
    setLangState(next);
  }, []);
  useEffect(() => { document.documentElement.lang = lang === 'sr' ? 'sr-Latn' : 'en'; }, [lang]);
  const value = useMemo(() => ({ lang, t: COPY[lang], setLang }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangValue {
  const value = useContext(LangContext);
  if (!value) throw new Error('useLang outside LangProvider');
  return value;
}
