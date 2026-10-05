import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiMeeting, MeetingType } from '../../lib/api';
import { addDays, dateLabel, instantToZoned, timeOf, todayIn, zonedToInstant } from '../../store/time';
import { layoutDays, MIN_BLOCK, type Segment } from './layout';
import { blockClass, blockTitle, StatusMark } from './parts';

/** Pixels per hour of the day and week grid. */
export const HOUR = 48;
const PX = HOUR / 60;
const SNAP = 15;
const MINUTE = 60_000;
/** 07:00 is at the top when the grid opens; 07:00 to 20:00 fit without scrolling. */
const FIRST_HOUR = 7;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** A press that moves less than this (px) is a click. */
const CLICK = 4;

/**
 * A meeting being made on the calendar (CD-212): the placeholder block on the grid (or the day
 * in the month) and the quick-create popover next to it. `anchor` is the selector of the element
 * the popover sits next to.
 */
export interface CalendarDraft {
  start: number;
  end: number;
  anchor: string;
  /** What the popover has so far, shown on the placeholder. */
  title?: string;
  type?: MeetingType;
}
/** The placeholder block on the time grid. */
export const DRAFT_ANCHOR = '[data-testid=cal-draft]';

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

/** Dragging over empty slots to make a meeting (CD-212): from the slot pressed to the pointer, in 15-minute steps. */
interface Making {
  day: number;
  y0: number;
  /** The minute of the day pressed. */
  at: number;
  start: number;
  end: number;
  moved: boolean;
  /** A meeting was being made when this press began: a click only closes it (as in Google Calendar). */
  closing: boolean;
}

/** Moving or resizing the placeholder. */
interface Adjust {
  mode: 'move' | 'resize';
  x0: number;
  y0: number;
  colWidth: number;
  /** The placeholder when grabbed. */
  from: CalendarDraft;
  /** Its column then. */
  day: number;
  maxDay: number;
}

const clampMinute = (m: number) => Math.max(0, Math.min(1440, m));

/**
 * The Day and Week views (CD-130): a 24-hour grid that opens at 07:00, one column per day.
 * Overlapping meetings sit side by side; a meeting across midnight shows on both days.
 *
 * Making a meeting (CD-212, like Google Calendar): pressing an empty slot and dragging draws a
 * placeholder in 15-minute steps; a click makes an hour from the half hour clicked. The
 * placeholder can then be moved and its lower edge dragged, and the quick-create popover opens
 * next to it (`onDraft`; the Calendar owns it). Without `onDraft` (phones) a click opens the
 * New meeting dialog (`onCreate`).
 *
 * A planned meeting the user may edit can be dragged to another time or day, and its lower edge
 * dragged to change the end, in 15-minute steps.
 */
export function TimeGrid({
  days,
  meetings,
  tz,
  onOpen,
  onCreate,
  draft,
  onDraft,
  justClosed,
  canDrag,
  onReschedule,
  onDay,
}: {
  days: string[];
  meetings: ApiMeeting[];
  tz: string;
  onOpen: (id: string) => void;
  onCreate: (startIso: string) => void;
  /** The meeting being made, and its changes; without onDraft a click calls onCreate. */
  draft?: CalendarDraft | null;
  onDraft?: (draft: CalendarDraft | null) => void;
  /** Whether a press just closed the quick-create popover (then a click only closes it). */
  justClosed?: () => boolean;
  canDrag: (m: ApiMeeting) => boolean;
  onReschedule: (m: ApiMeeting, startsAt: string, endsAt: string) => void;
  /** Clicking a day's heading (the week view opens that day). */
  onDay?: (date: string) => void;
}) {
  const layout = useMemo(() => layoutDays(days, meetings, tz), [days, meetings, tz]);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [making, setMaking] = useState<Making | null>(null);
  const makingRef = useRef<Making | null>(null);
  const adjustRef = useRef<Adjust | null>(null);
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

  // ------------------------------------------------------------ moving and resizing meetings
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const startDrag = (e: React.PointerEvent, seg: Segment, day: number, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // No text selection or native drag while the pointer moves the block.
    e.preventDefault();
    const col = (e.currentTarget as HTMLElement).closest('.cal-col') as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    update({ id: seg.m.id, mode, day, seg, x0: e.clientX, y0: e.clientY, colWidth: col?.getBoundingClientRect().width || 1, dDay: 0, dMin: 0, moved: false });
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.y0;
    const dx = e.clientX - d.x0;
    const moved = d.moved || Math.abs(dy) > CLICK || Math.abs(dx) > CLICK;
    const dMin = Math.round(dy / PX / SNAP) * SNAP;
    const dDay = d.mode === 'move' ? Math.max(-d.day, Math.min(days.length - 1 - d.day, Math.round(dx / d.colWidth))) : 0;
    if (moved !== d.moved || dMin !== d.dMin || dDay !== d.dDay) update({ ...d, moved, dMin, dDay });
  };
  const endDrag = () => {
    const d = dragRef.current;
    update(null);
    if (!d) return;
    // A click opens the meeting; a click on its lower edge does nothing.
    if (!d.moved) return d.mode === 'move' ? onOpen(d.id) : undefined;
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
      const next = Math.max(start + SNAP * MINUTE, zonedToInstant(b.date, minutes, tz));
      onReschedule(m, m.startsAt, new Date(next).toISOString());
    }
  };

  // ------------------------------------------------------------ making a meeting (CD-212)
  const setMake = (m: Making | null) => {
    makingRef.current = m;
    setMaking(m);
  };
  /** The minute of the day under the pointer in this column. */
  const minuteAt = (e: React.PointerEvent | React.MouseEvent, col: HTMLElement) => clampMinute((e.clientY - col.getBoundingClientRect().top) / PX);
  const startMaking = (e: React.PointerEvent<HTMLDivElement>, day: number) => {
    if (!onDraft || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.cal-block')) return; // a meeting or the placeholder
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = Math.min(1439, minuteAt(e, e.currentTarget));
    const start = Math.floor(at / SNAP) * SNAP;
    setMake({ day, y0: e.clientY, at, start, end: start + SNAP, moved: false, closing: !!draft || !!justClosed?.() });
  };
  const moveMaking = (e: React.PointerEvent<HTMLDivElement>) => {
    const m = makingRef.current;
    if (!m) return;
    const moved = m.moved || Math.abs(e.clientY - m.y0) > CLICK;
    if (!moved) return;
    // From the slot pressed to the slot under the pointer, either way.
    const pressed = Math.floor(m.at / SNAP) * SNAP;
    const to = Math.round(minuteAt(e, e.currentTarget) / SNAP) * SNAP;
    const start = Math.min(pressed, to);
    const end = Math.max(pressed + SNAP, to, start + SNAP);
    if (moved !== m.moved || start !== m.start || end !== m.end) setMake({ ...m, moved, start, end });
  };
  const endMaking = () => {
    const m = makingRef.current;
    setMake(null);
    if (!m || !onDraft || (m.closing && !m.moved)) return;
    // A click: an hour from the half hour clicked.
    const start = m.moved ? m.start : Math.floor(m.at / 30) * 30;
    const end = m.moved ? m.end : start + 60;
    const day = days[m.day]!;
    onDraft({ start: zonedToInstant(day, start, tz), end: zonedToInstant(day, end, tz), anchor: DRAFT_ANCHOR });
  };

  // The placeholder: moved like a meeting, its lower edge dragged; the popover follows.
  const draftZ = draft ? instantToZoned(draft.start, tz) : null;
  const draftDay = draftZ ? days.indexOf(draftZ.date) : -1;
  const startAdjust = (e: React.PointerEvent, mode: Adjust['mode']) => {
    if (!draft || !onDraft || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const col = (e.currentTarget as HTMLElement).closest('.cal-col') as HTMLElement | null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    adjustRef.current = { mode, x0: e.clientX, y0: e.clientY, colWidth: col?.getBoundingClientRect().width || 1, from: draft, day: draftDay, maxDay: days.length - 1 };
  };
  const moveAdjust = (e: React.PointerEvent) => {
    const a = adjustRef.current;
    if (!a || !onDraft) return;
    const dMin = Math.round((e.clientY - a.y0) / PX / SNAP) * SNAP;
    if (a.mode === 'resize') {
      const end = Math.max(a.from.start + SNAP * MINUTE, a.from.end + dMin * MINUTE);
      if (end !== draft?.end) onDraft({ ...a.from, end });
      return;
    }
    const dDay = Math.max(-a.day, Math.min(a.maxDay - a.day, Math.round((e.clientX - a.x0) / a.colWidth)));
    const z = instantToZoned(a.from.start, tz);
    const start = zonedToInstant(addDays(z.date, dDay), Math.round((z.minutes + dMin) / SNAP) * SNAP, tz);
    if (start !== draft?.start) onDraft({ ...a.from, start, end: start + (a.from.end - a.from.start) });
  };
  const endAdjust = () => {
    adjustRef.current = null;
  };

  const createAt = (e: React.MouseEvent<HTMLDivElement>, day: string) => {
    if (onDraft || e.target !== e.currentTarget) return; // quick create, or a block rather than the empty grid
    const minutes = Math.min(1410, Math.floor(minuteAt(e, e.currentTarget) / 30) * 30);
    onCreate(new Date(zonedToInstant(day, minutes, tz)).toISOString());
  };

  // What the placeholder shows: the slots being dragged over, or the draft.
  const shownDraft: { day: number; top: number; bottom: number; start: number; end: number } | null = making?.moved
    ? { day: making.day, top: making.start, bottom: making.end, start: zonedToInstant(days[making.day]!, making.start, tz), end: zonedToInstant(days[making.day]!, making.end, tz) }
    : draft && draftZ && draftDay >= 0
      ? { day: draftDay, top: draftZ.minutes, bottom: Math.min(1440, draftZ.minutes + (draft.end - draft.start) / MINUTE), start: draft.start, end: draft.end }
      : null;

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
            <div
              key={day}
              className="cal-col"
              data-day={day}
              onClick={(e) => createAt(e, day)}
              onPointerDown={onDraft ? (e) => startMaking(e, i) : undefined}
              onPointerMove={onDraft ? moveMaking : undefined}
              onPointerUp={onDraft ? endMaking : undefined}
              onPointerCancel={onDraft ? () => setMake(null) : undefined}
              title={onDraft ? 'Click or drag to schedule a meeting' : 'Click to schedule a meeting'}
            >
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
                    className={blockClass(m, 'cal-block') + (seg.bottom - seg.top < 45 ? ' compact' : '') + (dragging && drag.moved ? ' is-dragging' : '') + (draggable ? ' can-drag' : '')}
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
                        data-testid="cal-resize"
                        onPointerDown={(e) => startDrag(e, seg, i, 'resize')}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                );
              })}
              {shownDraft?.day === i && (
                <div
                  className={`cal-block cal-draft mt-${draft?.type ?? 'visit'}` + (shownDraft.bottom - shownDraft.top < 45 ? ' compact' : '')}
                  data-testid="cal-draft"
                  aria-label="New meeting"
                  style={{ top: shownDraft.top * PX, height: Math.max(shownDraft.bottom - shownDraft.top, SNAP) * PX - 2, left: 1, width: 'calc(100% - 3px)' }}
                  onPointerDown={(e) => startAdjust(e, 'move')}
                  onPointerMove={moveAdjust}
                  onPointerUp={endAdjust}
                  onPointerCancel={endAdjust}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="cal-block-time" data-testid="cal-draft-time">
                    {instantToZoned(shownDraft.start, tz).time}–{instantToZoned(shownDraft.end, tz).time}
                  </span>
                  <span className="cal-block-title">{draft?.title?.trim() || '(No title)'}</span>
                  {!making && (
                    <span
                      className="cal-resize"
                      aria-hidden
                      data-testid="cal-draft-resize"
                      onPointerDown={(e) => startAdjust(e, 'resize')}
                      onPointerMove={moveAdjust}
                      onPointerUp={endAdjust}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </div>
              )}
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
  // As endDrag saves it: a move keeps the length; a resize puts the end on a 15-minute step.
  const moved = Math.round((a.minutes + drag.dMin) / SNAP) * SNAP;
  const startLabel = drag.mode === 'move' ? timeOf(moved) : a.time;
  const endLabel = drag.mode === 'move' ? timeOf(moved + Math.round((Date.parse(seg.m.endsAt) - start) / MINUTE)) : timeOf(Math.round(bottom / SNAP) * SNAP);
  return (
    <div
      className={blockClass(seg.m, 'cal-block cal-ghost')}
      aria-hidden
      data-testid="cal-ghost"
      style={{
        top: (top * HOUR) / 60,
        height: ((bottom - top) * HOUR) / 60 - 2,
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
