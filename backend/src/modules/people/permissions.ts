import { FUNCTIONAL_ROLES, type FunctionalRole } from './caller-access';

/**
 * The permission matrix of the functional roles (spec 9.3) as data: the ONE definition the server
 * checks against (`relationsFor`, `allows`) and Settings → Roles & permissions shows
 * (`GET /api/people/permissions`), so the screen and the rules can't drift. The permission-matrix
 * API tests are generated from it too. A change here is a change to the spec's matrix.
 *
 * Each cell has a `scope`, how far the role reaches, and the `label` shown in the matrix:
 * - `none`: no; `own`: only their own data (or "Yes" for something everyone does for themselves);
 * - `direct`: their direct reports; `indirect`: their reports at any depth (direct ones included);
 * - `all`: every employee (or "Yes" for an action without a person).
 * A label that adds a condition ("If setting on", "If organizer or participant") keeps the widest
 * scope the condition allows; the service applies the condition itself.
 */
export type PermissionScope = 'none' | 'own' | 'direct' | 'indirect' | 'all';
/** How a person relates to the caller: themselves, a direct report, a report further down, anyone else. */
export type PermissionRelation = 'self' | 'direct' | 'indirect' | 'other';

export interface PermissionCell {
  scope: PermissionScope;
  label: string;
}

export interface PermissionRow {
  /** Stable id, e.g. "crm.visit_plans.manage". Tests and services use it. */
  id: string;
  action: string;
  cells: Record<FunctionalRole, PermissionCell>;
}

export interface PermissionModule {
  id: string;
  name: string;
  /** The milestone that delivers it (null: the existing CRM and settings). */
  milestone: number | null;
  /** Live in the app now. The others show "Coming with <name>" in the Roles tab. */
  live: boolean;
  rows: PermissionRow[];
}

const DEFAULT_LABELS: Record<PermissionScope, string> = { none: 'No', own: 'Own', direct: 'Direct', indirect: 'Indirect', all: 'All' };

/** A cell from the matrix's text: "No", "Own", "Direct", "Indirect", "All", "Yes", or `[scope, label]`. */
type CellSpec = 'No' | 'Own' | 'Direct' | 'Indirect' | 'All' | 'Yes' | 'Yes (own)' | [PermissionScope, string];

function cell(spec: CellSpec): PermissionCell {
  if (Array.isArray(spec)) return { scope: spec[0], label: spec[1] };
  if (spec === 'Yes') return { scope: 'all', label: 'Yes' };
  // Something everyone does for themselves ("Enter and submit own timesheet").
  if (spec === 'Yes (own)') return { scope: 'own', label: 'Yes' };
  const scope = ({ No: 'none', Own: 'own', Direct: 'direct', Indirect: 'indirect', All: 'all' } as const)[spec];
  return { scope, label: DEFAULT_LABELS[scope] };
}

/** One row: the cells in the matrix's column order Employee, Manager, Admin. */
function row(id: string, action: string, cells: [CellSpec, CellSpec, CellSpec]): PermissionRow {
  return { id, action, cells: Object.fromEntries(FUNCTIONAL_ROLES.map((r, i) => [r, cell(cells[i]!)])) as Record<FunctionalRole, PermissionCell> };
}

const ORGANIZER: CellSpec = ['own', 'If organizer or participant'];
const SAME: CellSpec = ['own', 'Same'];
const ASSIGNED: CellSpec = ['own', 'If assigned'];
const IF_CHOSEN: CellSpec = ['all', 'If chosen in settings'];
const ROUTED: CellSpec = ['all', 'When routed to Admins'];

export const PERMISSION_MODULES: readonly PermissionModule[] = [
  {
    id: 'crm',
    name: 'CRM',
    milestone: null,
    live: true,
    rows: [
      row('crm.records', 'View and edit companies, contacts, deals, products, meetings', ['Yes', 'Yes', 'Yes']),
      row('crm.admin', 'Delete CRM records; funnels; custom fields; CRM import and export', ['No', 'No', 'Yes']),
      row('crm.bonuses', 'See and set sales bonuses', ['No', 'No', 'Yes']),
      row('crm.meetings.change', 'Edit, cancel, write minutes of a meeting', [ORGANIZER, SAME, 'Yes']),
      row('crm.visit_plans.own', 'See own visit plans', ['Yes (own)', 'Yes (own)', 'Yes (own)']),
      row('crm.visit_plans.see', 'See visit plans and team overview', ['Own', 'Indirect', 'All']),
      row('crm.visit_plans.manage', 'Create, edit, delete visit plans', ['No', 'Direct', 'All']),
    ],
  },
  {
    id: 'org',
    name: 'Org structure',
    milestone: 13,
    live: true,
    rows: [
      row('org.directory', 'See the org chart and directory (name, job title, department, team, manager, work email, work phone, location)', [
        ['all', 'All active'],
        ['all', 'All active'],
        ['all', 'All, incl. inactive'],
      ]),
      row('org.employment', 'See start date, end date, employment type, weekly hours', ['Own', 'Indirect', 'All']),
      row('org.personal', 'See personal details', ['Own', 'No', 'All']),
      row('org.bank', 'See bank account (masked) and reveal it', ['Own', 'No', 'All']),
      row('org.edit_own', 'Edit own work phone and personal details', ['Yes (own)', 'Yes (own)', 'Yes (own)']),
      row('org.edit_own_bank', 'Edit own bank account', [['own', 'If setting on'], ['own', 'If setting on'], ['own', 'Yes']]),
      row('org.employees.manage', 'Create and edit employees (work fields, personal details, bank account)', ['No', 'No', 'All']),
      row('org.reporting', 'Set department, team, reports to', ['No', 'No', 'All']),
      row('org.structure', 'Departments and teams: add, rename, delete, assign', ['No', 'No', 'Yes']),
      row('org.export', 'Export employee list', ['No', 'No', 'Yes']),
      row('org.deactivate', 'Deactivate and reactivate', ['No', 'No', 'Yes']),
      row('org.delete', 'Delete an employee (once deactivated)', ['No', 'No', 'Yes']),
      row('org.invite', 'Invite to Pultly, link and unlink members', ['No', 'No', 'Yes']),
      row('org.history', 'See employee history', [['own', 'Own (without reason for leaving)'], 'No', 'All']),
    ],
  },
  {
    id: 'projects',
    name: 'Projects and tasks',
    milestone: 14,
    live: false,
    rows: [
      row('projects.see', 'See projects and tasks', ['All', 'All', 'All']),
      row('projects.log_time', 'Log time on a task', [ASSIGNED, ASSIGNED, ASSIGNED]),
      row('projects.manage', 'Create and edit client projects and tasks, assign people and hour limits', ['No', 'Yes', 'Yes']),
      row('projects.initiatives', 'Create and edit strategic initiatives of a department', ['No', ['all', 'If department head'], 'Yes']),
      row('projects.effective_time', 'See effective time per person', ['Own', 'Indirect', 'All']),
      row('projects.configure', 'Configure hierarchy and task types', ['No', 'No', 'Yes']),
    ],
  },
  {
    id: 'timesheet',
    name: 'Timesheet',
    milestone: 15,
    live: false,
    rows: [
      row('timesheet.own', 'Enter and submit own timesheet', ['Yes (own)', 'Yes (own)', 'Yes (own)']),
      row('timesheet.see', 'See timesheets (including drafts)', ['Own', 'Indirect', 'All']),
      row('timesheet.approve', 'Approve or return', ['No', 'Direct', ROUTED]),
      row('timesheet.approved_hours', 'See approved hours', ['Own', 'Indirect', 'All']),
      row('timesheet.payroll_email', 'Receive the payroll email', ['No', 'No', IF_CHOSEN]),
      row('timesheet.change_locked', 'Change an approved, locked day (with a trace)', ['No', 'No', 'Yes']),
      row('timesheet.status_today', "Today's status of employees", [
        ['all', 'All, shown as Working, On a trip or Away'],
        ['indirect', 'Indirect with the reason'],
        ['all', 'All with the reason'],
      ]),
      row('timesheet.settings', 'Timesheet settings', ['No', 'No', 'Yes']),
    ],
  },
  {
    id: 'time_off',
    name: 'Time off and sick leave',
    milestone: 16,
    live: false,
    rows: [
      row('time_off.request', 'Request time off, see own balance', ['Yes (own)', 'Yes (own)', 'Yes (own)']),
      row('time_off.see', 'See requests and balances', ['Own', 'Indirect', 'All']),
      row('time_off.approve', 'Approve or reject', ['No', 'Direct', ROUTED]),
      row('time_off.sick_leave', 'Sick leave records (type and period, no medical data)', ['Own', 'Indirect', 'All']),
      row('time_off.decisions', 'Vacation decisions (PDF)', ['Own', 'No', 'All']),
      row('time_off.settings', 'Vacation policies, public holidays, decision recipients', ['No', 'No', 'Yes']),
    ],
  },
  {
    id: 'travel',
    name: 'Business travel',
    milestone: 17,
    live: false,
    rows: [
      row('travel.own', 'Register own trips, add receipts', ['Yes (own)', 'Yes (own)', 'Yes (own)']),
      row('travel.see', 'See trips and travel orders', [['own', 'Own and trips they take part in'], 'Indirect', 'All']),
      row('travel.approve', 'Approve trips', ['No', 'Direct', ROUTED]),
      row('travel.expenses', 'Expense statements and receipts', ['Own', ['direct', 'Direct, view'], 'All']),
      row('travel.settings', 'Company details, signatory, travel order recipients', ['No', 'No', 'Yes']),
    ],
  },
  {
    id: 'lateness',
    name: 'Clock-in and lateness',
    milestone: 19,
    live: false,
    rows: [
      row('lateness.see', 'See arrivals, departures and lateness', ['Own', 'Indirect', 'All']),
      row('lateness.email', 'Morning lateness email', ['No', ['indirect', 'If chosen in settings'], IF_CHOSEN]),
      row('lateness.settings', 'Break rules and email recipients', ['No', 'No', 'Yes']),
    ],
  },
  {
    id: 'planning',
    name: 'Planning',
    milestone: 21,
    live: false,
    rows: [
      row('planning.business_plan', 'See company business plan', [['all', 'Summary'], 'Yes', 'Yes']),
      row('planning.business_plan.edit', 'Create and edit company business plan', ['No', 'No', 'Yes']),
      row('planning.individual', 'See individual plans and KPIs', ['Own', 'Indirect', 'All']),
      row('planning.individual.set', 'Set individual plans and KPIs', ['No', 'Direct', 'All']),
      row('planning.department_kpis', 'Department KPIs', [['own', 'Own department, view'], ['all', 'If department head, edit'], 'All']),
      row('planning.plan_vs_actual', 'Plan vs. actual screen', ['Own', 'Indirect', 'All']),
    ],
  },
  {
    id: 'settings',
    name: 'Settings',
    milestone: null,
    live: true,
    rows: [
      row('settings.own', 'Own profile and notification preferences', ['Yes (own)', 'Yes (own)', 'Yes (own)']),
      row('settings.team', 'Settings → Team (invite, workspace roles); owner rules as today', ['No', 'No', 'Yes']),
      row('settings.workspace', 'Workspace settings of every module (including the Employees settings)', ['No', 'No', 'Yes']),
      row('settings.roles_tab', 'See the Roles & permissions tab', ['Yes', 'Yes', 'Yes']),
    ],
  },
];

const ROWS = new Map(PERMISSION_MODULES.flatMap((m) => m.rows.map((r) => [r.id, r] as const)));

export function permissionRow(id: string): PermissionRow {
  const found = ROWS.get(id);
  if (!found) throw new Error(`Unknown permission row ${id}`);
  return found;
}

/** Who each scope reaches. "Indirect" includes direct reports; neither includes yourself. */
const REACH: Record<PermissionScope, readonly PermissionRelation[]> = {
  none: [],
  own: ['self'],
  direct: ['direct'],
  indirect: ['direct', 'indirect'],
  all: ['self', 'direct', 'indirect', 'other'],
};

/**
 * Who a caller with these roles reaches for a row. Roles are additive (spec 9.1): the union of the
 * cells of all their roles; everyone with a record is an Employee, so that column always counts.
 */
export function relationsFor(rowId: string, roles: Iterable<FunctionalRole>): Set<PermissionRelation> {
  const r = permissionRow(rowId);
  const out = new Set<PermissionRelation>();
  for (const role of new Set<FunctionalRole>(['employee', ...roles])) for (const rel of REACH[r.cells[role].scope]) out.add(rel);
  return out;
}

/** Whether the roles allow the row for a person of this relation (default: any person, or the action itself). */
export function allows(rowId: string, roles: Iterable<FunctionalRole>, relation?: PermissionRelation): boolean {
  const reach = relationsFor(rowId, roles);
  return relation ? reach.has(relation) : reach.size > 0;
}

/** For `GET /api/people/permissions`: the roles in column order and the modules with their rows. */
export function permissionMatrix() {
  return {
    roles: FUNCTIONAL_ROLES.map((id) => ({ id, ...ROLE_INFO[id] })),
    modules: PERMISSION_MODULES,
  };
}

/** The roles as Settings → Roles & permissions describes them (spec 9.1; Administration and Payroll removed by CD-225). */
export const ROLE_INFO: Record<FunctionalRole, { label: string; who: string; given: string }> = {
  employee: { label: 'Employee', who: 'Every employee with an account.', given: 'Automatic.' },
  manager: { label: 'Manager', who: 'Every employee with at least one active direct report.', given: 'From reporting lines. Cannot be set by hand.' },
  admin: { label: 'Admin', who: 'Every workspace owner and admin. Admins do all HR work.', given: 'From the workspace role (Settings → Team).' },
};
