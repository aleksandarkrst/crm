import { useState } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { type ApiSickLeave, type ApiTimeOffReason, type ApiTimeOffRequest, timeOffApi, type TimeOffType } from '../../lib/timeOffApi';
import { useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { dateLabel } from '../employee/parts';
import { BalanceCard, useBalance } from './BalanceCard';
import { RequestDialog } from './RequestDialog';
import { RequestsList } from './RequestsList';
import { ReportSickButton, SickLeaveList } from './SickLeave';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** Today on the workspace's clock (yyyy-mm-dd). */
function todayIn(timeZone: string | undefined): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

interface Usage {
  used: number;
  scheduled: number;
  pending: number;
}

/** Days per type in `year`: approved days up to today (used) and after (scheduled), and days waiting for a decision. */
function usageOf(requests: readonly ApiTimeOffRequest[], year: number, today: string): Record<TimeOffType, Usage> {
  const out = { vacation: { used: 0, scheduled: 0, pending: 0 }, paid_leave: { used: 0, scheduled: 0, pending: 0 }, unpaid_leave: { used: 0, scheduled: 0, pending: 0 }, other_absence: { used: 0, scheduled: 0, pending: 0 } };
  for (const r of requests) {
    if (r.status !== 'approved' && r.status !== 'pending') continue;
    for (const d of r.days) {
      if (d.state !== 'counted' || !d.date.startsWith(String(year))) continue;
      const u = out[r.type];
      if (r.status === 'pending') u.pending += 1;
      else if (d.date <= today) u.used += 1;
      else u.scheduled += 1;
    }
  }
  return out;
}

/** One policy: the big figure (left, or used where there is no allowance) and its lines. */
function Tile({ title, figure, unit, lines, testId, children }: { title: string; figure: number; unit: string; lines: (string | null | false)[]; testId: string; children?: React.ReactNode }) {
  return (
    <section className="to-tile" data-testid={testId}>
      <span className="caps">{title}</span>
      <span className="to-tile-figure">
        <strong>{figure}</strong> <span className="emp-note">{unit}</span>
      </span>
      {lines.filter(Boolean).map((l) => (
        <span key={l as string} className="emp-note">
          {l}
        </span>
      ))}
      {children}
    </section>
  );
}

/**
 * My time off (CD-350, simplified from spec 6.5 and 8.5): one tile per policy with what is left and
 * what was used this year (Vacation, Paid leave, Unpaid leave, Other absence when used) and sick
 * leave alongside them; Request time off and Report sick leave; then the year's requests and sick
 * leave. The full vacation breakdown and its history fold out under "Vacation details".
 */
export function MyTimeOff({ employeeId, year, onYear }: { employeeId: string | null | undefined; year: string | null; onYear: (y: string | null) => void }) {
  const { s, session } = useStore();
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const y = year && /^\d{4}$/.test(year) ? Number(year) : undefined;
  const { data, error, set } = useBalance(employeeId ?? '', y);
  const shownYear = y ?? data?.currentYear;
  const { data: requests, reload: reloadRequests } = useProjectsRead<ApiTimeOffRequest[]>(
    !!employeeId && !!shownYear,
    () => timeOffApi.requests.list({ employeeId: employeeId ?? undefined, year: shownYear }),
    `timeoff:requests:${employeeId ?? ''}:${shownYear ?? ''}`,
    'timeOffRev',
  );
  const { data: sick, reload: reloadSick } = useProjectsRead<ApiSickLeave[]>(!!employeeId, () => timeOffApi.sickLeave.list({ employeeId: employeeId ?? undefined }), `timeoff:sick:${employeeId ?? ''}`, 'timeOffRev');
  const { data: reasons } = useProjectsRead<ApiTimeOffReason[]>(!!employeeId, () => timeOffApi.reasons.list('paid_leave'), 'timeoff:reasons:paid_leave', 'timeOffRev');
  const [requesting, setRequesting] = useState(false);
  const [details, setDetails] = useState(false);

  if (!employeeId) return <div className="ts-help">{employeeId === null ? 'You have no employee record in this workspace, so there is no time off.' : 'Loading'}</div>;
  if (error) return <EmptyState title="Your time off could not be loaded" text={error} />;
  if (data === null) return <EmptyState title="No time off" text="You have no employee record in this workspace." />;
  if (!data) return <div className="ts-help">Loading</div>;

  const today = todayIn(s.workspace?.timezone);
  const usage = usageOf(requests ?? [], data.year, today);
  const f = data.figures;
  const sickThisYear = (sick ?? []).filter((r) => r.status !== 'cancelled' && r.startDate.startsWith(String(data.year)));
  const sickDays = sickThisYear.reduce((a, r) => a + r.workingDays, 0);
  const openSick = (sick ?? []).find((r) => r.status !== 'cancelled' && r.stillOpen);
  const limited = (reasons ?? []).filter((r) => r.active && r.maxDays !== null);
  const years = Array.from(new Set([...data.years, data.currentYear])).sort();
  const reloadAll = () => {
    void reloadRequests();
    void reloadSick();
  };

  return (
    <div className="bal-page" data-testid="my-timeoff">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {years.length > 1 &&
          years.map((yr) => (
            <button key={yr} type="button" className={'btn-plain' + (yr === data.year ? ' on' : '')} aria-pressed={yr === data.year} onClick={() => onYear(yr === data.currentYear ? null : String(yr))} data-testid={`balance-year-${yr}`}>
              {yr}
            </button>
          ))}
        <span style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <ReportSickButton employeeId={employeeId} onReported={() => void reloadSick()} />
          <button type="button" className="btn btn-primary" onClick={() => setRequesting(true)} data-testid="request-new">
            Request time off
          </button>
        </span>
      </div>

      <div className="to-tiles" data-testid="timeoff-policies">
        <Tile
          title="Vacation"
          figure={f.remaining}
          // Of the days still usable this year: carried-over days that expired don't count (CD-350).
          unit={`${f.remaining === 1 ? 'day' : 'days'} left of ${f.total - f.expired}`}
          testId="policy-vacation"
          lines={[`Used ${days(f.used)}`, f.scheduled > 0 && `Booked ${days(f.scheduled)}`, f.pending > 0 && `Waiting for approval ${days(f.pending)}`, f.carryRemaining > 0 && `${days(f.carryRemaining)} carried over, use by ${dateLabel(f.carryExpiresOn)}`]}
        >
          <button type="button" className="btn-plain to-tile-link" aria-expanded={details} onClick={() => setDetails(!details)} data-testid="vacation-details">
            {details ? 'Hide details' : 'Vacation details'}
          </button>
        </Tile>
        <Tile
          title="Paid leave"
          figure={usage.paid_leave.used}
          unit={`${usage.paid_leave.used === 1 ? 'day' : 'days'} used`}
          testId="policy-paid_leave"
          lines={[usage.paid_leave.scheduled > 0 && `Booked ${days(usage.paid_leave.scheduled)}`, usage.paid_leave.pending > 0 && `Waiting for approval ${days(usage.paid_leave.pending)}`, limited.length > 0 ? `For a reason, e.g. ${limited.slice(0, 3).map((r) => `${r.name} up to ${days(r.maxDays!)}`).join(', ')}` : 'For a reason such as a wedding or a move']}
        />
        <Tile
          title="Unpaid leave"
          figure={usage.unpaid_leave.used}
          unit={`${usage.unpaid_leave.used === 1 ? 'day' : 'days'} used`}
          testId="policy-unpaid_leave"
          lines={[usage.unpaid_leave.scheduled > 0 && `Booked ${days(usage.unpaid_leave.scheduled)}`, usage.unpaid_leave.pending > 0 && `Waiting for approval ${days(usage.unpaid_leave.pending)}`, 'Agreed with your manager']}
        />
        {usage.other_absence.used + usage.other_absence.scheduled > 0 && (
          <Tile title="Other absence" figure={usage.other_absence.used} unit={`${usage.other_absence.used === 1 ? 'day' : 'days'} used`} testId="policy-other_absence" lines={[usage.other_absence.scheduled > 0 && `Booked ${days(usage.other_absence.scheduled)}`, 'Recorded by an Admin']} />
        )}
        <Tile
          title="Sick leave"
          figure={sickDays}
          unit={`working ${sickDays === 1 ? 'day' : 'days'} this year`}
          testId="policy-sick_leave"
          lines={[openSick ? `On sick leave since ${dateLabel(openSick.startDate)}` : sickThisYear.length ? `${sickThisYear.length} ${sickThisYear.length === 1 ? 'record' : 'records'}` : 'None this year', 'No allowance: report it when it happens']}
        />
      </div>

      {details && <BalanceCard balance={data} onChanged={(b) => b && set(b)} />}

      <section className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="timeoff-history">
        <span style={{ fontSize: 15, fontWeight: 600 }}>Your time off in {data.year}</span>
        <span className="caps">Requests</span>
        {requests ? <RequestsList requests={requests} onChanged={() => void reloadRequests()} /> : <span className="emp-note">Loading</span>}
        <span className="caps" style={{ marginTop: 6 }}>
          Sick leave
        </span>
        {sick ? <SickLeaveList records={sickThisYear} onChanged={() => void reloadSick()} /> : <span className="emp-note">Loading</span>}
      </section>

      {requesting && (
        <RequestDialog
          employeeId={employeeId}
          admin={admin}
          onClose={(saved) => {
            setRequesting(false);
            if (saved) reloadAll();
          }}
        />
      )}
    </div>
  );
}
