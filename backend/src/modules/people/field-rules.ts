import type { CallerAccess } from './caller-access';

/**
 * The fields of an employee card, grouped by who may see and change them (spec 4.2–4.5, 9.3).
 * Names are the API's (PATCH /api/people/employees/:id) and the history's `field`.
 */
export const WORK_FIELDS = ['firstName', 'lastName', 'workEmail', 'jobTitle', 'workPhone', 'workLocation'] as const;
/** Employment fields: seen by self, managers above (any depth), Administration, Admin. */
export const EMPLOYMENT_FIELDS = ['employeeNumber', 'employmentStartDate', 'employmentType', 'weeklyHours', 'timesheetRequired', 'attendanceTracked'] as const;
/** Department, team and reports to: Administration and Admin, never on your own card unless Admin. */
export const ORG_FIELDS = ['departmentId', 'teamId', 'managerId'] as const;
export const PERSONAL_FIELDS = [
  'dateOfBirth',
  'privateEmail',
  'privatePhone',
  'addressStreet',
  'addressPostalCode',
  'addressCity',
  'addressCountry',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;
export const BANK_FIELDS = ['iban', 'bankName', 'fxSameAsIban', 'fxIban', 'swiftBic', 'fxBankName', 'fxBankAddress'] as const;
/** Set only by deactivation and reactivation (spec 4.8), never by PATCH; shown like employment fields. */
export const LEAVING_FIELDS = ['employmentEndDate', 'deactivatedAt'] as const;

export type EmployeeField = (typeof WORK_FIELDS | typeof EMPLOYMENT_FIELDS | typeof ORG_FIELDS | typeof PERSONAL_FIELDS | typeof BANK_FIELDS)[number];
export const EDITABLE_FIELDS: readonly EmployeeField[] = [...WORK_FIELDS, ...EMPLOYMENT_FIELDS, ...ORG_FIELDS, ...PERSONAL_FIELDS, ...BANK_FIELDS];

/** What an employee changes on their own card without an HR role (spec 4.5). */
const SELF_SERVICE: readonly EmployeeField[] = ['workPhone', ...PERSONAL_FIELDS];

/**
 * The fields the caller may change on employee `employeeId`'s card (spec 4.5, 9.3):
 * - Admin: everything, their own card included.
 * - Administration: everything on others' cards; on their own, work fields, personal details and
 *   the bank account, but no employment fields, department, team or manager.
 * - Everyone else: only their own card's work phone and personal details, plus the bank account
 *   when the workspace allows it (`selfEditBank`, Settings → Employees).
 */
export function editableFields(access: CallerAccess, employeeId: string, selfEditBank: boolean): EmployeeField[] {
  if (access.isAdmin) return [...EDITABLE_FIELDS];
  const self = access.isSelf(employeeId);
  if (access.isAdministration) return self ? [...WORK_FIELDS, ...PERSONAL_FIELDS, ...BANK_FIELDS] : [...EDITABLE_FIELDS];
  if (self) return [...SELF_SERVICE, ...(selfEditBank ? BANK_FIELDS : [])];
  return [];
}

const PERSONAL_SET = new Set<string>(PERSONAL_FIELDS);
const BANK_SET = new Set<string>(BANK_FIELDS);
const EMPLOYMENT_SET = new Set<string>([...EMPLOYMENT_FIELDS, ...LEAVING_FIELDS]);

/**
 * Whether the caller may see a history row's field of employee `employeeId` (spec 4.5, 9.5):
 * personal and bank fields like the card's sections, employment fields like the employment
 * section, the reason for leaving only for Administration and Admin.
 */
export function canSeeHistoryField(access: CallerAccess, employeeId: string, field: string | null): boolean {
  if (!field) return true;
  if (field === 'leavingReason') return access.canSeeLeavingReason;
  if (PERSONAL_SET.has(field)) return access.canSeePersonal(employeeId);
  if (BANK_SET.has(field)) return access.canSeeBank(employeeId);
  if (EMPLOYMENT_SET.has(field)) return access.canSeeEmployment(employeeId);
  return true;
}

/** "the job title", for messages ("You can't change the job title on your own card"). */
export const FIELD_LABELS: Record<string, string> = {
  firstName: 'the first name',
  lastName: 'the last name',
  workEmail: 'the work email',
  jobTitle: 'the job title',
  workPhone: 'the work phone',
  workLocation: 'the work location',
  employeeNumber: 'the employee number',
  employmentStartDate: 'the employment start date',
  employmentType: 'the employment type',
  weeklyHours: 'the weekly hours',
  timesheetRequired: '"Timesheet required"',
  attendanceTracked: '"Attendance tracked"',
  departmentId: 'the department',
  teamId: 'the team',
  managerId: 'the manager',
  dateOfBirth: 'the date of birth',
  privateEmail: 'the private email',
  privatePhone: 'the private phone',
  addressStreet: 'the street',
  addressPostalCode: 'the postal code',
  addressCity: 'the city',
  addressCountry: 'the country',
  emergencyContactName: 'the emergency contact',
  emergencyContactPhone: "the emergency contact's phone",
  iban: 'the IBAN',
  bankName: 'the bank',
  fxSameAsIban: 'the foreign currency account',
  fxIban: 'the foreign currency IBAN',
  swiftBic: 'the SWIFT/BIC',
  fxBankName: 'the foreign currency bank',
  fxBankAddress: "the foreign currency bank's address",
};

/** "the department, the team and the manager". */
export function listFields(fields: string[]): string {
  const names = fields.map((f) => FIELD_LABELS[f] ?? f);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
