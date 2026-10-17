import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { downloadBlob } from '../../lib/csv';
import { paths } from '../../lib/paths';
import { type ApiApprovalRow, type ApiSickLeave, type ApiTimeOffRequest, REQUEST_STATUS_LABEL, SICK_STATUS_LABEL, TIME_OFF_TYPE_LABEL, timeOffApi } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { RejectDialog } from './Approvals';
import { RequestDialog } from './RequestDialog';
import { periodLabel, RequestsList } from './RequestsList';
import { type DialogState, ReportSickButton, SickDialog, SickLeaveList } from './SickLeave';

/** The status filter: a sick leave that is reported but not confirmed yet counts as pending. */
type Status = 'pending' | 'approved' | 'rejected' | 'cancelled' | '';
const STATUSES: { value: Status; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled or withdrawn' },
  { value: '', label: 'All statuses' },
];
const BADGE: Record<Exclude<Status, ''>, string> = { pending: 'badge badge-warn', approved: 'badge badge-brand', rejected: 'badge badge-danger', cancelled: 'badge badge-neutral' };

interface Row {
  key: string;
  employee: { id: string; fullName: string };
  what: string;
  period: string;
  start: string;
  days: number;
  status: Exclude<Status, ''>;
  statusLabel: string;
  request?: ApiTimeOffRequest;
  sick?: ApiSickLeave;
}

const requestStatus = (s: ApiTimeOffRequest['status']): Exclude<Status, ''> => (s === 'withdrawn' ? 'cancelled' : s);
const sickStatus = (s: ApiSickLeave['status']): Exclude<Status, ''> => (s === 'reported' ? 'pending' : s === 'confirmed' ? 'approved' : 'cancelled');

/**
 * Time off → Approvals (CD-350): one table of every request and sick leave record the caller may
 * see (managers their reports, Admins everyone), filtered by status (Pending by default). Pending
 * requests the caller decides have Approve and Reject; a reported sick leave an Admin may confirm
 * has Confirm. Requesting for an employee and the sick leave CSV are for Admins.
 */
export function RequestsTable({ admin, myEmployeeId }: { admin: boolean; myEmployeeId: string | null }) {
  const { s, flash, employeeCard } = useStore();
  const [status, setStatus] = useState<Status>('pending');
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApiTimeOffRequest | null>(null);
  const [sickDialog, setSickDialog] = useState<DialogState | null>(null);
  const [recording, setRecording] = useState(false);
  /** The row opened below itself with every action it has (cancel, shorten, withdraw, edit, set end date). */
  const [openKey, setOpenKey] = useState<string | null>(null);
  const requests = useProjectsRead<ApiTimeOffRequest[]>(true, () => timeOffApi.requests.list({ all: true }), 'timeoff:requests:all:', 'timeOffRev');
  const sick = useProjectsRead<ApiSickLeave[]>(true, () => timeOffApi.sickLeave.list({ all: true }), 'timeoff:sick:all::false::', 'timeOffRev');
  const decide = useProjectsRead<ApiApprovalRow[]>(true, () => timeOffApi.approvals.list(), 'timeoff:approvals', 'timeOffRev');
  const orgRev = s.orgRev;
  useEffect(() => {
    if (admin) void employeeCard.ensurePickers();
  }, [admin, employeeCard, orgRev]);

  const decidable = useMemo(() => new Set((decide.data ?? []).map((r) => r.id)), [decide.data]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const r of requests.data ?? []) {
      out.push({ key: `r:${r.id}`, employee: r.employee, what: `${TIME_OFF_TYPE_LABEL[r.type]}${r.reason ? ` · ${r.reason.name}` : ''}`, period: periodLabel(r), start: r.startDate, days: r.workingDays, status: requestStatus(r.status), statusLabel: REQUEST_STATUS_LABEL[r.status], request: r });
    }
    for (const r of sick.data ?? []) {
      out.push({
        key: `s:${r.id}`,
        employee: r.employee,
        what: `Sick leave${r.type ? ` · ${r.type.name}` : ''}`,
        period: periodLabel({ startDate: r.startDate, endDate: r.endDate ?? r.startDate }) + (r.endDate ? '' : ', still open'),
        start: r.startDate,
        days: r.workingDays,
        status: sickStatus(r.status),
        statusLabel: r.status === 'reported' ? 'Not confirmed yet' : SICK_STATUS_LABEL[r.status],
        sick: r,
      });
    }
    return out.sort((a, b) => b.start.localeCompare(a.start) || a.employee.fullName.localeCompare(b.employee.fullName));
  }, [requests.data, sick.data]);
  const shown = status ? rows.filter((r) => r.status === status) : rows;
  const reload = () => {
    void requests.reload();
    void sick.reload();
    void decide.reload();
  };

  const approve = async (r: ApiTimeOffRequest) => {
    setBusy(r.id);
    try {
      await timeOffApi.requests.approve(r.id);
      flash(`Approved: ${r.employee.fullName}, ${periodLabel(r)}`);
      reload();
    } catch (err) {
      flash(projectError(err));
    }
    setBusy(null);
  };
  const exportSick = async () => {
    try {
      downloadBlob('pultly-sick-leave.csv', await timeOffApi.sickLeave.csv({ all: true }));
    } catch (err) {
      flash(projectError(err));
    }
  };

  const error = requests.error ?? sick.error;
  if (error) return <EmptyState title="Requests could not be loaded" text={error} />;
  const employees = (s.peoplePickers?.employees ?? []).filter((e) => e.status !== 'inactive').map((e) => ({ id: e.id, fullName: e.fullName }));
  const counts = Object.fromEntries(STATUSES.map((x) => [x.value, x.value ? rows.filter((r) => r.status === x.value).length : rows.length]));

  return (
    <div className="bal-page" data-testid="requests-table">
      <div className="bal-filters">
        <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="Status" data-testid="requests-status">
          {STATUSES.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label} ({counts[x.value]})
            </option>
          ))}
        </select>
        <span style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {admin && (
            <button type="button" className="btn-plain" onClick={() => void exportSick()} data-testid="sick-csv">
              Export sick leave CSV
            </button>
          )}
          <ReportSickButton onReported={reload} />
          {admin && (
            <button type="button" className="btn btn-primary" onClick={() => setRecording(true)} disabled={!employees.length} data-testid="request-record-new">
              Request for an employee
            </button>
          )}
        </span>
      </div>
      <div className="ap-table">
        <div className="table-head rq-row">
          <span className="th">Employee</span>
          <span className="th">Type</span>
          <span className="th">Dates</span>
          <span className="th num">Working days</span>
          <span className="th">Status</span>
          <span className="th" />
        </div>
        {!requests.data || !sick.data ? (
          <div className="ts-help" style={{ padding: 16 }}>
            Loading
          </div>
        ) : shown.length === 0 ? (
          <div className="ts-help" style={{ padding: 16 }} data-testid="requests-empty">
            {status === 'pending' ? 'Nothing is waiting for a decision.' : 'No requests with this status.'}
          </div>
        ) : (
          shown.map((r) => (
            <Fragment key={r.key}>
            <div className="table-row rq-row" data-testid="requests-row" data-status={r.status}>
              <span className="rq-cell" data-label="Employee">
                <Link to={paths.employee(r.employee.id)} style={{ color: 'var(--ink)', fontWeight: 500 }}>
                  {r.employee.fullName}
                </Link>
              </span>
              <span className="rq-cell" data-label="Type">
                {r.what}
              </span>
              <span className="rq-cell" data-label="Dates">
                {r.period}
              </span>
              <span className="rq-cell num" data-label="Working days">
                {r.days}
              </span>
              <span className="rq-cell" data-label="Status">
                <span className={BADGE[r.status]}>{r.statusLabel}</span>
              </span>
              <span className="rq-actions">
                {r.request && r.request.status === 'pending' && decidable.has(r.request.id) && (
                  <>
                    <button type="button" className="btn-plain" disabled={busy !== null} onClick={() => setRejecting(r.request!)} data-testid="request-reject">
                      Reject
                    </button>
                    <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void approve(r.request!)} data-testid="request-approve">
                      {busy === r.request.id ? 'Approving…' : 'Approve'}
                    </button>
                  </>
                )}
                <button type="button" className="btn-plain" aria-expanded={openKey === r.key} onClick={() => setOpenKey(openKey === r.key ? null : r.key)} data-testid="request-details">
                  {openKey === r.key ? 'Hide' : 'Details'}
                </button>
                {r.sick?.canConfirm && (
                  <button type="button" className="btn-plain" onClick={() => setSickDialog({ kind: 'confirm', record: r.sick! })} data-testid="sick-confirm">
                    Confirm
                  </button>
                )}
              </span>
            </div>
            {openKey === r.key && (
              <div className="rq-details" data-testid="request-details-panel">
                {r.request && <RequestsList requests={[r.request]} onChanged={reload} />}
                {r.sick && <SickLeaveList records={[r.sick]} onChanged={reload} />}
              </div>
            )}
            </Fragment>
          ))
        )}
      </div>
      <span className="emp-note">Managers see their direct and indirect reports; Admins see everyone. Details opens a request with everything you can do with it.</span>
      {rejecting && (
        <RejectDialog
          request={rejecting}
          onClose={(done) => {
            setRejecting(null);
            if (done) reload();
          }}
        />
      )}
      {sickDialog && (
        <SickDialog
          state={sickDialog}
          onClose={(saved) => {
            setSickDialog(null);
            if (saved) reload();
          }}
        />
      )}
      {recording && (
        <RequestDialog
          employeeId={myEmployeeId ?? employees[0]?.id ?? ''}
          employees={employees}
          admin={admin}
          onClose={(saved) => {
            setRecording(false);
            if (saved) reload();
          }}
        />
      )}
    </div>
  );
}
