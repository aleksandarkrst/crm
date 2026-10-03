import { useEffect, useState, useSyncExternalStore } from 'react';

const reducedQuery = '(prefers-reduced-motion: reduce)';

/** True when the visitor asked the OS for less motion: no rotating word, count-up or tilt then. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(reducedQuery);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(reducedQuery).matches,
  );
}

export function useWindowWidth(): number {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('resize', onChange);
      return () => window.removeEventListener('resize', onChange);
    },
    () => window.innerWidth,
  );
}

/**
 * Fades up every [data-reveal] element once it scrolls into view. Pass whatever changes the
 * rendered list (route, language, filter) so newly rendered elements are picked up too.
 */
export function useReveal(...deps: unknown[]) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.shown)'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('shown'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('shown'); io.unobserve(e.target); }
      }),
      { rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** 0 → 1 with an ease-out over 1.4 s after a 0.5 s pause (the Overview figures count up). */
export function useCountUp(enabled: boolean): number {
  const [p, setP] = useState(enabled ? 0 : 1);
  useEffect(() => {
    if (!enabled) { setP(1); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0 - 500) / 1400);
      setP(1 - Math.pow(1 - Math.max(0, k), 3));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
  return p;
}
