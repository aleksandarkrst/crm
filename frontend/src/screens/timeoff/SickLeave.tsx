import { useEffect, useState } from 'react';
import { askConfirm } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Modal, ModalHeader, Switch } from '../../components/ui';
import { downloadBlob } from '../../lib/csv';
import { type ApiSickLeave, type ApiSickLeaveType, SICK_STATUS_LABEL, type SickLeaveFilters, timeOffApi } from '../../lib/timeOffApi';
import { projectError, useProjectsRead } from '../../store/projects';
import { useStore } from '../../store/store';
import { dateLabel } from '../employee/parts';

const BADGE: Record<ApiSickLeave['status'], string> = { reported: 'badge badge-warn', confirmed: 'badge badge-brand', cancelled: 'badge badge-neutral' };
const NO_MEDICAL = 'Do not enter a diagnosis or any medical information.';
const days = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
/** "2 Nov 2026 to 6 Nov 2026", or "from 2 Nov 2026, open" until the end date is known. */
export const sickPeriod = (r: Pick<ApiSickLeave, 'startDate' | 'endDate'>) => (r.endDate ? (r.endDate === r.startDate ? dateLabel(r.startDate) : `${dateLabel(r.startDate)} to ${dateLabel(r.endDate)}`) : `From ${dateLabel(r.startDate)}, open`);

/** The sick leave types for the pickers; empty until loaded. */
function useSickTypes(enabled: boolean): ApiSickLeaveType[] {
  return useProjectsRead<ApiSickLeaveType[]>(enabled, () => timeOffApi.sickLeave.types(), 'timeoff:sick-types', 'timeOffRev').data ?? [];
}

type DialogState = { kind: 'report'; employeeId?: string } | { kind: 'confirm' | 'edit' | 'end' | 'cancel'; record: ApiSickLeave };

/**
 * Sick leave records (CD-169, spec 13.5): period, calendar and working days, status, type (the
 * employee's own and Admins only), the day-31 date, "Still open" and the interrupted time off, with
 * Set end date, Confirm, Edit and Cancel as the API allows. `withEmployee` adds the person.
 */
export function SickLeaveList({ records, withEmployee, onChanged }: { records: ApiSickLeave[]; withEmployee?: boolean; onChanged: () => void }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  if (!records.length) return <span className="emp-note">No sick leave.</span>;
  return (
    <div className="req-list" data-testid="sick-leave-list">
      {records.map((r) => (
        <div key={r.id} className="req-row" data-testid="sick-row" data-status={r.status}>
          <div className="req-main">
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {withEmployee ? `${r.employee.fullName} · ` : ''}Sick leave{r.type ? ` · ${r.type.name}` : ''}
            </span>
            <span style={{ fontSize: 13 }}>
              {sickPeriod(r)} · {days(r.calendarDays, 'calendar day')}, {days(r.workingDays, 'working day')}
            </span>
            {r.day31 && r.status !== 'cancelled' && <span className="emp-note">Day 31 from {dateLabel(r.day31)}: RFZO</span>}
            {r.stillOpen && <span className="emp-note emp-warn">Still open: check the end date</span>}
            {r.interruptedDays > 0 && <span className="emp-note">Interrupted {days(r.interruptedDays, 'day')} of approved time off</span>}
            {r.sickNoteRef && <span className="emp-note">Sick note: {r.sickNoteRef}</span>}
            {r.note && <span className="emp-note">Note: {r.note}</span>}
            {r.status === 'cancelled' && r.cancelReason && <span className="emp-note">Cancelled: {r.cancelReason}</span>}
          </div>
          <span className={BADGE[r.status]}>{SICK_STATUS_LABEL[r.status]}</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {r.canConfirm && (
              <button type="button" className="btn-plain" onClick={() => setDialog({ kind: 'confirm', record: r })} data-testid="sick-confirm">
                Confirm
              </button>
            )}
            {r.canSetEnd && !r.canEdit && (
              <button type="button" className="btn-plain" onClick={() => setDialog({ kind: 'end', record: r })} data-testid="sick-end">
                Set end date
              </button>
            )}
            {r.canEdit && (
              <button type="button" className="btn-plain" onClick={() => setDialog({ kind: 'edit', record: r })} data-testid="sick-edit">
                Edit
              </button>
            )}
            {r.canCancel && (
              <button type="button" className="btn-plain" onClick={() => setDialog({ kind: 'cancel', record: r })} data-testid="sick-cancel">
                Cancel
              </button>
            )}
          </span>
        </div>
      ))}
      {dialog && (
        <SickDialog
          state={dialog}
          onClose={(saved) => {
            setDialog(null);
            if (saved) onChanged();
          }}
        />
      )}
    </div>
  );
}

/** "Report sick leave" as a button with its dialog; `employeeId` for an employee card or My time off. */
export function ReportSickButton({ employeeId, onReported, label = 'Report sick leave' }: { employeeId?: string; onReported: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)} data-testid="sick-report">
        {label}
      </button>
      {open && (
        <SickDialog
          state={{ kind: 'report', employeeId }}
          onClose={(saved) => {
            setOpen(false);
            if (saved) onReported();
          }}
        />
      )}
    </>
  );
}

/**
 * The one dialog behind every action: report (the employee for themselves, a manager for a direct
 * report, Admins for anyone and with the type at once), confirm, edit (Admins), set the end date,
 * cancel with a reason (Admins). Admins see the note with its "no medical information" hint.
 */
function SickDialog({ state, onClose }: { state: DialogState; onClose: (saved?: boolean) => void }) {
  const { s, session, employeeCard, flash } = useStore();
  const admin = session.tenant.role === 'owner' || session.tenant.role === 'admin';
  const record = state.kind === 'report' ? null : state.record;
  const types = useSickTypes(admin && state.kind !== 'cancel' && state.kind !== 'end');
  const direct = new Set(s.people.access?.directReportIds ?? []);
  const pickable = (s.peoplePickers?.employees ?? []).filter((e) => e.status !== 'inactive' && (admin || direct.has(e.id) || e.id === s.myEmployeeId));
  useEffect(() => {
    if (state.kind === 'report' && !state.employeeId && (admin || direct.size)) void employeeCard.ensurePickers();
  }, [state, admin, direct.size, employeeCard]);
  const [employeeId, setEmployeeId] = useState(state.kind === 'report' ? (state.employeeId ?? s.myEmployeeId ?? '') : (record?.employee.id ?? ''));
  const [startDate, setStartDate] = useState(record?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(record?.endDate ?? '');
  const [typeId, setTypeId] = useState(record?.type?.id ?? '');
  const [continuationOfId, setContinuationOfId] = useState(record?.continuationOfId ?? record?.suggestedContinuationId ?? '');
  const [sickNoteRef, setSickNoteRef] = useState(record?.sickNoteRef ?? '');
  const [note, setNote] = useState(record?.note ?? '');
  const [confirmNow, setConfirmNow] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const title = { report: 'Report sick leave', confirm: 'Confirm sick leave', edit: 'Edit sick leave', end: 'Set the end date', cancel: 'Cancel this sick leave?' }[state.kind];
  const save = async () => {
    setProblem(null);
    if ((state.kind === 'confirm' || (state.kind === 'report' && confirmNow)) && !typeId) return setProblem('Pick the type to confirm it');
    if (state.kind === 'end' && !endDate) return setProblem('Pick the last sick day');
    if (state.kind === 'cancel' && !reason.trim()) return setProblem('Say why it is cancelled');
    setBusy(true);
    try {
      if (state.kind === 'report') {
        await timeOffApi.sickLeave.create({
          ...(employeeId && employeeId !== s.myEmployeeId ? { employeeId } : {}),
          startDate,
          endDate: endDate || null,
          ...(admin ? { typeId: typeId || undefined, sickNoteRef: sickNoteRef || null, note: note || null, confirm: confirmNow } : {}),
        });
        flash('Sick leave reported');
      } else if (state.kind === 'confirm') {
        await timeOffApi.sickLeave.confirm(record!.id, { typeId, endDate: endDate || null, continuationOfId: continuationOfId || null, sickNoteRef: sickNoteRef || null });
        flash('Sick leave confirmed');
      } else if (state.kind === 'edit') {
        await timeOffApi.sickLeave.update(record!.id, { startDate, endDate: endDate || null, typeId: typeId || null, continuationOfId: continuationOfId || null, sickNoteRef: sickNoteRef || null, note: note || null });
        flash('Sick leave saved');
      } else if (state.kind === 'end') {
        await timeOffApi.sickLeave.update(record!.id, { endDate });
        flash('End date set');
      } else {
        const done = await timeOffApi.sickLeave.cancel(record!.id, reason.trim());
        flash(done.notRestored ? `Cancelled. ${days(done.notRestored, 'interrupted day')} already passed and stay returned to the balance.` : 'Sick leave cancelled');
      }
      onClose(true);
    } catch (err) {
      setProblem(projectError(err));
      setBusy(false);
    }
  };
  const showFull = state.kind === 'report' || state.kind === 'edit';
  return (
    <Modal maxWidth={500} onBackdrop={() => !busy && onClose()}>
      <ModalHeader title={title} sub={record ? `${record.employee.fullName} · ${sickPeriod(record)}` : 'Leave the last day empty until the return date is known.'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="sick-dialog">
        {state.kind === 'report' && !state.employeeId && pickable.length > 1 && (
          <label className="policy-field">
            <span className="th">Employee</span>
            <select className="form-input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} data-testid="sick-employee">
              {pickable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </select>
          </label>
        )}
        {(showFull || state.kind === 'confirm' || state.kind === 'end') && (
          <div className="policy-field-row">
            {showFull && (
              <label className="policy-field">
                <span className="th">First sick day</span>
                <input className="form-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} data-testid="sick-start" />
              </label>
            )}
            <label className="policy-field">
              <span className="th">Last sick day</span>
              <input className="form-input" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} data-testid="sick-end-date" />
            </label>
          </div>
        )}
        {admin && (showFull || state.kind === 'confirm') && (
          <>
            <label className="policy-field">
              <span className="th">Type</span>
              <select className="form-input" value={typeId} onChange={(e) => setTypeId(e.target.value)} data-testid="sick-type">
                <option value="">{state.kind === 'confirm' ? 'Pick the type' : 'Not known yet'}</option>
                {types
                  .filter((t) => t.active || t.id === typeId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
              {types.find((t) => t.id === typeId)?.payerNote && <span className="emp-note">{types.find((t) => t.id === typeId)!.payerNote}</span>}
            </label>
            <label className="policy-field">
              <span className="th">Sick note reference</span>
              <input className="form-input" value={sickNoteRef} maxLength={50} placeholder="e.g. the eBolovanje number" onChange={(e) => setSickNoteRef(e.target.value)} data-testid="sick-ref" />
            </label>
            {record && (record.suggestedContinuationId || record.continuationOfId) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={!!continuationOfId} onChange={(e) => setContinuationOfId(e.target.checked ? (record.continuationOfId ?? record.suggestedContinuationId ?? '') : '')} data-testid="sick-continuation" />
                Continues the previous sick leave (counts toward day 31)
              </label>
            )}
          </>
        )}
        {admin && showFull && (
          <label className="policy-field">
            <span className="th">Note</span>
            <input className="form-input" value={note} maxLength={500} placeholder="e.g. Sick note arrives by post" onChange={(e) => setNote(e.target.value)} data-testid="sick-note" />
            <span className="emp-note">{NO_MEDICAL}</span>
          </label>
        )}
        {admin && state.kind === 'report' && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Switch on={confirmNow} onClick={() => setConfirmNow(!confirmNow)} label="Confirm it now (the sick note is here)" />
            <span style={{ fontSize: 13 }}>Confirm it now (the sick note is here)</span>
          </span>
        )}
        {state.kind === 'cancel' && (
          <label className="policy-field">
            <span className="th">Why</span>
            <input className="form-input" value={reason} maxLength={300} placeholder="e.g. Entered for the wrong person" onChange={(e) => setReason(e.target.value)} data-testid="sick-cancel-reason" />
            <span className="emp-note">Interrupted time off days still ahead go back to their requests.</span>
          </label>
        )}
        {state.kind === 'report' && <span className="emp-note">Approved time off on these days is interrupted and the days go back to the balance. The manager and the Admins are told.</span>}
        {problem && (
          <span className="emp-error" role="alert">
            {problem}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onClose()}>
            Back
          </button>
          <button type="button" className={state.kind === 'cancel' ? 'btn btn-primary btn-danger' : 'btn btn-primary'} disabled={busy} onClick={() => void save()} data-testid="sick-save">
            {{ report: 'Report', confirm: 'Confirm', edit: 'Save', end: 'Save', cancel: 'Cancel sick leave' }[state.kind]}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** One employee's sick leave (My time off, the employee card), with "Report sick leave" when allowed. */
export function EmployeeSickLeave({ employeeId, canReport }: { employeeId: string; canReport: boolean }) {
  const { data, error, reload } = useProjectsRead<ApiSickLeave[]>(true, () => timeOffApi.sickLeave.list({ employeeId }), `timeoff:sick:${employeeId}`, 'timeOffRev');
  // Someone the caller may not see (the API's 404) shows no section at all.
  if (error) return null;
  return (
    <section className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} data-testid="employee-sick-leave">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>Sick leave</span>
        {canReport && <ReportSickButton employeeId={employeeId} onReported={() => void reload()} />}
      </div>
      {data ? <SickLeaveList records={data} onChanged={() => void reload()} /> : <span className="emp-note">Loading</span>}
    </section>
  );
}

/**
 * Time off → Sick leave (CD-169, spec 13.5): managers see their reports' records without the type;
 * Admins see everyone with the type, confirm, edit, cancel and export a CSV.
 */
export function SickLeaveTab({ admin }: { admin: boolean }) {
  const { flash } = useStore();
  const [status, setStatus] = useState<ApiSickLeave['status'] | ''>('');
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState('');
  const [typeId, setTypeId] = useState('');
  const types = useSickTypes(admin);
  const filters: SickLeaveFilters = { all: true, status: status || undefined, open: open || undefined, month: month || undefined, typeId: typeId || undefined };
  const { data, error, reload } = useProjectsRead<ApiSickLeave[]>(true, () => timeOffApi.sickLeave.list(filters), `timeoff:sick:all:${status}:${open}:${month}:${typeId}`, 'timeOffRev');
  const exportCsv = async () => {
    try {
      downloadBlob('pultly-sick-leave.csv', await timeOffApi.sickLeave.csv(filters));
    } catch (err) {
      flash(projectError(err));
    }
  };
  if (error) return <EmptyState title="Sick leave could not be loaded" text={error} />;
  return (
    <div className="bal-page" data-testid="sick-tab">
      <div className="bal-filters">
        <select className="form-input" value={status} onChange={(e) => setStatus(e.target.value as ApiSickLeave['status'] | '')} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(SICK_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input className="form-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
        {admin && (
          <select className="form-input" value={typeId} onChange={(e) => setTypeId(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          Open only
        </label>
        <span style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          {admin && (
            <button type="button" className="btn btn-secondary" onClick={() => void exportCsv()}>
              Export CSV
            </button>
          )}
          <ReportSickButton onReported={() => void reload()} />
        </span>
      </div>
      <div className="card card-pad">{data ? <SickLeaveList records={data} withEmployee onChanged={() => void reload()} /> : <span className="emp-note">Loading</span>}</div>
      {!admin && <span className="emp-note">Managers see their direct and indirect reports' sick leave without its type.</span>}
    </div>
  );
}

/** Settings → Time off → Sick leave types (CD-169, spec 13.3, Admins). */
export function SickLeaveTypesCard() {
  const { flash, canEditWorkspace } = useStore();
  const { data, reload } = useProjectsRead<ApiSickLeaveType[]>(true, () => timeOffApi.sickLeave.types(), 'timeoff:sick-types', 'timeOffRev');
  const [name, setName] = useState('');
  const [payerNote, setPayerNote] = useState('');
  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      flash(done);
      void reload();
    } catch (err) {
      flash(projectError(err));
    }
  };
  const remove = async (t: ApiSickLeaveType) => {
    if (!(await askConfirm({ title: `Delete ${t.name}?`, message: 'Only a type no sick leave uses can be deleted.', confirmLabel: 'Delete', danger: true }))) return;
    await run(() => timeOffApi.sickLeave.removeType(t.id), 'Deleted');
  };
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-testid="sick-types">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Sick leave types</span>
        <span className="emp-note">Admins pick the type when they confirm a record. The payer note is shown as information for payroll; nothing is calculated from it. Managers never see the type.</span>
      </div>
      {(data ?? []).map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--divider)' }} data-testid="sick-type-row">
          <span className="req-main" style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              {t.name}
              {t.active ? '' : ' (inactive)'}
            </span>
            {t.payerNote && <span className="emp-note">{t.payerNote}</span>}
          </span>
          {canEditWorkspace && (
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-plain" onClick={() => void run(() => timeOffApi.sickLeave.updateType(t.id, { active: !t.active }), t.active ? 'Deactivated' : 'Activated')}>
                {t.active ? 'Deactivate' : 'Activate'}
              </button>
              {t.used === 0 && (
                <button type="button" className="btn-plain" onClick={() => void remove(t)}>
                  Delete
                </button>
              )}
            </span>
          )}
        </div>
      ))}
      {canEditWorkspace && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="form-input" value={name} maxLength={100} placeholder="New type" onChange={(e) => setName(e.target.value)} aria-label="New sick leave type" />
          <input className="form-input" value={payerNote} maxLength={300} placeholder="Payer note, e.g. RFZO from the first day" onChange={(e) => setPayerNote(e.target.value)} aria-label="Payer note" />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!name.trim()}
            onClick={() =>
              void run(async () => {
                await timeOffApi.sickLeave.createType({ name: name.trim(), payerNote: payerNote.trim() || null });
                setName('');
                setPayerNote('');
              }, 'Type added')
            }
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
