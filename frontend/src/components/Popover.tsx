import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placePopover } from './popoverPlace';

/**
 * One floating panel for the app (CD-355): rendered at the top of the page (a portal to `body`),
 * so no dialog, scroll area or animated ancestor can clip or misplace it (the 18 Oct date picker
 * regression), placed by `placePopover` next to `anchor`. It closes on a click outside the panel
 * and the anchor, on Escape, on scrolling anything but the panel, and on a resize. Not a modal:
 * nothing is dimmed and it never stacks another overlay. With `keepOnScroll` (the filter row, CD-366)
 * scrolling doesn't close it: it moves with its anchor.
 */
export function Popover({
  anchor,
  onClose,
  children,
  className,
  label,
  testId,
  keepOnScroll,
}: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label: string;
  testId?: string;
  keepOnScroll?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Measured after the first render (hidden until placed), so the panel's real size decides above or below;
  // placed again whenever that size changes (a list loading, a month with one more week).
  const place = useRef(() => {});
  place.current = () => {
    const a = anchor.current?.getBoundingClientRect();
    const p = panel.current?.getBoundingClientRect();
    if (a && p) setAt(placePopover(a, { width: p.width, height: p.height }, { width: window.innerWidth, height: window.innerHeight }));
  };
  useLayoutEffect(() => {
    place.current();
    const observer = new ResizeObserver(() => place.current());
    if (panel.current) observer.observe(panel.current);
    return () => observer.disconnect();
  }, [anchor]);

  useEffect(() => {
    const inside = (t: EventTarget | null) => !!t && (panel.current?.contains(t as Node) || anchor.current?.contains(t as Node));
    const down = (e: MouseEvent) => !inside(e.target) && close.current();
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      anchor.current?.focus();
      close.current();
    };
    const scroll = (e: Event) => {
      if (panel.current?.contains(e.target as Node)) return;
      if (keepOnScroll) place.current();
      else close.current();
    };
    const resize = () => close.current();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [anchor, keepOnScroll]);

  return createPortal(
    <div
      ref={panel}
      className={'popover' + (className ? ` ${className}` : '')}
      role="dialog"
      aria-label={label}
      data-testid={testId}
      // Hidden by opacity, not visibility, so a field inside can take focus as it mounts (autoFocus).
      style={at ? { top: at.top, left: at.left } : { top: 0, left: 0, opacity: 0, pointerEvents: 'none' }}
    >
      {children}
    </div>,
    document.body,
  );
}
