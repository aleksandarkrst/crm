import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { paths } from '../lib/paths';
import { addDays, type ApiDayStatus, type ApiStatusRow } from '../lib/timesheetApi';
import { fold } from '../store/search';
import { useStore } from '../store/store';
import { useTeamStatus } from '../store/timesheet';
import { STATUS_COUNTERS, StatusBadge, statusCounts, TimesheetCell } from './teamStatus/parts';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tuesday 13 Oct 2026". */
const longDate = (date: string) => `${WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
/** Employee · Team · Status · Details · Timesheet (the list's columns). */
const COLS = 'minmax(180px, 1.3fr) minmax(120px, 0.8fr) 150px minmax(160px, 1.2fr)';
const COLS_TS = `${COLS} minmax(150px, 0.9fr)`;

/** The people below `managerId` at any depth, from the rows' managers. */
function subtree(rows: ApiStatusRow[], managerId: string): Set<string> {
  const below = new Map<string, string[]>();
  for (const r of rows) if (r.manager) below.set(r.manager.id, [...(below.get(r.manager.id) ?? []), r.id]);
  const out = new Set<string>();
  const queue = [managerId];
  while (queue.length) {
    for (const id of below.get(queue.shift()!) ?? []) {
      if (out.has(id)) continue;
      out.add(id);
      queue.push(id);
    }
  }
  return out;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const uniq = <T extends { id: string; name: string }>(items: (T | null)[]) => [...new Map(items.filter((x): x is T => !!x).map((x) => [x.id, x])).values()].sort(byName);

/**
 * Today's status (CD-162, spec 15 section 12, design `Timesheet.dc.html#cd-162`): who is working,
 * away or off on a date, for managers and Admins. Counters on top (a counter filters the list),
 * then one row per employee grouped by department, with the filters of 12.1 kept in the address.
 * Managers see their direct and indirect reports, Admins everyone; the timesheet column shows
 * last week for the people the caller approves.
 */
export function TeamStatus() {
  const { s } = useStore();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? undefined;
  const { data, error } = useTeamStatus(true, date);
  const f = {
    department: params.get('department') ?? '',
    team: params.get('team') ?? '',
    manager: params.get('manager') ?? '',
    status: (params.get('status') ?? '') as ApiDayStatus | '',
    q: params.get('q') ?? '',
    all: params.get('all') === '1',
    flat: params.get('group') === 'none',
  };
  const go = (next: Partial<Record<'date' | 'department' | 'team' | 'manager' | 'status' | 'q' | 'all' | 'group', string | null>>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const rows = useMemo(() => data?.rows ?? [], [data]);
  /** Everything but the status filter: the counters count these, so a counter and the list always agree. */
  const scoped = useMemo(() => {
    const inManager = f.manager ? subtree(rows, f.manager) : null;
    const q = fold(f.q);
    return rows.filter(
      (r) =>
        (f.all || r.status !== 'not_employed') &&
        (!f.department || r.department?.id === f.department) &&
        (!f.team || r.team?.id === f.team) &&
        (!inManager || inManager.has(r.id)) &&
        (!q || fold(`${r.name} ${r.jobTitle ?? ''}`).includes(q)),
    );
  }, [rows, f.all, f.department, f.team, f.manager, f.q]);
  const shown = f.status ? scoped.filter((r) => r.status === f.status) : scoped;
  const counts = statusCounts(scoped);

  if (!data) {
    return <Screen title="Today's status">{error ? <EmptyState title="Today's status could not be loaded" text={error} /> : <div className="ts-help">Loading</div>}</Screen>;
  }

  const departments = uniq(rows.map((r) => r.department));
  const teams = uniq(rows.filter((r) => !f.department || r.department?.id === f.department).map((r) => r.team));
  const managers = uniq(rows.map((r) => r.manager));
  const withTimesheet = rows.some((r) => r.timesheet);
  const cols = withTimesheet ? COLS_TS : COLS;
  const updated = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: s.workspace?.timezone }).format(new Date(data.updatedAt));
  const groups = f.flat
    ? [{ id: 'all', name: '', rows: shown }]
    : [...departments.map((d) => ({ id: d.id, name: d.name, rows: shown.filter((r) => r.department?.id === d.id) })), { id: 'none', name: 'No department', rows: shown.filter((r) => !r.department) }].filter((g) => g.rows.length);
  const counters = STATUS_COUNTERS.filter((c) => c.always || counts[c.status] > 0 || f.status === c.status).filter((c) => c.status !== 'not_employed' || f.all);

  return (
    <Screen title="Today's status">
      <div className="tst-page" data-testid="team-status">
        <div className="ts-toolbar tst-toolbar">
          <button type="button" className="btn-plain ts-arrow" aria-label="Previous day" data-testid="tst-prev" disabled={data.date <= data.minDate} onClick={() => go({ date: addDays(data.date, -1) })}>
            ←
          </button>
          <button type="button" className="btn-plain" data-testid="tst-today" disabled={data.date === data.today} onClick={() => go({ date: null })}>
            Today
          </button>
          <button type="button" className="btn-plain ts-arrow" aria-label="Next day" data-testid="tst-next" disabled={data.date >= data.maxDate} onClick={() => go({ date: addDays(data.date, 1) })}>
            →
          </button>
          <span className="ts-week-label" data-testid="tst-date">
            {longDate(data.date)}
          </span>
          <input
            type="date"
            className="form-input tst-date"
            aria-label="Date"
            min={data.minDate}
            max={data.maxDate}
            value={data.date}
            onChange={(e) => e.target.value && go({ date: e.target.value === data.today ? null : e.target.value })}
            data-testid="tst-date-input"
          />
          <span className="ts-due tst-updated">Updated {updated}</span>
        </div>

        <div className="tst-counters" data-testid="tst-counters">
          {counters.map((c) => (
            <button
              key={c.status}
              type="button"
              className="tst-counter"
              aria-pressed={f.status === c.status}
              onClick={() => go({ status: f.status === c.status ? null : c.status })}
              data-testid={`tst-count-${c.status}`}
            >
              <span className="tst-counter-label">
                <span className="tst-dot" style={{ background: c.dot }} />
                <span className="caps">{c.label}</span>
              </span>
              <span className="tst-counter-n">{counts[c.status]}</span>
            </button>
          ))}
        </div>

        <div className="bal-filters">
          <input className="form-input tst-search" type="search" placeholder="Search by name" aria-label="Search by name" value={f.q} onChange={(e) => go({ q: e.target.value || null })} data-testid="tst-search" />
          <select className="form-input" value={f.department} onChange={(e) => go({ department: e.target.value || null, team: null })} aria-label="Department" data-testid="tst-department">
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select className="form-input" value={f.team} onChange={(e) => go({ team: e.target.value || null })} aria-label="Team" data-testid="tst-team">
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select className="form-input" value={f.manager} onChange={(e) => go({ manager: e.target.value || null })} aria-label="Manager" data-testid="tst-manager">
            <option value="">All managers</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <select className="form-input" value={f.status} onChange={(e) => go({ status: e.target.value || null })} aria-label="Status" data-testid="tst-status">
            <option value="">All statuses</option>
            {STATUS_COUNTERS.filter((c) => c.status !== 'not_employed' || f.all).map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="tst-check">
            <input type="checkbox" checked={!f.flat} onChange={(e) => go({ group: e.target.checked ? null : 'none' })} />
            Group by department
          </label>
          <label className="tst-check">
            <input type="checkbox" checked={f.all} onChange={(e) => go({ all: e.target.checked ? '1' : null, status: !e.target.checked && f.status === 'not_employed' ? null : f.status || null })} data-testid="tst-all" />
            Show former and future employees
          </label>
        </div>

        <div className="ap-table tst-table" data-testid="tst-list">
          <div className="table-head tst-row" style={{ gridTemplateColumns: cols }}>
            <span className="th">Employee</span>
            <span className="th">Team</span>
            <span className="th">Status</span>
            <span className="th">Details</span>
            {withTimesheet && <span className="th">Last week</span>}
          </div>
          {shown.length === 0 && (
            <div className="ts-help" style={{ padding: 16 }}>
              Nobody matches these filters.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.id} data-testid={`tst-group-${g.id}`}>
              {g.name && (
                <div className="tst-group">
                  <span className="caps">{g.name}</span>
                  <span className="emp-note">{g.rows.length}</span>
                </div>
              )}
              {g.rows.map((r) => (
                <div key={r.id} className="table-row tst-row" style={{ gridTemplateColumns: cols }} data-testid={`tst-row-${r.id}`} data-status={r.status}>
                  <span className="tst-person">
                    <span className="avatar tst-avatar">{initials(r.name)}</span>
                    <span className="tst-person-text">
                      <Link to={paths.employee(r.id)} className="tst-name">
                        {r.name}
                      </Link>
                      {r.jobTitle && <span className="emp-note">{r.jobTitle}</span>}
                    </span>
                  </span>
                  <span className="tst-cell" data-label="Team">
                    {r.team?.name ?? (f.flat ? (r.department?.name ?? '') : '')}
                  </span>
                  <span className="tst-cell" data-label="Status">
                    <StatusBadge status={r.status} label={r.label} />
                  </span>
                  <span className="tst-cell tst-detail" data-label="Details">
                    {r.detail}
                    {r.note && <span className="tst-note">{r.note}</span>}
                  </span>
                  {withTimesheet && (
                    <span className="tst-cell" data-label="Last week">
                      <TimesheetCell t={r.timesheet} />
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        <span className="emp-note">
          Working means expected at work; it does not prove presence. Managers see their direct and indirect reports; Admins see everyone. Sick leave never shows its type. Last week's timesheet shows for the people you approve.
        </span>
      </div>
    </Screen>
  );
}
