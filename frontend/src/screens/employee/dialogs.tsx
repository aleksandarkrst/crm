import { useEffect, useState } from 'react';
import { Modal, ModalHeader } from '../../components/ui';
import type { ApiEmployeeCard, LeavingReason } from '../../lib/api';
import { LEAVING_REASON_LABEL } from '../../store/employeeCard';
import { useStore } from '../../store/store';
import { todayIso } from './parts';

/** Dialogs of the employee card (CD-140): Deactivate, Reactivate. Invite and Link were removed by CD-226. */

function Actions({ onCancel, label, busy, disabled, onConfirm, danger }: { onCancel: () => void; label: string; busy: boolean; disabled?: boolean; onConfirm: () => void; danger?: boolean }) {
  const off = busy || disabled;
  return (
    <div className="modal-actions">
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className={off ? 'btn btn-disabled' : danger ? 'btn emp-danger' : 'btn btn-primary'} disabled={off} onClick={onConfirm}>
        {busy ? 'Working…' : label}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Deactivate (spec 4.8)

const REASONS = Object.entries(LEAVING_REASON_LABEL) as [LeavingReason, string][];

export function DeactivateDialog({ card, onClose }: { card: ApiEmployeeCard; onClose: () => void }) {
  const { s, employeeCard } = useStore();
  const ensure = employeeCard.ensurePickers;
  useEffect(() => void ensure(), [ensure]);
  const people = (s.peoplePickers?.employees ?? []).filter((e) => e.id !== card.id && e.status !== 'inactive');
  // A person leads at most one unit: those who lead another aren't offered as the new lead.
  const leads = new Set((s.peoplePickers?.units ?? []).map((u) => u.leadEmployeeId).filter(Boolean));
  const [lastDay, setLastDay] = useState(todayIso());
  const [reason, setReason] = useState<LeavingReason | ''>('');
  // Default: the leaving person's own manager (skip level), else nobody.
  const [manager, setManager] = useState<string>(card.manager?.id ?? '');
  // The new lead of the unit they lead (CD-226); the people who lead nothing else.
  const [newLead, setNewLead] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const future = lastDay > todayIso();
  const options = people.map((p) => (
    <option key={p.id} value={p.id}>
      {p.jobTitle ? `${p.fullName} · ${p.jobTitle}` : p.fullName}
    </option>
  ));
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await employeeCard.deactivate(card.id, {
      lastWorkingDay: lastDay,
      reason: reason || null,
      ...(card.directReports.length ? { reportsManagerId: manager || null } : {}),
      ...(card.leadsUnit ? { unitLeads: [{ unitId: card.leadsUnit.id, employeeId: newLead || null }] } : {}),
    });
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onClose();
  };
  return (
    <Modal maxWidth={560}>
      <ModalHeader title={`Deactivate ${card.fullName}`} sub="For someone leaving the company. Their access ends and their reports move to a new manager." />
      <div className="emp-dialog-grid">
        <label className="form-label">
          Last working day
          <input className="form-input" type="date" name="lastWorkingDay" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
        </label>
        <label className="form-label">
          Reason
          <select className="form-input" name="reason" value={reason} onChange={(e) => setReason(e.target.value as LeavingReason | '')}>
            <option value="">Not given</option>
            {REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {card.directReports.length > 0 && (
        <label className="form-label">
          New manager for {card.directReports.length === 1 ? card.directReports[0]!.fullName : `${card.directReports.length} direct reports`}
          <select className="form-input" name="reportsManagerId" value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">No manager</option>
            {card.manager && !people.some((p) => p.id === card.manager!.id) && <option value={card.manager.id}>{card.manager.fullName}</option>}
            {options}
          </select>
        </label>
      )}
      {card.leadsUnit && (
        <label className="form-label">
          New lead of {card.leadsUnit.name}
          <select className="form-input" name="newLead" value={newLead} onChange={(e) => setNewLead(e.target.value)}>
            <option value="">Nobody</option>
            {people
              .filter((p) => !leads.has(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.jobTitle ? `${p.fullName} · ${p.jobTitle}` : p.fullName}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="hint-box">
        {future
          ? `${card.fullName} keeps access and stays the manager of their reports until then. The changes apply at 00:05 the day after the last working day.`
          : `${card.fullName} becomes inactive now${card.account === 'linked' ? ' and loses access to the workspace' : ''}.`}
      </div>
      {error && <div className="emp-error">{error}</div>}
      <Actions onCancel={onClose} label={future ? 'Schedule' : 'Deactivate'} busy={busy} disabled={!lastDay} danger onConfirm={() => void submit()} />
    </Modal>
  );
}

// ------------------------------------------------------------------ Reactivate (spec 4.8)

export function ReactivateDialog({ card, onClose }: { card: ApiEmployeeCard; onClose: () => void }) {
  const { employeeCard } = useStore();
  const inactive = card.status === 'inactive';
  const [start, setStart] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    const r = await employeeCard.reactivate(card.id, inactive ? start : undefined);
    setBusy(false);
    if ('error' in r) setError(r.error);
    else onClose();
  };
  return (
    <Modal maxWidth={480}>
      <ModalHeader
        title={inactive ? `Reactivate ${card.fullName}` : `Cancel ${card.fullName}'s leaving`}
        sub={inactive ? 'For a rehire. The previous period stays in the history. They have no account until you invite them again.' : 'They stay active; nothing changes on their last working day.'}
      />
      {inactive && (
        <label className="form-label">
          New employment start date
          <input className="form-input" type="date" name="employmentStartDate" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
      )}
      {error && <div className="emp-error">{error}</div>}
      <Actions onCancel={onClose} label={inactive ? 'Reactivate' : 'Cancel leaving'} busy={busy} disabled={inactive && !start} onConfirm={() => void submit()} />
    </Modal>
  );
}
