import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MeetingQuery } from '../lib/api';
import { paths } from '../lib/paths';
import type { MeetingDialogSeed } from '../store/meetings';
import { useStore } from '../store/store';
import { addDays, dateLabel, instantToZoned, todayIn } from '../store/time';
import { useMeetingList } from '../store/useMeetings';
import { blockClass, StatusMark } from '../screens/calendar/parts';
import { AddButton, Section } from './RecordParts';

/**
 * "Meetings" on a company, contact or deal page (CD-130, spec 4.6): the next three upcoming
 * meetings, "Show all" (the Calendar's table filtered to the record) and "+ Meeting" prefilled
 * with the record. On a contact, the meetings where they are an external participant.
 */
export function MeetingsCard({ record, seed }: { record: { companyId: string } | { dealId: string } | { contactId: string }; seed: MeetingDialogSeed }) {
  const { s, meetings } = useStore();
  const tz = s.workspace.timezone;
  // "Upcoming" from when the page opened (a fixed moment keeps the list's key stable).
  const [from] = useState(() => new Date(Math.floor(Date.now() / 60_000) * 60_000));
  const query: MeetingQuery = { ...record, from: from.toISOString(), to: new Date(from.getTime() + 5 * 366 * 86_400_000).toISOString(), status: ['planned', 'held'], sort: 'asc', limit: 3 };
  const { meetings: rows, loading, error } = useMeetingList(query);
  const today = todayIn(tz);
  const filter = 'companyId' in record ? { company: record.companyId } : 'dealId' in record ? { deal: record.dealId } : { contact: record.contactId };
  const all = paths.calendar({ view: 'table', user: 'all', from: addDays(today, -365), to: addDays(today, 365), ...filter });

  return (
    <Section
      title="Meetings"
      testId="meetings-card"
      action={
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to={all} className="crumb-link" data-testid="meetings-show-all">
            Show all
          </Link>
          <AddButton label="New meeting" testId="meetings-add" onClick={() => meetings.openDialog(seed)} />
        </span>
      }
    >
      {loading && rows.length === 0 && <span className="meeting-muted">Loading…</span>}
      {error && <span className="meeting-muted">Couldn't load the meetings.</span>}
      {!loading && !error && rows.length === 0 && <span className="meeting-muted">No upcoming meetings.</span>}
      {rows.map((m) => {
        const a = instantToZoned(m.startsAt, tz);
        return (
          <Link key={m.id} to={paths.meeting(m.id)} className={blockClass(m, 'meetings-card-row')} data-meeting-id={m.id}>
            <span className={`mt-dot mt-${m.type}`} aria-hidden />
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span className="meetings-card-title">
                <StatusMark m={m} /> {m.title}
              </span>
              <span className="meetings-card-sub">
                {a.date === today ? 'Today' : dateLabel(a.date)} · {a.time}
                {'companyId' in record ? '' : ' · ' + m.companyName}
              </span>
            </span>
          </Link>
        );
      })}
    </Section>
  );
}
