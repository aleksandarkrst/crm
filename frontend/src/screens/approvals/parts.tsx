import type { DayStatus, WeekStatus } from '../../lib/timesheetApi';

/** The week's status badge (design: submitted and approved brand, rejected amber, the rest neutral). */
export const WEEK_BADGE: Record<WeekStatus, string> = {
  no_entry: 'badge-neutral',
  not_submitted: 'badge-neutral',
  draft: 'badge-neutral',
  partly_submitted: 'badge-neutral',
  submitted: 'badge-brand',
  partly_approved: 'badge-neutral',
  approved: 'badge-brand',
  rejected: 'badge-warn',
};

export const DAY_STATUS: Record<DayStatus, string> = { draft: 'Draft', submitted: 'Submitted', rejected: 'Rejected', approved: 'Approved' };

/** "Mon 12 Oct, 09:05" in the workspace's time zone. */
export function when(iso: string, timeZone: string | undefined): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
  return `${day}, ${time}`;
}

/** Seven squares, one per day (design `#cd-157`): green approved, blue submitted, amber rejected, grey draft, hatched no entry needed. */
export function DaySquares({ days }: { days: { date: string; status: DayStatus; required: boolean; minutes: number }[] }) {
  return (
    <span className="ap-squares" data-testid="ap-squares">
      {days.map((d) => (
        <span key={d.date} className={`ap-sq${d.required || d.minutes > 0 ? '' : ' off'}`} data-status={d.required || d.minutes > 0 ? d.status : 'none'} title={`${d.date}: ${d.required || d.minutes > 0 ? DAY_STATUS[d.status] : 'No entry needed'}`} />
      ))}
    </span>
  );
}
