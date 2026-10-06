import { z } from 'zod';
import { EMPLOYMENT_TYPES } from '../../shared/database/schema';
import { IdList, nonEmptyPatch, optionalText } from '../../shared/validation/common';
import { INVALID_ACCOUNT_MESSAGE, parseBankAccount, parseSwiftBic } from './iban';
import { cleanName } from './search';

/** yyyy-mm-dd, a real date. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a valid date');

const today = () => new Date().toISOString().slice(0, 10);
const shiftYears = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;

const personName = z
  .string()
  .transform(cleanName)
  .pipe(z.string().min(1, 'Required').max(100, 'At most 100 characters'));

/** Empty text clears it; otherwise a valid email, stored lower-case. */
const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toLowerCase()) : v),
  z.email('Not a valid email address').max(254).nullish(),
);

/** An IBAN or Serbian domestic account number (spec 4.4), parsed; empty clears it. */
const bankAccount = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .max(64)
    .transform((v, ctx) => {
      const parsed = parseBankAccount(v);
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: INVALID_ACCOUNT_MESSAGE });
        return z.NEVER;
      }
      return parsed;
    })
    .nullish(),
);

const swiftBic = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .max(20)
    .transform((v, ctx) => {
      const parsed = parseSwiftBic(v);
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: 'SWIFT/BIC has 8 or 11 characters, e.g. AIKBRS22' });
        return z.NEVER;
      }
      return parsed;
    })
    .nullish(),
);

/** Spec 4.2: not more than one year ahead. Required in forms, so never cleared by PATCH. */
const startDate = isoDate.refine((d) => d <= shiftYears(today(), 1), 'The start date can be at most one year ahead');
/** Spec 4.3: the person is between 15 and 100 years old. */
const dateOfBirth = isoDate.refine((d) => d <= shiftYears(today(), -15) && d >= shiftYears(today(), -100), 'The person must be between 15 and 100 years old').nullish();

const fields = {
  // Work (spec 4.2)
  firstName: personName,
  lastName: personName,
  workEmail: optionalEmail,
  employeeNumber: optionalText(30),
  jobTitle: optionalText(100),
  /** The org unit (CD-226; departments and teams before). */
  unitId: z.uuid().nullish(),
  managerId: z.uuid().nullish(),
  workPhone: optionalText(40),
  workLocation: optionalText(100),
  employmentStartDate: startDate,
  employmentType: z.enum(EMPLOYMENT_TYPES),
  weeklyHours: z
    .number()
    .min(1, 'Weekly hours are between 1 and 60')
    .max(60, 'Weekly hours are between 1 and 60')
    .transform((h) => Math.round(h * 10) / 10),
  timesheetRequired: z.boolean(),
  attendanceTracked: z.boolean(),
  // Personal details (spec 4.3)
  dateOfBirth,
  privateEmail: optionalEmail,
  privatePhone: optionalText(40),
  addressStreet: optionalText(200),
  addressPostalCode: optionalText(10),
  addressCity: optionalText(100),
  addressCountry: optionalText(100),
  emergencyContactName: optionalText(100),
  emergencyContactPhone: optionalText(40),
  // Bank account (spec 4.4)
  iban: bankAccount,
  bankName: optionalText(100),
  fxSameAsIban: z.boolean(),
  fxIban: bankAccount,
  swiftBic,
  fxBankName: optionalText(100),
  fxBankAddress: optionalText(200),
};

/**
 * POST /api/people/employees (Admin). First and last name and the employment
 * start date are required (an import may leave the date empty; the API's create form may not).
 * Weekly hours default to the workspace setting, the type to Permanent.
 */
export const CreateEmployee = z.object(fields).partial().required({ firstName: true, lastName: true, employmentStartDate: true });
export type CreateEmployee = z.infer<typeof CreateEmployee>;

/**
 * One row of the employee import (CD-141, spec 8.4): the create rules, but every field optional
 * (the import checks names, the start date warning, the IBAN and manager itself).
 */
export const ImportedEmployee = z
  .object(fields)
  .pick({
    firstName: true,
    lastName: true,
    workEmail: true,
    employeeNumber: true,
    jobTitle: true,
    workPhone: true,
    workLocation: true,
    employmentStartDate: true,
    employmentType: true,
    weeklyHours: true,
    dateOfBirth: true,
    privateEmail: true,
    privatePhone: true,
    addressStreet: true,
    addressPostalCode: true,
    addressCity: true,
    bankName: true,
  })
  .partial();
export type ImportedEmployee = z.infer<typeof ImportedEmployee>;

/** PATCH /api/people/employees/:id: any subset; who may change which field is checked per caller. */
export const UpdateEmployee = nonEmptyPatch(z.object(fields).partial());
export type UpdateEmployee = z.infer<typeof UpdateEmployee>;
/** The PATCH body: the fields, plus `clearLeadRoles` to confirm moving a unit's lead elsewhere (CD-225, CD-226). */
export const UpdateEmployeeBody = UpdateEmployee.and(z.object({ clearLeadRoles: z.boolean().optional() }));
export type UpdateEmployeeBody = z.infer<typeof UpdateEmployeeBody>;

export const EMPLOYEE_STATUSES = ['active', 'leaving', 'inactive'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const ACCOUNT_STATES = ['linked', 'invited', 'none'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];
export const DATA_ISSUES = ['no_manager', 'no_start_date', 'no_unit', 'manager_no_account', 'no_employee_number'] as const;
export type DataIssue = (typeof DATA_ISSUES)[number];

const csvOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));

/** GET /api/people/employees filters (spec 5.2). Lists are comma-separated. */
export const EmployeeListQuery = z.object({
  /** People in these units or a unit inside them (CD-226). */
  unitIds: IdList.optional(),
  managerId: z.uuid().optional(),
  /** With managerId: direct reports only (default) or everyone below them. */
  managerScope: z.enum(['direct', 'indirect']).default('direct'),
  /** Default: active and leaving. Inactive: Admins only. */
  status: csvOf(EMPLOYEE_STATUSES).optional(),
  /** Admin only. */
  account: csvOf(ACCOUNT_STATES).optional(),
  /** Admins only; rows with any of these issues. */
  issues: csvOf(DATA_ISSUES).optional(),
  /** Name, job title, work email (accent and case insensitive); employee number for Admins. */
  q: z.string().trim().min(1).max(200).optional(),
  /** Just these rows (live updates), at most 200. Rows that are gone or hidden are not returned. */
  ids: IdList.optional(),
});
export type EmployeeListQuery = z.infer<typeof EmployeeListQuery>;

export const RevealBankAccount = z.object({ account: z.enum(['iban', 'fxIban']).default('iban') });
export type RevealBankAccount = z.infer<typeof RevealBankAccount>;

export const ApproversQuery = z.object({ date: isoDate.optional() });
export type ApproversQuery = z.infer<typeof ApproversQuery>;
