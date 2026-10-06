import { useState } from 'react';
import type { ApiDepartment, ApiEmployee, ApiEmployeePersonalExport, ApiTeam } from '../../lib/api';
import { type CsvColumn, datedName, downloadText, toCsv } from '../../lib/csv';
import { Modal, ModalHeader } from '../../components/ui';
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

/** "Set department and team" (spec 5.4): a department, and a team of it or "No team". */
export function SetOrgDialog({ count, departments, teams, onSave, onClose }: { count: number; departments: ApiDepartment[]; teams: ApiTeam[]; onSave: (departmentId: string | null, teamId: string | null) => Promise<string | null>; onClose: () => void }) {
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const own = teams.filter((t) => t.departmentId === departmentId);
  const { busy, error, save } = useSave(() => onSave(departmentId || null, teamId || null), onClose);
  return (
    <Modal maxWidth={460} onBackdrop={onClose}>
      <ModalHeader title="Set department and team" sub={`For ${people(count)}. People in another team move to this one.`} />
      <label className="form-label">
        Department
        <select className="form-input" data-testid="org-set-department" value={departmentId} onChange={(e) => (setDepartmentId(e.target.value), setTeamId(''))}>
          <option value="">No department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-label">
        Team
        <select className="form-input" data-testid="org-set-team" value={teamId} disabled={!departmentId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">No team</option>
          {own.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <Footer busy={busy} error={error} onCancel={onClose} onSave={save} save="Save" testId="org-set-org-save" />
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

/** A person dropped on a team or department box (spec 6.3): asks before moving them. */
export function MoveDialog({ employee, target, onSave, onClose }: { employee: ApiEmployee; target: string; onSave: () => Promise<string | null>; onClose: () => void }) {
  const { busy, error, save } = useSave(onSave, onClose);
  return (
    <Modal maxWidth={440} onBackdrop={onClose}>
      <ModalHeader title={`Move ${employee.fullName}?`} sub={`From ${[employee.departmentName, employee.teamName].filter(Boolean).join(', ') || 'no department'} to ${target}. Their manager stays the same.`} />
      <Footer busy={busy} error={error} onCancel={onClose} onSave={save} save="Move" testId="org-move-save" />
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
