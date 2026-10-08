import { z } from 'zod';
import { CUSTOMER_EMAIL_LANGUAGES, DATE_FORMATS, PROFILE_LANGUAGES, START_PAGES, WORKSPACE_MODULES } from '../../shared/database/schema';

// ICU's lists (Node ships full ICU): every ISO 4217 code and every canonical IANA zone.
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

/** An IANA name such as "Europe/Belgrade" (or "UTC"). Also accepts older aliases ICU knows, like "Europe/Kiev". */
export function isIanaTimeZone(tz: string): boolean {
  if (TIME_ZONES.has(tz) || tz === 'UTC') return true;
  // Offsets ("+01:00") are valid for Intl but aren't IANA names, so require Area/Location.
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const atLeastOne = (v: object) => Object.values(v).some((x) => x !== undefined);

/** A name for projects or tasks (CD-143): 1 to 30 characters. */
const term = z.string().trim().min(1, 'Enter a name').max(30, 'At most 30 characters');

/** What the workspace calls projects and tasks (CD-143). The task names can't repeat a project name. */
export const WorkspaceTerms = z
  .object({ project: term, projects: term, task: term, tasks: term })
  .superRefine((t, ctx) => {
    const projectNames = new Set([t.project.toLowerCase(), t.projects.toLowerCase()]);
    for (const key of ['task', 'tasks'] as const) {
      if (projectNames.has(t[key].toLowerCase())) ctx.addIssue({ code: 'custom', path: [key], message: 'Projects and tasks need different names' });
    }
  });
export type WorkspaceTerms = z.infer<typeof WorkspaceTerms>;
export const DEFAULT_TERMS: WorkspaceTerms = { project: 'Project', projects: 'Projects', task: 'Task', tasks: 'Tasks' };

export const UpdateWorkspace = z
  .object({
    name: z.string().trim().min(1).max(100),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => /^[A-Z]{3}$/.test(c) && CURRENCIES.has(c), 'Must be an ISO 4217 currency code, e.g. EUR'),
    timezone: z.string().trim().refine(isIanaTimeZone, 'Must be an IANA time zone, e.g. Europe/Belgrade'),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    customerEmailLanguage: z.enum(CUSTOMER_EMAIL_LANGUAGES),
    // Settings → Employees (milestone 13, spec 10.3).
    employeeDefaultWeeklyHours: z.number().int().min(1).max(60),
    employeeNumberRequired: z.boolean(),
    employeeSelfEditBank: z.boolean(),
    // The CEO on the org chart's company node (CD-225): an active employee, or null for nobody.
    ceoEmployeeId: z.uuid().nullable(),
    // "Create a project when a deal is won" (CD-233).
    autoCreateProjects: z.boolean(),
    // The modules turned on (CD-279): each once; any subset, none included.
    modules: z.array(z.enum(WORKSPACE_MODULES)).max(WORKSPACE_MODULES.length).refine((m) => new Set(m).size === m.length, 'Each module once'),
    // What the workspace calls projects and tasks (CD-143): all four names at once.
    terms: WorkspaceTerms,
  })
  .partial()
  .refine(atLeastOne, 'Nothing to update');
export type UpdateWorkspace = z.infer<typeof UpdateWorkspace>;

/** Empty text clears a field. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

export const UpdateProfile = z
  .object({
    // Your own profile: global settings.
    displayName: z.string().trim().min(1).max(100),
    jobTitle: clearable(100),
    phone: clearable(40),
    language: z.enum(PROFILE_LANGUAGES),
    dateFormat: z.enum(DATE_FORMATS),
    startPage: z.enum(START_PAGES),
    // Settings for the current workspace only.
    defaultFunnelId: z.uuid().nullable(),
    dailyDigest: z.boolean(),
    notifyDealAssigned: z.boolean(),
    notifyMeetingInvites: z.boolean(),
    notifyVisitPlans: z.boolean(),
    notifyOrgChanges: z.boolean(),
    notifyTaskAssigned: z.boolean(),
  })
  .partial()
  .refine(atLeastOne, 'Nothing to update');
export type UpdateProfile = z.infer<typeof UpdateProfile>;
