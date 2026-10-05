import { useState } from 'react';
import { Link } from 'react-router-dom';
import { crmApi, type MeetingQuery } from '../lib/api';
import { paths } from '../lib/paths';
import type { MeetingDialogSeed } from '../store/meetings';
import { useStore } from '../store/store';
import { addDays, dateLabel, instantToZoned, todayIn } from '../store/time';
import { useMeetingList } from '../store/useMeetings';
import { useVisitProgress } from '../store/useVisitProgress';
import { blockClass, StatusMark } from '../screens/calendar/parts';
import { AddButton, Section } from './RecordParts';

/**
 * "Meetings" on a company, contact or deal page (CD-130, spec 4.6): the next three upcoming
 * meetings, "Show all" (the Calendar's table filtered to the record) and "+ Meeting" prefilled
 * with the record. On a contact, the meetings where they are an external participant. On a
 * company in this month's visit plans, "Visits this month: held / planned" (CD-135), and in this
 * fiscal quarter's monthly plans "Visits this quarter: held / planned" (CD-211; the quarter adds up
 * its three months, CD-212), summed over the plans the viewer can see (everyone's for owners and admins, their own for members). "Show all" covers every
 * meeting of the record, from SHOW_ALL_FROM to five years ahead (the table loads it page by page).
 */
/** The salespeople of some plans, each once ("Ana, Marko"). */
const namesOf = (plans: { salespersonName: string }[]) => [...new Set(plans.map((p) => p.salespersonName))].join(', ');
/** "Show all" starts here: before any meeting a workspace can have. */
const SHOW_ALL_FROM = '2000-01-01';

export function MeetingsCard({ record, seed }: { record: { companyId: string } | { dealId: string } | { contactId: string }; seed: MeetingDialogSeed }) {
  const { s, meetings } = useStore();
  const tz = s.workspace.timezone;
  // "Upcoming" from when the page opened (a fixed moment keeps the list's key stable).
  const [from] = useState(() => new Date(Math.floor(Date.now() / 60_000) * 60_000));
  const query: MeetingQuery = { ...record, from: from.toISOString(), to: new Date(from.getTime() + 5 * 366 * 86_400_000).toISOString(), status: ['planned', 'held'], sort: 'asc', limit: 3 };
  const { meetings: rows, loading, error } = useMeetingList(query);
  const today = todayIn(tz);
  const filter = 'companyId' in record ? { company: record.companyId } : 'dealId' in record ? { deal: record.dealId } : { contact: record.contactId };
  const all = paths.calendar({ view: 'table', user: 'all', from: SHOW_ALL_FROM, to: addDays(today, 5 * 366), ...filter });
  const companyId = 'companyId' in record ? record.companyId : null;
  const { data: visits } = useVisitProgress(companyId ? 'company-visits:' + companyId : null, () => crmApi.visitSummary({ periodType: 'month', companyId: companyId!, all: true }));
  const { data: quarter } = useVisitProgress(companyId ? 'company-visits-quarter:' + companyId : null, () => crmApi.visitSummary({ periodType: 'quarter', companyId: companyId!, all: true }));

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
      {visits && visits.plans.length > 0 && (
        <span className="vp-company-visits" data-testid="company-visits-this-month" title={`Customer visits held this month for the visit plans of ${namesOf(visits.plans)}`}>
          Visits this month: {visits.held} / {visits.planned}
        </span>
      )}
      {quarter && quarter.plans.length > 0 && (
        <span
          className="vp-company-visits"
          data-testid="company-visits-this-quarter"
          title={`Customer visits held in ${quarter.periodLabel} for the monthly visit plans of ${namesOf(quarter.plans)}`}
        >
          Visits this quarter: {quarter.held} / {quarter.planned}
        </span>
      )}
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
