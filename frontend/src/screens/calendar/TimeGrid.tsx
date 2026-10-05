import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiMeeting } from '../../lib/api';
import { addDays, dateLabel, instantToZoned, timeOf, todayIn, zonedToInstant } from '../../store/time';
import { layoutDays, MIN_BLOCK, type Segment } from './layout';
import { blockClass, blockTitle, StatusMark } from './parts';

/** Pixels per hour of the day and week grid. */
export const HOUR = 48;
const PX = HOUR / 60;
const SNAP = 15;
/** 07:00 is at the top when the grid opens; 07:00 to 20:00 fit without scrolling. */
const FIRST_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface Drag {
  id: string;
  mode: 'move' | 'resize';
  day: number;
  /** The segment grabbed (multi-day meetings move by the part that was grabbed). */
  seg: Segment;
  x0: number;
  y0: number;
  colWidth: number;
  dDay: number;
  dMin: number;
  moved: boolean;
}

/**
 * The Day and Week views (CD-130): a 24-hour grid that opens at 07:00, one column per day.
 * Overlapping meetings sit side by side; a meeting across midnight shows on both days. Clicking
 * an empty slot starts a new meeting there (on the half hour). A planned meeting the user may
 * edit can be dragged to another time or day, and its lower edge dragged to change the end, in
 * 15-minute steps.
 */
export function TimeGrid({
  days,
  meetings,
  tz,
  onOpen,
  onCreate,
  canDrag,
  onReschedule,
  onDay,
}: {
  days: string[];
  meetings: ApiMeeting[];
  tz: string;
  onOpen: (id: string) => void;
  onCreate: (startIso: string) => void;
  canDrag: (m: ApiMeeting) => boolean;
  onReschedule: (m: ApiMeeting, startsAt: string, endsAt: string) => void;
  /** Clicking a day's heading (the week view opens that day). */
  onDay?: (date: string) => void;
}) {
  const layout = useMemo(() => layoutDays(days, meetings, tz), [days, meetings, tz]);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const today = todayIn(tz);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = FIRST_HOUR * HOUR;
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const nowZ = instantToZoned(now, tz);

  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const startDrag = (e: React.PointerEvent, seg: Segment, day: number, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const col = (e.currentTarget as HTMLElement).closest('.cal-col') as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    update({ id: seg.m.id, mode, day, seg, x0: e.clientX, y0: e.clientY, colWidth: col?.getBoundingClientRect().width || 1, dDay: 0, dMin: 0, moved: false });
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.y0;
    const dx = e.clientX - d.x0;
    const moved = d.moved || Math.abs(dy) > 4 || Math.abs(dx) > 4;
    const dMin = Math.round((dy / PX) / SNAP) * SNAP;
    const dDay = d.mode === 'move' ? Math.max(-d.day, Math.min(days.length - 1 - d.day, Math.round(dx / d.colWidth))) : 0;
    if (moved !== d.moved || dMin !== d.dMin || dDay !== d.dDay) update({ ...d, moved, dMin, dDay });
  };
  const endDrag = () => {
    const d = dragRef.current;
    update(null);
    if (!d) return;
    if (!d.moved) return onOpen(d.id);
    if (!d.dMin && !d.dDay) return;
    const m = d.seg.m;
    const start = Date.parse(m.startsAt);
    const end = Date.parse(m.endsAt);
    if (d.mode === 'move') {
      const a = instantToZoned(start, tz);
      const minutes = Math.round((a.minutes + d.dMin) / SNAP) * SNAP;
      const next = zonedToInstant(addDays(a.date, d.dDay), minutes, tz);
      onReschedule(m, new Date(next).toISOString(), new Date(next + (end - start)).toISOString());
    } else {
      const b = instantToZoned(end, tz);
      const minutes = Math.round((b.minutes + d.dMin) / SNAP) * SNAP;
      const next = Math.max(start + SNAP * 60_000, zonedToInstant(b.date, minutes, tz));
      onReschedule(m, m.startsAt, new Date(next).toISOString());
    }
  };

  const createAt = (e: React.MouseEvent<HTMLDivElement>, day: string) => {
    if (e.target !== e.currentTarget) return; // a block, not the empty grid
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const minutes = Math.max(0, Math.min(1410, Math.floor(y / PX / 30) * 30));
    onCreate(new Date(zonedToInstant(day, minutes, tz)).toISOString());
  };

  return (
    <div className="cal-grid card" data-testid="time-grid">
      <div className="cal-grid-head" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((d) => (
          <button key={d} type="button" className={d === today ? 'cal-day-head today' : 'cal-day-head'} onClick={onDay ? () => onDay(d) : undefined} disabled={!onDay} data-day-head={d}>
            {dateLabel(d)}
          </button>
        ))}
      </div>
      <div className="cal-grid-scroll" ref={scroller}>
        <div className="cal-grid-body" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR }}>
          <div className="cal-hours" aria-hidden>
            {HOURS.map((h) => (
              <span key={h} style={{ top: h * HOUR }}>
                {h === 0 ? '' : timeOf(h * 60)}
              </span>
            ))}
          </div>
          {days.map((day, i) => (
            <div key={day} className="cal-col" data-day={day} onClick={(e) => createAt(e, day)} title="Click to schedule a meeting">
              {day === today && <span className="cal-now" style={{ top: nowZ.minutes * PX }} aria-hidden />}
              {layout[i]!.map((seg) => {
                const m = seg.m;
                const dragging = drag?.id === m.id;
                const draggable = canDrag(m);
                const top = seg.top * PX;
                const height = Math.max(seg.bottom - seg.top, MIN_BLOCK) * PX - 2;
                const width = 100 / seg.cols;
                return (
                  <div
                    key={m.id}
                    className={blockClass(m, 'cal-block') + (dragging && drag.moved ? ' is-dragging' : '') + (draggable ? ' can-drag' : '')}
                    data-meeting-id={m.id}
                    title={blockTitle(m, tz)}
                    role="button"
                    tabIndex={0}
                    style={{ top, height, left: `calc(${seg.col * width}% + 1px)`, width: `calc(${width}% - 3px)` }}
                    onPointerDown={draggable ? (e) => startDrag(e, seg, i, 'move') : undefined}
                    onPointerMove={draggable ? moveDrag : undefined}
                    onPointerUp={draggable ? endDrag : undefined}
                    onPointerCancel={draggable ? () => update(null) : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!draggable) onOpen(m.id);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(m.id)}
                  >
                    <span className="cal-block-time">
                      <StatusMark m={m} />
                      {seg.fromBefore ? '…' : instantToZoned(m.startsAt, tz).time}
                      {seg.bottom - seg.top >= 45 ? '–' + (seg.toAfter ? '…' : instantToZoned(m.endsAt, tz).time) : ''}
                    </span>
                    <span className="cal-block-title">{m.title}</span>
                    {seg.bottom - seg.top >= 45 && <span className="cal-block-sub">{m.companyName}</span>}
                    {draggable && !seg.toAfter && (
                      <span
                        className="cal-resize"
                        aria-hidden
                        onPointerDown={(e) => startDrag(e, seg, i, 'resize')}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {drag?.moved && <DragGhost drag={drag} days={days} tz={tz} />}
        </div>
      </div>
    </div>
  );
}

/** Where the dragged meeting would go, with its new time. */
function DragGhost({ drag, days, tz }: { drag: Drag; days: string[]; tz: string }) {
  const seg = drag.seg;
  const day = drag.day + drag.dDay;
  const top = drag.mode === 'move' ? seg.top + drag.dMin : seg.top;
  const bottom = Math.max(top + SNAP, drag.mode === 'move' ? seg.bottom + drag.dMin : seg.bottom + drag.dMin);
  const start = Date.parse(seg.m.startsAt);
  const a = instantToZoned(start, tz);
  const startLabel = drag.mode === 'move' ? timeOf(Math.round((a.minutes + drag.dMin) / SNAP) * SNAP) : a.time;
  const endLabel = timeOf(Math.round((instantToZoned(seg.m.endsAt, tz).minutes + drag.dMin) / SNAP) * SNAP);
  return (
    <div
      className={blockClass(seg.m, 'cal-block cal-ghost')}
      aria-hidden
      style={{
        top: top * HOUR / 60,
        height: (bottom - top) * HOUR / 60 - 2,
        left: `calc(52px + (100% - 52px) * ${day} / ${days.length} + 1px)`,
        width: `calc((100% - 52px) / ${days.length} - 3px)`,
      }}
    >
      <span className="cal-block-time">
        {startLabel}–{endLabel}
      </span>
      <span className="cal-block-title">{seg.m.title}</span>
    </div>
  );
}
