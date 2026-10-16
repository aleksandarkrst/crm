import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { askConfirm } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { Modal, ModalHeader } from '../components/ui';
import { downloadBlob } from '../lib/csv';
import { paths } from '../lib/paths';
import { type ApiBalanceRow, type ApiBalancesTable, type ApiTimeOffPolicy, type ApiTimeOffRequest, type BalancesFilters, timeOffApi } from '../lib/timeOffApi';
import { projectError, useProjectsRead } from '../store/projects';
import { useStore } from '../store/store';
import { BalanceCard, useBalance } from './timeoff/BalanceCard';
import { ApprovalsTab, CalendarTab } from './timeoff/Approvals';
import { RequestDialog } from './timeoff/RequestDialog';
import { DecisionsTab } from './timeoff/Decisions';
import { RequestsList } from './timeoff/RequestsList';

type Tab = 'my' | 'approvals' | 'requests' | 'calendar' | 'balances' | 'decisions';
const tabStyle = (on: boolean) => ({ borderBottom: `2px solid ${on ? 'var(--brand)' : 'transparent'}`, fontWeight: on ? 600 : 500, color: on ? 'var(--brand)' : 'var(--text-2)' });

/**
 * Time off (milestone 16, Workforce): My time off (the balance card and history, CD-164; requests
 * come with CD-165) and, for managers and Admins, Balances: everyone's figures for a year with
 * filters, Adjust balance, Change policy and Recalculate in bulk, and a CSV export (spec 6.5).
 */
export function TimeOff() {
  const { s, session, employeeCard } = useStore();
  const [params, setParams] = useSearchParams();
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const manager = !!s.people.access?.roles.includes('manager');
  const canSeeBalances = admin || manager;
  const wanted = params.get('tab');
  const tab: Tab = wanted === 'calendar' ? 'calendar' : canSeeBalances && (wanted === 'balances' || wanted === 'requests' || wanted === 'approvals') ? wanted : admin && wanted === 'decisions' ? 'decisions' : 'my';
  const month = params.get('month') && /^\d{4}-\d{2}$/.test(params.get('month')!) ? params.get('month')! : new Date().toISOString().slice(0, 7);
  useEffect(() => {
    void employeeCard.loadMyEmployeeId();
  }, [employeeCard]);
  const go = (next: Partial<Record<string, string | null | undefined>>) => {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...Object.fromEntries(params.entries()), ...next })) if (v) merged[k] = v;
    setParams(merged);
  };
  return (
    <Screen title="Time off">
      <div className="report-tabs" role="tablist" data-testid="timeoff-tabs">
        <button type="button" role="tab" aria-selected={tab === 'my'} className="composer-tab" style={tabStyle(tab === 'my')} onClick={() => go({ tab: null })}>
          My time off
        </button>
        {canSeeBalances && (
          <button type="button" role="tab" aria-selected={tab === 'approvals'} className="composer-tab" style={tabStyle(tab === 'approvals')} onClick={() => go({ tab: 'approvals' })} data-testid="timeoff-tab-approvals">
            Approvals
          </button>
        )}
        {canSeeBalances && (
          <button type="button" role="tab" aria-selected={tab === 'requests'} className="composer-tab" style={tabStyle(tab === 'requests')} onClick={() => go({ tab: 'requests' })} data-testid="timeoff-tab-requests">
            Requests
          </button>
        )}
        <button type="button" role="tab" aria-selected={tab === 'calendar'} className="composer-tab" style={tabStyle(tab === 'calendar')} onClick={() => go({ tab: 'calendar' })} data-testid="timeoff-tab-calendar">
          Team calendar
        </button>
        {canSeeBalances && (
          <button type="button" role="tab" aria-selected={tab === 'balances'} className="composer-tab" style={tabStyle(tab === 'balances')} onClick={() => go({ tab: 'balances' })} data-testid="timeoff-tab-balances">
            Balances
          </button>
        )}
        {admin && (
          <button type="button" role="tab" aria-selected={tab === 'decisions'} className="composer-tab" style={tabStyle(tab === 'decisions')} onClick={() => go({ tab: 'decisions' })} data-testid="timeoff-tab-decisions">
            Decisions
          </button>
        )}
      </div>
      {tab === 'my' && <MyTimeOff employeeId={s.myEmployeeId} year={params.get('year')} onYear={(y) => go({ year: y })} />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'requests' && <RequestsTab admin={admin} myEmployeeId={s.myEmployeeId ?? null} />}
      {tab === 'calendar' && <CalendarTab month={month} onMonth={(m) => go({ month: m })} />}
      {tab === 'balances' && <Balances params={params} go={go} />}
      {tab === 'decisions' && <DecisionsTab />}
    </Screen>
  );
}

/** My time off (spec 6.5, 8.5): the balance card for a year with the history, New request, and the requests of the year. */
function MyTimeOff({ employeeId, year, onYear }: { employeeId: string | null | undefined; year: string | null; onYear: (y: string | null) => void }) {
  const { session } = useStore();
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const y = year && /^\d{4}$/.test(year) ? Number(year) : undefined;
  const { data, error, set } = useBalance(employeeId ?? '', y);
  const { data: requests, reload: reloadRequests } = useProjectsRead<ApiTimeOffRequest[]>(!!employeeId && (y !== undefined || !!data), () => timeOffApi.requests.list({ employeeId: employeeId ?? undefined, year: y ?? (data?.currentYear || undefined) }), `timeoff:requests:${employeeId ?? ''}:${y ?? ''}:${data?.currentYear ?? ''}`, 'timeOffRev');
  const [requesting, setRequesting] = useState(false);
  if (!employeeId) return <div className="ts-help">{employeeId === null ? 'You have no employee record in this workspace, so there is no time off balance.' : 'Loading'}</div>;
  if (error) return <EmptyState title="Your balance could not be loaded" text={error} />;
  if (data === null) return <EmptyState title="No balance" text="You have no employee record in this workspace." />;
  if (!data) return <div className="ts-help">Loading</div>;
  const years = Array.from(new Set([...data.years, data.currentYear])).sort();
  return (
    <div className="bal-page" data-testid="my-timeoff">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {years.map((yr) => (
          <button key={yr} type="button" className={'btn-plain' + (yr === data.year ? ' on' : '')} aria-pressed={yr === data.year} onClick={() => onYear(yr === data.currentYear ? null : String(yr))} data-testid={`balance-year-${yr}`}>
            {yr}
          </button>
        ))}
        <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setRequesting(true)} data-testid="request-new">
          New request
        </button>
      </div>
      <BalanceCard balance={data} onChanged={(b) => b && set(b)} />
      <section className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Requests {data.year}</span>
        {requests ? <RequestsList requests={requests} onChanged={() => void reloadRequests()} /> : <span className="emp-note">Loading</span>}
      </section>
      <span className="emp-note">Sick leave comes with the next release of this module.</span>
      {requesting && (
        <RequestDialog
          employeeId={employeeId}
          admin={admin}
          onClose={(saved) => {
            setRequesting(false);
            if (saved) void reloadRequests();
          }}
        />
      )}
    </div>
  );
}

/** Requests (managers and Admins, spec 8.7, 15.1): everyone the caller may see, with Record time off for Admins. */
function RequestsTab({ admin, myEmployeeId }: { admin: boolean; myEmployeeId: string | null }) {
  const { s, employeeCard } = useStore();
  const [status, setStatus] = useState<string>('pending');
  const [recording, setRecording] = useState(false);
  const { data, error, reload } = useProjectsRead<ApiTimeOffRequest[]>(true, () => timeOffApi.requests.list({ all: true, ...(status ? { status: status as ApiTimeOffRequest['status'] } : {}) }), `timeoff:requests:all:${status}`, 'timeOffRev');
  const orgRev = s.orgRev;
  useEffect(() => {
    if (admin) void employeeCard.ensurePickers();
  }, [admin, employeeCard, orgRev]);
  if (error) return <EmptyState title="Requests could not be loaded" text={error} />;
  const employees = (s.peoplePickers?.employees ?? []).filter((e) => e.status !== 'inactive').map((e) => ({ id: e.id, fullName: e.fullName }));
  return (
    <div className="bal-page" data-testid="requests-tab">
      <div className="bal-filters">
        <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="">All statuses</option>
        </select>
        {admin && (
          <button type="button" className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setRecording(true)} disabled={!employees.length} data-testid="request-record-new">
            Record time off
          </button>
        )}
      </div>
      {data ? <RequestsList requests={data} withEmployee onChanged={() => void reload()} /> : <div className="ts-help">Loading</div>}
      <span className="emp-note">Managers see their direct and indirect reports; Admins see everyone. Decisions are made on the Approvals tab.</span>
      {recording && (
        <RequestDialog
          employeeId={myEmployeeId ?? employees[0]?.id ?? ''}
          employees={employees}
          admin={admin}
          onClose={(saved) => {
            setRecording(false);
            if (saved) void reload();
          }}
        />
      )}
    </div>
  );
}

const COLS = 'minmax(170px, 1.6fr) minmax(120px, 1fr) 80px 80px 80px 70px 80px 70px 90px 90px 90px';

/** Balances (spec 6.5): the table with filters, selection for the bulk actions and the CSV export. */
function Balances({ params, go }: { params: URLSearchParams; go: (next: Partial<Record<string, string | null | undefined>>) => void }) {
  const { s, flash, employeeCard } = useStore();
  const filters: BalancesFilters = {
    year: params.get('year') && /^\d{4}$/.test(params.get('year')!) ? Number(params.get('year')) : undefined,
    unitId: params.get('unit') ?? undefined,
    managerId: params.get('manager') ?? undefined,
    policyId: params.get('policy') ?? undefined,
    expiring: params.get('expiring') === '1',
  };
  const key = JSON.stringify(filters);
  const { data, error, reload } = useProjectsRead<ApiBalancesTable>(true, () => timeOffApi.balances(filters), `timeoff:balances:${key}`, 'timeOffRev');
  const { data: policies } = useProjectsRead<ApiTimeOffPolicy[]>(true, () => timeOffApi.policies.list(), 'timeoff:policies', 'timeOffRev');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickers = s.peoplePickers;
  const orgRev = s.orgRev;
  useEffect(() => {
    void employeeCard.ensurePickers();
  }, [employeeCard, orgRev]);
  if (error) return <EmptyState title="Balances could not be loaded" text={error} />;
  if (!data) return <div className="ts-help">Loading</div>;

  const year = data.year;
  const rows = data.rows;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.employee.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.employee.id)));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ids = [...selected].filter((id) => rows.some((r) => r.employee.id === id));

  const changePolicy = async (target: string) => {
    setPicking(false);
    setBusy(true);
    try {
      const res = await timeOffApi.bulkPolicy(ids, target);
      flash(`${res.changed} ${res.changed === 1 ? 'employee' : 'employees'} moved to ${policies?.find((p) => p.id === target)?.name ?? 'the policy'}. It applies from next year; Recalculate applies it to ${year}.`);
      setSelected(new Set());
      await reload();
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };
  const recalculate = async () => {
    if (!ids.length) return;
    if (!(await askConfirm({ title: `Recalculate ${year} for ${ids.length} ${ids.length === 1 ? 'employee' : 'employees'}?`, message: 'Each entitlement is computed again with the employee’s current policy, start date and prior experience. Years with approved days are recalculated too.', confirmLabel: 'Recalculate' }))) return;
    setBusy(true);
    try {
      const res = await timeOffApi.bulkRecalculate(ids, year);
      flash(res.changed ? `${res.changed} ${res.changed === 1 ? 'entitlement' : 'entitlements'} changed` : 'Nothing changed');
      setSelected(new Set());
      await reload();
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };
  const exportCsv = async () => {
    setBusy(true);
    try {
      downloadBlob(`pultly-vacation-balances-${year}.csv`, await timeOffApi.balancesCsv(filters));
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(false);
  };

  const units = pickers?.units ?? [];
  const managers = (pickers?.employees ?? []).filter((e) => rows.some((r) => r.managerId === e.id));
  return (
    <div className="bal-page" data-testid="balances">
      <div className="bal-filters">
        <select className="form-input" value={filters.year ?? data.currentYear} onChange={(e) => go({ year: Number(e.target.value) === data.currentYear ? null : e.target.value })} aria-label="Year" data-testid="balances-year">
          {[data.currentYear - 1, data.currentYear, data.currentYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select className="form-input" value={filters.unitId ?? ''} onChange={(e) => go({ unit: e.target.value || null })} aria-label="Unit">
          <option value="">All units</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select className="form-input" value={filters.managerId ?? ''} onChange={(e) => go({ manager: e.target.value || null })} aria-label="Manager">
          <option value="">All managers</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName}
            </option>
          ))}
        </select>
        <select className="form-input" value={filters.policyId ?? ''} onChange={(e) => go({ policy: e.target.value || null })} aria-label="Policy">
          <option value="">All policies</option>
          {(policies ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={!!filters.expiring} onChange={(e) => go({ expiring: e.target.checked ? '1' : null })} />
          Has expiring days
        </label>
        {data.canAdjust && (
          <span style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <button type="button" className="btn-plain" disabled={busy || !ids.length || !policies?.length} onClick={() => setPicking(true)} data-testid="balances-change-policy">
              Change policy{ids.length ? ` (${ids.length})` : ''}
            </button>
            <button type="button" className="btn-plain" disabled={busy || !ids.length} onClick={() => void recalculate()} data-testid="balances-recalculate">
              Recalculate{ids.length ? ` (${ids.length})` : ''}
            </button>
            <button type="button" className="btn-plain" disabled={busy} onClick={() => void exportCsv()} data-testid="balances-csv">
              Export CSV
            </button>
          </span>
        )}
      </div>
      <div className="ap-table">
        <div className="table-head bal-row" style={{ gridTemplateColumns: COLS }}>
          <span className="th" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {data.canAdjust && <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />}
            Employee
          </span>
          <span className="th">Policy</span>
          <span className="th num">Entitlement</span>
          <span className="th num">Carried</span>
          <span className="th num">Adjust.</span>
          <span className="th num">Used</span>
          <span className="th num">Scheduled</span>
          <span className="th num">Pending</span>
          <span className="th num">Remaining</span>
          <span className="th num">Expiring 30 Jun</span>
          <span className="th">Two-week part</span>
        </div>
        {rows.length === 0 && <div className="ts-help" style={{ padding: 16 }}>Nobody matches these filters.</div>}
        {rows.map((r) => (
          <BalanceLine key={r.employee.id} r={r} canSelect={data.canAdjust} selected={selected.has(r.employee.id)} onToggle={() => toggle(r.employee.id)} />
        ))}
      </div>
      <span className="emp-note">Managers see their direct and indirect reports; Admins see everyone. A row opens the employee card.</span>
      {picking && policies && <ChangePolicyDialog policies={policies} count={ids.length} onClose={() => setPicking(false)} onPick={(id) => void changePolicy(id)} />}
    </div>
  );
}

/** The bulk "Change policy" (spec 5.5): pick a policy for the selected employees. */
function ChangePolicyDialog({ policies, count, onClose, onPick }: { policies: ApiTimeOffPolicy[]; count: number; onClose: () => void; onPick: (policyId: string) => void }) {
  const [policyId, setPolicyId] = useState(policies.find((p) => p.isDefault)?.id ?? policies[0]?.id ?? '');
  return (
    <Modal maxWidth={420} onBackdrop={onClose}>
      <ModalHeader title="Change policy" sub={`${count} ${count === 1 ? 'employee' : 'employees'} · the new policy applies from next year; Recalculate applies it to this year`} />
      <label className="policy-field">
        <span className="th">Policy</span>
        <select className="form-input" value={policyId} onChange={(e) => setPolicyId(e.target.value)} data-testid="bulk-policy-select">
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.isDefault ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!policyId} onClick={() => onPick(policyId)} data-testid="bulk-policy-go">
          Change policy
        </button>
      </div>
    </Modal>
  );
}

function BalanceLine({ r, canSelect, selected, onToggle }: { r: ApiBalanceRow; canSelect: boolean; selected: boolean; onToggle: () => void }) {
  const f = r.figures;
  return (
    <div className="table-row bal-row" style={{ gridTemplateColumns: COLS }} data-testid="balance-row" data-employee={r.employee.id}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
        {canSelect && <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${r.employee.fullName}`} />}
        <span className="ap-who">
          <Link className="ap-name" to={paths.employee(r.employee.id)}>
            {r.employee.fullName}
          </Link>
          <span className="emp-note">{[r.unit?.name, r.employee.hasStartDate ? null : 'Start date missing'].filter(Boolean).join(' · ') || r.employee.jobTitle || ''}</span>
        </span>
      </span>
      <span>{r.policy.name}</span>
      <span className="num">{f.entitlement}</span>
      <span className="num">{f.carriedOver}</span>
      <span className="num">{f.adjustments ? (f.adjustments > 0 ? `+${f.adjustments}` : f.adjustments) : '0'}</span>
      <span className="num">{f.used}</span>
      <span className="num">{f.scheduled}</span>
      <span className="num">{f.pending}</span>
      <span className="num" style={{ fontWeight: 600 }}>
        {f.remaining}
      </span>
      <span className="num">{f.carryRemaining || ''}</span>
      <span>{f.twoWeekPart ? 'Taken' : 'Not yet'}</span>
    </div>
  );
}
