import { useMemo } from 'react';
import type { ApiMeeting } from '../../lib/api';
import { dateLabel, instantToZoned, todayIn, zonedToInstant } from '../../store/time';
import { bucketByDay } from './layout';
import { blockClass, StatusMark } from './parts';

/** The Week view on a phone (CD-130): a list grouped by day. "+" on a day starts a meeting at 09:00. */
export function DayList({ days, meetings, tz, onOpen, onCreate }: { days: string[]; meetings: ApiMeeting[]; tz: string; onOpen: (id: string) => void; onCreate: (startIso: string) => void }) {
  const byDay = useMemo(() => bucketByDay(days, meetings, tz), [days, meetings, tz]);
  const today = todayIn(tz);
  return (
    <div className="cal-list" data-testid="day-list">
      {days.map((d) => {
        const list = byDay.get(d) ?? [];
        return (
          <section key={d} className="cal-list-day" data-day={d}>
            <div className={d === today ? 'cal-list-head today' : 'cal-list-head'}>
              <span>{dateLabel(d, { weekday: 'long' })}</span>
              <button type="button" className="btn-plain" aria-label={`New meeting on ${dateLabel(d)}`} onClick={() => onCreate(new Date(zonedToInstant(d, 9 * 60, tz)).toISOString())}>
                +
              </button>
            </div>
            {list.length === 0 && <div className="cal-list-empty">No meetings</div>}
            {list.map((m) => {
              const a = instantToZoned(m.startsAt, tz);
              const b = instantToZoned(m.endsAt, tz);
              return (
                <button key={m.id} type="button" className={blockClass(m, 'cal-list-item')} data-meeting-id={m.id} onClick={() => onOpen(m.id)}>
                  <span className="cal-list-time">
                    {a.date === d ? a.time : '…'}–{b.date === d ? b.time : '…'}
                  </span>
                  <span className="cal-list-main">
                    <span className="cal-block-title">
                      <StatusMark m={m} /> {m.title}
                    </span>
                    <span className="cal-block-sub">{m.companyName}</span>
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
