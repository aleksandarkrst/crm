import { type ReactNode, useState } from 'react';
import type { ApiEmployeeCard, EmployeeField, EmployeePatch } from '../../lib/api';
import { useStore } from '../../store/store';

/**
 * Building blocks of the employee card (CD-140): a section that edits in place with Save and
 * Cancel, the field rows, labels and date formatting.
 */

/** "3 Oct 2026" for `yyyy-mm-dd`. */
export function dateLabel(date: string | null | undefined): string {
  if (!date) return '';
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Today in this browser, `yyyy-mm-dd`. */
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Field names as the card and its history show them. */
export const FIELD_LABEL: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  workEmail: 'Work email',
  jobTitle: 'Job title',
  workPhone: 'Work phone',
  workLocation: 'Work location',
  employeeNumber: 'Employee number',
  employmentStartDate: 'Employment start date',
  employmentType: 'Employment type',
  weeklyHours: 'Weekly hours',
  timesheetRequired: 'Timesheet required',
  attendanceTracked: 'Attendance tracked',
  employmentEndDate: 'Employment end date',
  deactivatedAt: 'Deactivated',
  leavingReason: 'Reason for leaving',
  departmentId: 'Department',
  teamId: 'Team',
  managerId: 'Reports to',
  userId: 'Account',
  dateOfBirth: 'Date of birth',
  privateEmail: 'Private email',
  privatePhone: 'Private phone',
  addressStreet: 'Street and number',
  addressPostalCode: 'Postal code',
  addressCity: 'City',
  addressCountry: 'Country',
  emergencyContactName: 'Emergency contact',
  emergencyContactPhone: "Emergency contact's phone",
  iban: 'IBAN',
  bankName: 'Bank',
  fxSameAsIban: 'Foreign currency account same as IBAN',
  fxIban: 'Foreign currency IBAN',
  swiftBic: 'SWIFT/BIC',
  fxBankName: 'Foreign currency bank',
  fxBankAddress: "Foreign currency bank's address",
};

/** A label and its value (or editor) in a section. */
export function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="emp-row" data-testid={testId}>
      <span className="emp-row-label">{label}</span>
      <span className="emp-row-value">{children}</span>
    </div>
  );
}

/** A value, or a muted dash when there is none. */
export function Val({ v, hint }: { v: ReactNode; hint?: string }) {
  if (v === null || v === undefined || v === '') return <span className="emp-empty">{hint ?? '—'}</span>;
  return <>{v}</>;
}

export type Draft = Record<string, string | boolean>;

/**
 * A card section that edits in place (spec 4.5): "Edit" when the caller may change any of
 * `fields` (the server's `editableFields`), then Save and Cancel. Save sends only the fields that
 * changed; a 409 shows the conflict message and the card as it is now.
 */
export function EditableSection({
  card,
  title,
  fields,
  initial,
  toPatch,
  view,
  edit,
  testId,
  extraAction,
}: {
  card: ApiEmployeeCard;
  title: string;
  fields: EmployeeField[];
  /** The draft's starting values (strings for inputs, booleans for switches). */
  initial: () => Draft;
  /** The draft as API values; return a string to refuse saving with that message. */
  toPatch?: (draft: Draft) => EmployeePatch | string;
  view: ReactNode;
  edit: (draft: Draft, setField: (key: string, value: string | boolean) => void, can: (f: EmployeeField) => boolean) => ReactNode;
  testId?: string;
  extraAction?: ReactNode;
}) {
  const { employeeCard } = useStore();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = new Set(card.permissions.editableFields);
  const can = (f: EmployeeField) => editable.has(f);
  const canEdit = fields.some(can);

  const start = () => {
    setError(null);
    setDraft(initial());
  };
  const save = async () => {
    if (!draft) return;
    const base = initial();
    const changed: Draft = {};
    for (const [k, v] of Object.entries(draft)) if (v !== base[k] && can(k as EmployeeField)) changed[k] = v;
    const patch = toPatch ? toPatch(changed) : defaultPatch(changed);
    if (typeof patch === 'string') return setError(patch);
    setBusy(true);
    const result = await employeeCard.save(card.id, patch);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      if (result.conflict) setDraft(null);
      return;
    }
    setDraft(null);
  };

  return (
    <div className="card card-pad emp-section" data-testid={testId}>
      <div className="emp-section-head">
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {extraAction}
          {canEdit && !draft && (
            <button type="button" className="btn-outline emp-edit" onClick={start}>
              Edit
            </button>
          )}
        </span>
      </div>
      <div className="emp-section-body">
        {draft ? edit(draft, (key, value) => setDraft((d) => ({ ...(d ?? {}), [key]: value })), can) : view}
        {error && (
          <div className="emp-error" role="alert">
            {error}
          </div>
        )}
        {draft && (
          <div className="emp-section-actions">
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className={busy ? 'btn btn-disabled' : 'btn btn-primary'} disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Text as typed; '' clears the field (null). */
export function defaultPatch(changed: Draft): EmployeePatch {
  const patch: EmployeePatch = {};
  for (const [k, v] of Object.entries(changed)) patch[k as EmployeeField] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v;
  return patch;
}

/** A text input row in an editing section; read-only when the caller may not change the field. */
export function TextField({
  field,
  draft,
  setField,
  can,
  type = 'text',
  placeholder,
  maxLength,
}: {
  field: EmployeeField;
  draft: Draft;
  setField: (key: string, value: string | boolean) => void;
  can: (f: EmployeeField) => boolean;
  type?: 'text' | 'email' | 'tel' | 'date' | 'number';
  placeholder?: string;
  maxLength?: number;
}) {
  const value = String(draft[field] ?? '');
  return (
    <Row label={FIELD_LABEL[field] ?? field}>
      {can(field) ? (
        <input className="form-input emp-input" aria-label={FIELD_LABEL[field]} name={field} type={type} value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => setField(field, e.target.value)} />
      ) : (
        <Val v={value} />
      )}
    </Row>
  );
}

/** A select row in an editing section. */
export function SelectField({
  field,
  draft,
  setField,
  can,
  options,
  label,
}: {
  field: EmployeeField;
  draft: Draft;
  setField: (key: string, value: string | boolean) => void;
  can: (f: EmployeeField) => boolean;
  options: { value: string; label: string }[];
  label?: string;
}) {
  const value = String(draft[field] ?? '');
  return (
    <Row label={label ?? FIELD_LABEL[field] ?? field}>
      {can(field) ? (
        <select className="form-input emp-input" aria-label={label ?? FIELD_LABEL[field]} name={field} value={value} onChange={(e) => setField(field, e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <Val v={options.find((o) => o.value === value)?.label} />
      )}
    </Row>
  );
}

/** A yes/no row in an editing section. */
export function CheckField({ field, draft, setField, can, label }: { field: EmployeeField; draft: Draft; setField: (key: string, value: string | boolean) => void; can: (f: EmployeeField) => boolean; label?: string }) {
  const on = draft[field] === true;
  return (
    <Row label={label ?? FIELD_LABEL[field] ?? field}>
      {can(field) ? (
        <label className="emp-check">
          <input type="checkbox" name={field} checked={on} onChange={(e) => setField(field, e.target.checked)} />
          {on ? 'Yes' : 'No'}
        </label>
      ) : (
        <span>{on ? 'Yes' : 'No'}</span>
      )}
    </Row>
  );
}
