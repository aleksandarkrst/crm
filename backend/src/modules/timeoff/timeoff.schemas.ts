import { z } from 'zod';
import { ADJUSTMENT_KINDS, MAX_BASE_DAYS, MIN_BASE_DAYS, REASON_KINDS, TIMEOFF_REQUEST_STATUSES, TIMEOFF_TYPES } from '../../shared/database/schema';
import { nonEmptyPatch, optionalText } from '../../shared/validation/common';

/** "From N years: +X days" (spec 5.2). */
const ExperienceRule = z.object({
  fromYears: z.number().int().min(1).max(50),
  extraDays: z.number().int().min(1).max(20),
});
export type ExperienceRuleInput = z.infer<typeof ExperienceRule>;

const experienceRules = z
  .array(ExperienceRule)
  .max(20)
  .refine((rows) => new Set(rows.map((r) => r.fromYears)).size === rows.length, 'Two experience rows start at the same number of years');

const policyFields = {
  name: z.string().trim().min(1, 'A name is needed').max(100),
  baseDays: z.number().int().min(MIN_BASE_DAYS, `The Labor Law's minimum is ${MIN_BASE_DAYS} working days`).max(MAX_BASE_DAYS),
  maxDays: z.number().int().min(MIN_BASE_DAYS).max(100).nullable(),
  carryOver: z.boolean(),
  carryOverCap: z.number().int().min(0).max(60).nullable(),
  note: optionalText(2000),
  experienceRules,
};

/** POST /api/timeoff/policies. */
export const CreatePolicy = z.object({
  ...policyFields,
  maxDays: policyFields.maxDays.default(null),
  carryOver: policyFields.carryOver.default(true),
  carryOverCap: policyFields.carryOverCap.default(null),
  experienceRules: experienceRules.default([]),
});
export type CreatePolicy = z.infer<typeof CreatePolicy>;

/** PATCH /api/timeoff/policies/:id: any of the fields; `experienceRules` replaces the rows. */
export const UpdatePolicy = nonEmptyPatch(z.object(policyFields).partial());
export type UpdatePolicy = z.infer<typeof UpdatePolicy>;

/** PATCH /api/timeoff/employees/:id/profile (Admins): the policy and the prior work experience. */
export const UpdateProfile = nonEmptyPatch(
  z.object({
    policyId: z.uuid().optional(),
    priorExperienceMonths: z.number().int().min(0).max(600).optional(),
  }),
);
export type UpdateProfile = z.infer<typeof UpdateProfile>;

/** PATCH /api/timeoff/employees/:id/entitlements/:year (Admins): individual extra days with their reason. */
export const UpdateEntitlement = z
  .object({
    individualDays: z.number().int().min(0).max(60),
    individualReason: optionalText(300),
  })
  .refine((v) => v.individualDays === 0 || !!v.individualReason, { message: 'A reason is needed for individual extra days', path: ['individualReason'] });
export type UpdateEntitlement = z.infer<typeof UpdateEntitlement>;

/** POST …/entitlements/:year/recalculate: `preview` only answers what would change. */
export const Recalculate = z.object({ preview: z.boolean().default(false) });
export type Recalculate = z.infer<typeof Recalculate>;

export const YearParam = z.coerce.number().int().min(2000).max(2100);

// ---------------------------------------------------------------- reasons and settings (spec 7.2, 7.3)

const reasonFields = {
  name: z.string().trim().min(1, 'A name is needed').max(100),
  maxDays: z.number().int().min(1).max(60).nullable(),
  countsTowardLimit: z.boolean(),
  paidByEmployer: z.boolean(),
  active: z.boolean(),
};

/** POST /api/timeoff/reasons (Admins). */
export const CreateReason = z.object({
  kind: z.enum(REASON_KINDS),
  name: reasonFields.name,
  maxDays: reasonFields.maxDays.default(null),
  countsTowardLimit: reasonFields.countsTowardLimit.default(false),
  paidByEmployer: reasonFields.paidByEmployer.default(false),
});
export type CreateReason = z.infer<typeof CreateReason>;

/** PATCH /api/timeoff/reasons/:id (Admins). */
export const UpdateReason = nonEmptyPatch(z.object(reasonFields).partial());
export type UpdateReason = z.infer<typeof UpdateReason>;

export const ReasonsQuery = z.object({ kind: z.enum(REASON_KINDS).optional() });
export type ReasonsQuery = z.infer<typeof ReasonsQuery>;

/** PATCH /api/timeoff/settings (Admins). */
export const UpdateTimeoffSettings = z.object({ paidLeaveYearlyLimit: z.number().int().min(0).max(60) });
export type UpdateTimeoffSettings = z.infer<typeof UpdateTimeoffSettings>;

// ---------------------------------------------------------------- requests (spec 8)

const requestFields = {
  /** Someone else's record: Admins only. */
  employeeId: z.uuid().optional(),
  type: z.enum(TIMEOFF_TYPES),
  reasonId: z.uuid().nullable().optional(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
};
const datesInOrder = (v: { startDate: string; endDate: string }) => v.endDate >= v.startDate;
const DATES = { message: 'The end date is before the start date', path: ['endDate'] };

/** POST /api/timeoff/requests/preview: the working days, the balance before and after and the approver, before submitting. */
export const PreviewRequest = z.object(requestFields).refine(datesInOrder, DATES);
export type PreviewRequest = z.infer<typeof PreviewRequest>;

/**
 * POST /api/timeoff/requests. `record` (Admins, spec 8.7): recorded as approved at once, with why;
 * `generateDecision` is for CD-167 and stored with the request's history.
 */
export const CreateRequest = z
  .object({
    ...requestFields,
    note: optionalText(500),
    record: z.object({ reason: z.string().trim().min(1, 'Say why you record it').max(300) }).optional(),
  })
  .refine(datesInOrder, DATES);
export type CreateRequest = z.infer<typeof CreateRequest>;

/** GET /api/timeoff/requests?employeeId=&year=&status=&type= (own by default). */
export const RequestsQuery = z.object({
  employeeId: z.uuid().optional(),
  year: YearParam.optional(),
  status: z.enum(TIMEOFF_REQUEST_STATUSES).optional(),
  type: z.enum(TIMEOFF_TYPES).optional(),
  /** Admins and managers: every request they may see, not only one employee's. */
  all: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type RequestsQuery = z.infer<typeof RequestsQuery>;

/** GET …/balance?year= (this year by default). */
export const BalanceQuery = z.object({ year: YearParam.optional() });
export type BalanceQuery = z.infer<typeof BalanceQuery>;

/** POST /api/timeoff/employees/:id/adjustments (Admins, spec 6.4): append-only, a reason always. */
export const CreateAdjustment = z.object({
  poolYear: YearParam,
  days: z
    .number()
    .int()
    .min(-60)
    .max(60)
    .refine((d) => d !== 0, 'Enter a number of days other than 0'),
  kind: z.enum(ADJUSTMENT_KINDS),
  reason: z.string().trim().min(1, 'A reason is needed').max(300),
});
export type CreateAdjustment = z.infer<typeof CreateAdjustment>;

/** GET /api/timeoff/balances: the table (spec 6.5), with its filters. */
export const BalancesQuery = z.object({
  year: YearParam.optional(),
  unitId: z.uuid().optional(),
  managerId: z.uuid().optional(),
  policyId: z.uuid().optional(),
  /** Only employees with carry-over that expires on 30 June. */
  expiring: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type BalancesQuery = z.infer<typeof BalancesQuery>;

const employeeIds = z.array(z.uuid()).min(1).max(500);

/** POST /api/timeoff/balances/policy (Admins): "Change policy" for the selected employees. */
export const BulkChangePolicy = z.object({ employeeIds, policyId: z.uuid() });
export type BulkChangePolicy = z.infer<typeof BulkChangePolicy>;

/** POST /api/timeoff/balances/recalculate (Admins): Recalculate the year for the selected employees. */
export const BulkRecalculate = z.object({ employeeIds, year: YearParam });
export type BulkRecalculate = z.infer<typeof BulkRecalculate>;

/** GET …/history?limit=&offset=. */
export const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;
