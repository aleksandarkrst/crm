import type { ApiMeeting, MeetingType } from '../../lib/api';
import { isNotClosed, STATUS_LABEL, TYPE_LABEL } from '../../store/meetings';
import { timeLabel } from '../../store/time';

/** The CSS classes of a meeting on the calendar: its type's color, held, cancelled, not closed. */
export const blockClass = (m: ApiMeeting, base: string) =>
  `${base} mt-${m.type}${m.status === 'held' ? ' is-held' : ''}${m.status === 'cancelled' ? ' is-cancelled' : ''}${isNotClosed(m) ? ' is-not-closed' : ''}`;

/** What a block says on hover and to screen readers. */
export const blockTitle = (m: ApiMeeting, tz: string) =>
  `${timeLabel(m.startsAt, tz)}–${timeLabel(m.endsAt, tz)} · ${m.title} · ${m.companyName} · ${TYPE_LABEL[m.type]} · ${isNotClosed(m) ? 'Not closed' : STATUS_LABEL[m.status]}`;

/** Held gets a check mark; a planned meeting more than a day past its end says "Not closed". */
export function StatusMark({ m }: { m: ApiMeeting }) {
  if (m.status === 'held')
    return (
      <span className="mt-check" aria-label="Held">
        ✓
      </span>
    );
  if (isNotClosed(m)) return <span className="mt-not-closed">Not closed</span>;
  return null;
}

/** A small badge with the status, as on the meeting page and in the table. */
export function StatusBadge({ m }: { m: ApiMeeting }) {
  if (isNotClosed(m)) return <span className="badge badge-warn">Not closed</span>;
  const cls = m.status === 'held' ? 'badge badge-brand' : m.status === 'cancelled' ? 'badge badge-danger' : 'badge badge-neutral';
  return <span className={cls}>{STATUS_LABEL[m.status]}</span>;
}

/** The type with its color dot. */
export function TypeTag({ type }: { type: MeetingType }) {
  return (
    <span className="mt-type">
      <span className={`mt-dot mt-${type}`} aria-hidden />
      {TYPE_LABEL[type]}
    </span>
  );
}
