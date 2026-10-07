import { createContext, type ReactNode, useContext } from 'react';
import type { EmployeeField } from '../../lib/api';
import type { Draft } from '../../store/cardDraft';

/**
 * Building blocks of the employee card (CD-140): a section whose fields are inputs wherever the
 * caller may change them (CD-225: one draft for the whole card, one Save in the header), the
 * field rows, labels and date formatting.
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
  unitId: 'Unit',
  departmentId: 'Department',
  teamId: 'Team',
  managerId: 'Manager',
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

export type { Draft };
type SetField = (key: string, value: string | boolean) => void;

/** The card's draft (CD-225), provided by the card: current values, a setter and what the caller may change. */
export interface CardEdit {
  values: Draft;
  setField: SetField;
  can: (f: EmployeeField) => boolean;
}
export const CardEditContext = createContext<CardEdit>({ values: {}, setField: () => {}, can: () => false });

/**
 * A card section (spec 4.5). When the caller may change any of `fields` (the server's
 * `editableFields`), it shows `edit` with the card's draft: inputs for what they may change,
 * plain values for the rest. Otherwise `view`. Saving is the header's one Save (CD-225).
 */
export function EditableSection({
  title,
  fields,
  view,
  edit,
  testId,
  extraAction,
}: {
  title: string;
  fields: EmployeeField[];
  view: ReactNode;
  edit: (draft: Draft, setField: SetField, can: (f: EmployeeField) => boolean) => ReactNode;
  testId?: string;
  extraAction?: ReactNode;
}) {
  const { values, setField, can } = useContext(CardEditContext);
  const editing = fields.some(can);
  return (
    <div className="card card-pad emp-section" data-testid={testId} data-editing={editing || undefined}>
      <div className="emp-section-head">
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        {extraAction && <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{extraAction}</span>}
      </div>
      <div className="emp-section-body">{editing ? edit(values, setField, can) : view}</div>
    </div>
  );
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
  setField: SetField;
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
  setField: SetField;
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
export function CheckField({ field, draft, setField, can, label }: { field: EmployeeField; draft: Draft; setField: SetField; can: (f: EmployeeField) => boolean; label?: string }) {
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
