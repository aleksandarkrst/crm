import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, ModalHeader } from '../../components/ui';
import type { EmploymentType } from '../../lib/api';
import { paths } from '../../lib/paths';
import { EMPLOYMENT_TYPE_LABEL } from '../../store/employeeCard';
import { useStore } from '../../store/store';
import { todayIso } from './parts';

/**
 * "Add employee" on the Org structure page (Admins, spec 4.2): the required
 * fields and a few common ones; the rest is filled in on the card, which opens after saving.
 */
export function AddEmployeeDialog({ onClose }: { onClose: () => void }) {
  const { employeeCard } = useStore();
  const navigate = useNavigate();
  const [f, setF] = useState({ firstName: '', lastName: '', workEmail: '', jobTitle: '', employmentStartDate: todayIso(), employmentType: 'permanent' as EmploymentType });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ready = f.firstName.trim() && f.lastName.trim() && f.employmentStartDate;
  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await employeeCard.create({
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      employmentStartDate: f.employmentStartDate,
      employmentType: f.employmentType,
      ...(f.workEmail.trim() ? { workEmail: f.workEmail.trim() } : {}),
      ...(f.jobTitle.trim() ? { jobTitle: f.jobTitle.trim() } : {}),
    });
    setBusy(false);
    if ('error' in r) return setError(r.error);
    onClose();
    navigate(paths.employee(r.card.id));
  };
  return (
    <Modal maxWidth={520}>
      <ModalHeader title="Add employee" sub="Department, manager, personal details and the bank account are set on the card next." />
      <div className="emp-dialog-grid emp-dialog-grid-even">
        <label className="form-label">
          First name
          <input className="form-input" name="firstName" autoFocus maxLength={100} value={f.firstName} onChange={set('firstName')} />
        </label>
        <label className="form-label">
          Last name
          <input className="form-input" name="lastName" maxLength={100} value={f.lastName} onChange={set('lastName')} />
        </label>
        <label className="form-label">
          Work email
          <input className="form-input" name="workEmail" type="email" maxLength={254} value={f.workEmail} onChange={set('workEmail')} />
        </label>
        <label className="form-label">
          Job title
          <input className="form-input" name="jobTitle" maxLength={100} value={f.jobTitle} onChange={set('jobTitle')} />
        </label>
        <label className="form-label">
          Employment start date
          <input className="form-input" name="employmentStartDate" type="date" value={f.employmentStartDate} onChange={set('employmentStartDate')} />
        </label>
        <label className="form-label">
          Employment type
          <select className="form-input" name="employmentType" value={f.employmentType} onChange={set('employmentType')}>
            {(Object.keys(EMPLOYMENT_TYPE_LABEL) as EmploymentType[]).map((t) => (
              <option key={t} value={t}>
                {EMPLOYMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <div className="emp-error">{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={ready && !busy ? 'btn btn-primary' : 'btn btn-disabled'} disabled={!ready || busy} onClick={() => void save()} data-testid="add-employee-save">
          {busy ? 'Saving…' : 'Add employee'}
        </button>
      </div>
    </Modal>
  );
}
