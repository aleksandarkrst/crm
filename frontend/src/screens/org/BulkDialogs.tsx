import { useState } from 'react';
import type { ApiEmployee, ApiEmployeePersonalExport, ApiOrgUnit } from '../../lib/api';
import { type CsvColumn, datedName, downloadText, toCsv } from '../../lib/csv';
import { Modal, ModalHeader } from '../../components/ui';
import { unitPathLabel, unitTree } from '../../store/people';
import type { Column } from './columns';
import { EmployeePicker } from './parts';

const people = (n: number) => (n === 1 ? '1 employee' : `${n} employees`);

function Footer({ busy, error, onCancel, onSave, save, testId, disabled }: { busy: boolean; error: string | null; onCancel: () => void; onSave: () => void; save: string; testId: string; disabled?: boolean }) {
  return (
    <>
      {error && (
        <div className="org-dialog-error" role="alert" data-testid="org-dialog-error">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" data-testid={testId} disabled={busy || disabled} onClick={onSave}>
          {busy ? 'Saving…' : save}
        </button>
      </div>
    </>
  );
}

/** Runs a save, keeping the dialog open with the server's message when it fails. */
function useSave(run: () => Promise<string | null>, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    const err = await run();
    setBusy(false);
    if (err) setError(err);
    else onDone();
  };
  return { busy, error, save };
}

/** "Set unit" (spec 5.4, CD-226): one unit (shown with its path) or "No unit". Managers follow the org rules. */
export function SetUnitDialog({ count, units, onSave, onClose }: { count: number; units: ApiOrgUnit[]; onSave: (unitId: string | null) => Promise<string | null>; onClose: () => void }) {
  const [unitId, setUnitId] = useState('');
  const { busy, error, save } = useSave(() => onSave(unitId || null), onClose);
  return (
    <Modal maxWidth={460} onBackdrop={onClose}>
      <ModalHeader title="Set unit" sub={`For ${people(count)}. Each gets the unit's lead as manager (else the nearest lead above, else the CEO).`} />
      <label className="form-label">
        Unit
        <select className="form-input" data-testid="org-set-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">No unit</option>
          {unitTree(units).map(({ unit }) => (
            <option key={unit.id} value={unit.id}>
              {unitPathLabel(units, unit.id)}
            </option>
          ))}
        </select>
      </label>
      <Footer busy={busy} error={error} onCancel={onClose} onSave={save} save="Save" testId="org-set-unit-save" />
    </Modal>
  );
}

/** "Set manager" (spec 5.4): one employee, or nobody. The server refuses loops and names them. */
export function SetManagerDialog({ count, employees, exclude, onSave, onClose }: { count: number; employees: ApiEmployee[]; exclude: ReadonlySet<string>; onSave: (managerId: string | null) => Promise<string | null>; onClose: () => void }) {
  const [managerId, setManagerId] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const candidates = employees.filter((e) => e.status !== 'inactive' && !exclude.has(e.id));
  const { busy, error, save } = useSave(() => onSave(managerId), onClose);
  return (
    <Modal maxWidth={460} onBackdrop={onClose}>
      <ModalHeader title="Set manager" sub={`${people(count)} will report to this person.`} />
      <label className="form-label">
        Reports to
        <EmployeePicker employees={candidates} value={managerId} onChange={(id) => (setManagerId(id), setChosen(true))} placeholder="Search by name or job title" testId="org-set-manager" none="No manager" autoFocus inline />
      </label>
      {chosen && !managerId && <div className="org-person-sub">They will have no manager.</div>}
      <Footer busy={busy} error={error} onCancel={onClose} onSave={save} disabled={!chosen} save="Save" testId="org-set-manager-save" />
    </Modal>
  );
}

/**
 * A person dropped on a unit box (spec 6.3, CD-226): asks before moving them, saying who becomes
 * their manager (the org rules: the unit's lead, else the nearest lead above, else the CEO).
 */
export function MoveDialog({ employee, target, from, manager, onSave, onClose }: { employee: ApiEmployee; target: string; from: string; manager: string | null; onSave: () => Promise<string | null>; onClose: () => void }) {
  const { busy, error, save } = useSave(onSave, onClose);
  const managerText = manager ? ` ${manager} becomes their manager.` : ' Their manager stays the same.';
  return (
    <Modal maxWidth={440} onBackdrop={onClose}>
      <ModalHeader title={`Move ${employee.fullName}?`} sub={`From ${from || 'no unit'} to ${target}.${managerText}`} />
      <Footer busy={busy} error={error} onCancel={onClose} onSave={save} save="Move" testId="org-move-save" />
    </Modal>
  );
}

/**
 * A person dropped on another person (CD-226, both charts): asks before making the second one the
 * manager, saying which unit the person moves to (the one the manager leads, else the manager's own).
 */
export function ManagerDropDialog({ employee, manager, unit, onSave, onClose }: { employee: ApiEmployee; manager: ApiEmployee; unit: string | null; onSave: () => Promise<string | null>; onClose: () => void }) {
  const { busy, error, save } = useSave(onSave, onClose);
  return (
    <Modal maxWidth={440} onBackdrop={onClose}>
      <ModalHeader title={`Make ${manager.fullName} the manager of ${employee.fullName}?`} sub={unit ? `${employee.fullName} moves to ${unit}.` : `${employee.fullName} stays in their unit.`} />
      <Footer busy={busy} error={error} onCancel={onClose} onSave={save} save="Set manager" testId="org-boss-save" />
    </Modal>
  );
}

const PERSONAL_COLUMNS: CsvColumn<ApiEmployeePersonalExport>[] = [
  { header: 'Date of birth', value: (p) => p.personal.dateOfBirth },
  { header: 'Private email', value: (p) => p.personal.privateEmail },
  { header: 'Private phone', value: (p) => p.personal.privatePhone },
  { header: 'Street', value: (p) => p.personal.addressStreet },
  { header: 'Postal code', value: (p) => p.personal.addressPostalCode },
  { header: 'City', value: (p) => p.personal.addressCity },
  { header: 'Country', value: (p) => p.personal.addressCountry },
  { header: 'Emergency contact', value: (p) => p.personal.emergencyContactName },
  { header: 'Emergency contact phone', value: (p) => p.personal.emergencyContactPhone },
  { header: 'IBAN', value: (p) => p.bank.iban },
  { header: 'Bank', value: (p) => p.bank.bankName },
  { header: 'Foreign currency IBAN', value: (p) => (p.bank.fxSameAsIban ? p.bank.iban : p.bank.fxIban) },
  { header: 'SWIFT/BIC', value: (p) => p.bank.swiftBic },
  { header: 'Foreign currency bank', value: (p) => p.bank.fxBankName },
  { header: 'Foreign currency bank address', value: (p) => p.bank.fxBankAddress },
];

/**
 * Export CSV (spec 5.4, Admins): the rows with the visible columns. "Include
 * personal details and bank accounts" reads them from the server, which writes an audit entry.
 */
export function ExportDialog({ rows, columns, selected, loadPersonal, onClose, onDone }: { rows: ApiEmployee[]; columns: Column[]; selected: boolean; loadPersonal: (ids: string[]) => Promise<ApiEmployeePersonalExport[]>; onClose: () => void; onDone: (msg: string) => void }) {
  const [personal, setPersonal] = useState(false);
  const { busy, error, save } = useSave(async () => {
    try {
      const extra = personal ? new Map((await loadPersonal(rows.map((r) => r.id))).map((p) => [p.id, p])) : null;
      const csvColumns: CsvColumn<ApiEmployee>[] = columns.map((c) => ({ header: c.label, value: (e) => c.text(e) }));
      if (extra) for (const pc of PERSONAL_COLUMNS) csvColumns.push({ header: pc.header, value: (e) => (extra.has(e.id) ? pc.value(extra.get(e.id)!) : null) });
      downloadText(datedName(personal ? 'employees-personal' : 'employees'), toCsv(rows, csvColumns));
      onDone(`Exported ${people(rows.length)}`);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }, onClose);
  return (
    <Modal maxWidth={480} onBackdrop={onClose}>
      <ModalHeader title={selected ? 'Export selected' : 'Export CSV'} sub={`${people(rows.length)} with the columns of the list.`} />
      <label className="org-export-check">
        <input type="checkbox" data-testid="org-export-personal" checked={personal} onChange={(e) => setPersonal(e.target.checked)} />
        <span>
          Include personal details and bank accounts
          <span className="org-person-sub">Full IBANs. The export is recorded in the audit log with your name and the number of rows.</span>
        </span>
      </label>
      <Footer busy={busy} error={error} onCancel={onClose} onSave={save} save="Export" testId="org-export-save" />
    </Modal>
  );
}
