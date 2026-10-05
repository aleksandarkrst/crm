import type { ApiMeeting } from '../../lib/api';
import { memberName } from '../../store/selectors';
import { useStore } from '../../store/store';
import { dateLabel, instantToZoned } from '../../store/time';
import { StatusBadge, TypeTag } from './parts';

const COLS = '150px minmax(160px, 1.6fr) minmax(120px, 1.1fr) minmax(110px, 1fr) 140px 100px 100px 100px';
const MINUTES = { missing: 'Missing', recorded: 'Recorded' } as const;
const DELIVERY = { not_sent: 'Not sent', queued: 'Queued', sent: 'Sent', failed: 'Failed' } as const;

/**
 * The Table view (CD-130): one row per meeting in the date range, past and upcoming, sorted by
 * start (the header toggles the order). Rows open the meeting's page.
 */
export function MeetingTable({ meetings, sort, onSort, onOpen, more }: { meetings: ApiMeeting[]; sort: 'asc' | 'desc'; onSort: () => void; onOpen: (id: string) => void; more: boolean }) {
  const { s } = useStore();
  const tz = s.workspace.timezone;
  return (
    <div className="card meeting-table" data-testid="meeting-table">
      <div className="table-head" style={{ gridTemplateColumns: COLS }}>
        <button type="button" className="sort-btn" data-testid="sort-start" onClick={onSort} style={{ color: 'var(--ink)' }}>
          <span>Start</span>
          <span style={{ fontSize: 10 }}>{sort === 'asc' ? '↑' : '↓'}</span>
        </button>
        {['Title', 'Company', 'Organizer', 'Type', 'Status', 'Internal minutes', 'External minutes'].map((h) => (
          <span key={h} className="th">
            {h}
          </span>
        ))}
      </div>
      {meetings.map((m) => {
        const a = instantToZoned(m.startsAt, tz);
        return (
          <div key={m.id} className="table-row clickable" data-meeting-id={m.id} style={{ gridTemplateColumns: COLS }} onClick={() => onOpen(m.id)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(m.id)}>
            <span style={{ whiteSpace: 'nowrap' }}>
              {dateLabel(a.date, { year: true })} · {a.time}
            </span>
            <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: m.status === 'cancelled' ? 'line-through' : undefined }}>{m.title}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.companyName}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.organizerUserId ? memberName(s, m.organizerUserId, m.organizerName) : 'Organizer left'}</span>
            <TypeTag type={m.type} />
            <span>
              <StatusBadge m={m} />
            </span>
            <span className={m.status === 'held' && m.internalMinutes === 'missing' ? 'mt-missing' : undefined}>{MINUTES[m.internalMinutes]}</span>
            <span className={m.externalDelivery === 'failed' ? 'mt-missing' : undefined}>{DELIVERY[m.externalDelivery]}</span>
          </div>
        );
      })}
      {meetings.length === 0 && <div className="empty-state">No meetings in this period with these filters.</div>}
      {more && <div className="empty-state">Showing the first {meetings.length}. Narrow the dates or filters to see the rest.</div>}
    </div>
  );
}
