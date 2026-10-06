import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const MIN = 0.2;
const MAX = 1.5;
const clamp = (z: number) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));

/**
 * The chart's card (spec 5.3): it scrolls inside itself, never the page; zoom (Fit, 100%, − and +)
 * and pan by dragging the background. The content keeps its natural size and is scaled with a
 * transform; the box around it takes the scaled size, so scrolling covers exactly the chart.
 */
export function ChartFrame({ children, label, focus }: { children: ReactNode; label: string; focus?: { selector: string; key: string; vertical: boolean } }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Brings what matters into view: the top of the tree, or the first search hit (centred).
  const focusKey = focus ? `${focus.key}:${focus.selector}` : '';
  const ready = size.w > 0;
  useEffect(() => {
    const el = outer.current;
    if (!el || !ready || !focus) return;
    const target = el.querySelector(focus.selector);
    if (!target) return;
    const box = el.getBoundingClientRect();
    const at = target.getBoundingClientRect();
    el.scrollLeft += at.left + at.width / 2 - (box.left + box.width / 2);
    if (focus.vertical) el.scrollTop += at.top + at.height / 2 - (box.top + box.height / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per focus key, when the chart has its size
  }, [focusKey, ready]);

  const fit = useCallback(() => {
    const el = outer.current;
    if (!el || !size.w) return;
    setZoom(clamp(Math.min(1, (el.clientWidth - 2) / size.w)));
  }, [size.w]);

  // Dragging the background pans; a press on a person or a button still clicks it.
  const drag = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    const el = outer.current;
    if (!el || e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select, [draggable="true"]')) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId };
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('is-panning');
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = outer.current;
    if (!d || !el || d.id !== e.pointerId) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const endPan = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    drag.current = null;
    outer.current?.releasePointerCapture?.(e.pointerId);
    outer.current?.classList.remove('is-panning');
  };
  useEffect(() => () => void (drag.current = null), []);

  return (
    <div className="org-chart-card card" data-testid="org-chart-frame">
      <div className="org-chart-tools" role="group" aria-label={`${label}: zoom`}>
        <button type="button" className="btn-plain" data-testid="org-zoom-fit" onClick={fit} title="Fit the whole chart in the card">
          Fit
        </button>
        <button type="button" className="btn-plain" data-testid="org-zoom-100" onClick={() => setZoom(1)}>
          100%
        </button>
        <button type="button" className="btn-plain org-zoom-step" aria-label="Zoom out" onClick={() => setZoom((z) => clamp(z - 0.1))}>
          −
        </button>
        <button type="button" className="btn-plain org-zoom-step" aria-label="Zoom in" onClick={() => setZoom((z) => clamp(z + 0.1))}>
          +
        </button>
        <span className="org-zoom-value" data-testid="org-zoom-value">
          {Math.round(zoom * 100)}%
        </span>
      </div>
      <div className="org-chart-frame" ref={outer} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPan} onPointerCancel={endPan}>
        <div className="org-chart-size" style={{ width: size.w * zoom || undefined, height: size.h * zoom || undefined }}>
          <div className="org-chart-content" ref={inner} style={zoom === 1 ? undefined : { transform: `scale(${zoom})` }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
