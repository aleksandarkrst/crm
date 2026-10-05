import { memo, useMemo, useState } from 'react';
import type { ApiMeeting } from '../../lib/api';
import { addDays, daysBetween, instantToZoned, todayIn, zonedToInstant } from '../../store/time';
import { bucketByDay } from './layout';
import { blockClass, blockTitle, StatusMark } from './parts';

const SHOWN = 3;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The Month view (CD-130): whole weeks, each day with up to three meetings and "+N more" (which
 * opens the day). Clicking a day's empty space starts a meeting at 09:00; a planned meeting the
 * user may edit can be dragged to another day (same time).
 */
export function MonthGrid({
  days,
  month,
  meetings,
  tz,
  onOpen,
  onCreate,
  onDay,
  canDrag,
  onReschedule,
}: {
  days: string[];
  /** "2026-10": days outside it are dimmed. */
  month: string;
  meetings: ApiMeeting[];
  tz: string;
  onOpen: (id: string) => void;
  onCreate: (startIso: string) => void;
  onDay: (date: string) => void;
  canDrag: (m: ApiMeeting) => boolean;
  onReschedule: (m: ApiMeeting, startsAt: string, endsAt: string) => void;
}) {
  const byDay = useMemo(() => bucketByDay(days, meetings, tz), [days, meetings, tz]);
  const today = todayIn(tz);
  const [over, setOver] = useState<string | null>(null);

  const drop = (e: React.DragEvent, date: string) => {
    e.preventDefault();
    setOver(null);
    const [id, from] = (e.dataTransfer.getData('text/plain') || '').split('|');
    const m = meetings.find((x) => x.id === id);
    if (!m || !from || from === date) return;
    const shift = daysBetween(from, date);
    const a = instantToZoned(m.startsAt, tz);
    const start = zonedToInstant(addDays(a.date, shift), a.minutes, tz);
    onReschedule(m, new Date(start).toISOString(), new Date(start + (Date.parse(m.endsAt) - Date.parse(m.startsAt))).toISOString());
  };

  return (
    <div className="cal-month card" data-testid="month-grid">
      <div className="cal-month-head">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="cal-month-body">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <div
              key={d}
              className={'cal-cell' + (d.startsWith(month) ? '' : ' other') + (d === today ? ' today' : '') + (over === d ? ' over' : '')}
              data-day={d}
              onClick={(e) => e.target === e.currentTarget && onCreate(new Date(zonedToInstant(d, 9 * 60, tz)).toISOString())}
              onDragOver={(e) => {
                e.preventDefault();
                if (over !== d) setOver(d);
              }}
              onDragLeave={() => over === d && setOver(null)}
              onDrop={(e) => drop(e, d)}
            >
              <button type="button" className="cal-cell-date" onClick={() => onDay(d)} title="Open this day">
                {Number(d.slice(8))}
              </button>
              {list.slice(0, SHOWN).map((m) => (
                <Chip key={m.id} m={m} tz={tz} day={d} draggable={canDrag(m)} onOpen={onOpen} />
              ))}
              {list.length > SHOWN && (
                <button type="button" className="cal-more" onClick={() => onDay(d)}>
                  +{list.length - SHOWN} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Chip = memo(function Chip({ m, tz, day, draggable, onOpen }: { m: ApiMeeting; tz: string; day: string; draggable: boolean; onOpen: (id: string) => void }) {
  const a = instantToZoned(m.startsAt, tz);
  return (
    <button
      type="button"
      className={blockClass(m, 'cal-chip')}
      data-meeting-id={m.id}
      title={blockTitle(m, tz)}
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', `${m.id}|${day}`)}
      onClick={() => onOpen(m.id)}
    >
      <StatusMark m={m} />
      <span className="cal-chip-time">{a.date === day ? a.time : '…'}</span>
      <span className="cal-chip-title">{m.title}</span>
    </button>
  );
});
