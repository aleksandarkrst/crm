import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { EmploymentType } from '../../shared/database/schema';
import type { CsvRow } from '../../shared/import/csv';
import { type ColumnMapping, valuesOf } from '../../shared/import/import-file';
import { EMPLOYEE_FIELD_LABELS, parseEmploymentType, parseHours, parseImportDate, splitFullName } from './employee-import-fields';
import { ImportedEmployee } from './employees.schemas';
import { formatIban, type ParsedAccount, parseBankAccount } from './iban';

/**
 * The employee import's checks (spec 8.5, 8.6), without the database: every row of the file is
 * validated against the existing employees, departments and teams, then the managers are resolved
 * (they may come later in the file) and the final reporting tree is checked for loops. The preview
 * shows the result; the commit computes it again and saves it (employee-import.service.ts).
 */

export type ImportRowStatus = 'create' | 'update' | 'skip' | 'invalid';

export interface ExistingEmployee {
  id: string;
  fullName: string;
  workEmail: string | null;
  employeeNumber: string | null;
  managerId: string | null;
  departmentId: string | null;
  teamId: string | null;
  employmentStartDate: string | null;
  deactivatedAt: Date | null;
}

export interface ImportLookups {
  employees: ExistingEmployee[];
  departments: { id: string; name: string }[];
  teams: { id: string; departmentId: string; name: string }[];
  defaultWeeklyHours: number;
  numberRequired: boolean;
}

/** Work fields of a created or updated employee (only those the row has a value for). */
export interface WorkFields {
  firstName?: string;
  lastName?: string;
  workEmail?: string;
  employeeNumber?: string;
  jobTitle?: string;
  workPhone?: string;
  workLocation?: string;
  employmentStartDate?: string;
  employmentType?: EmploymentType;
  weeklyHours?: number;
}

/** Personal details of a created or updated employee (only those the row has a value for). */
export interface PersonalFields {
  dateOfBirth?: string;
  privateEmail?: string;
  privatePhone?: string;
  addressStreet?: string;
  addressPostalCode?: string;
  addressCity?: string;
  bankName?: string;
}

/** Who a row's manager is: an existing employee, or the employee another row of the file creates. */
export type ManagerTarget = { kind: 'existing'; id: string } | { kind: 'row'; row: RowPlan };

export interface RowPlan {
  line: number;
  cells: string[];
  values: Record<string, string>;
  status: ImportRowStatus;
  /** Why the row is not imported (invalid), or why it is skipped. */
  messages: string[];
  /** Imported, but worth a look (spec 8.5): no start date, no work email, a converted IBAN, no manager. */
  warnings: string[];
  /** Side effects: "New department: Sales", "Updates the existing employee …". */
  notes: string[];
  /** The new employee's id (create), or the matched employee's (update, skip). */
  id: string;
  existing: ExistingEmployee | null;
  /** Lower case. */
  email: string | null;
  work: WorkFields;
  personal: PersonalFields;
  iban: ParsedAccount | null;
  department: string | null;
  team: string | null;
  manager: ManagerTarget | null;
}

export interface ImportPlan {
  rows: RowPlan[];
  /** Names of the departments the import creates, as first written in the file. */
  newDepartments: string[];
  /** Teams the import creates: `{ department, name }`. */
  newTeams: { department: string; name: string }[];
}

/** Department and team names compare trimmed, with single spaces, without case. */
export const orgKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();
const teamKey = (department: string, team: string) => `${orgKey(department)}\u0000${orgKey(team)}`;
const cleanOrgName = (name: string) => name.trim().replace(/\s+/g, ' ');
const emailCheck = z.email();

/** Plans every row of the file. Pure: the same file and lookups always give the same plan. */
export function planImport(rows: CsvRow[], mapping: ColumnMapping, duplicates: 'skip' | 'update', lk: ImportLookups): ImportPlan {
  const byEmail = new Map<string, ExistingEmployee>();
  const byNumber = new Map<string, ExistingEmployee>();
  for (const e of lk.employees) {
    if (e.workEmail) byEmail.set(e.workEmail.toLowerCase(), e);
    if (e.employeeNumber) byNumber.set(e.employeeNumber, e);
  }
  const fileEmails = new Map<string, number>();
  const fileNumbers = new Map<string, number>();
  const hasColumn = (key: string) => (mapping[key] ?? null) !== null;

  // ---------------------------------------------------------------- pass 1: each row on its own
  const plans = rows.map((row) => {
    const v = valuesOf(mapping, row);
    const plan: RowPlan = {
      line: row.line,
      cells: row.cells,
      values: v,
      status: 'create',
      messages: [],
      warnings: [],
      notes: [],
      id: randomUUID(),
      existing: null,
      email: null,
      work: {},
      personal: {},
      iban: null,
      department: null,
      team: null,
      manager: null,
    };
    const errors = plan.messages;

    // Names: first and last name, or a full name split at the last space.
    let firstName = v.firstName ?? '';
    let lastName = v.lastName ?? '';
    if ((!firstName || !lastName) && v.fullName) {
      const split = splitFullName(v.fullName);
      if (split) {
        firstName ||= split.firstName;
        lastName ||= split.lastName;
      } else if (!firstName && !lastName) errors.push(`Full name: "${v.fullName}" needs a first and a last name`);
      else if (!lastName) lastName = v.fullName.trim();
      else firstName = v.fullName.trim();
    }
    if (!errors.length && !firstName && !lastName && !hasColumn('firstName') && !hasColumn('lastName')) errors.push('Full name is required');
    else if (!errors.length) {
      if (!firstName) errors.push('First name is required');
      if (!lastName) errors.push('Last name is required');
    }

    // Values that need reading before the create rules check them.
    const input: Record<string, unknown> = {};
    if (firstName) input.firstName = firstName;
    if (lastName) input.lastName = lastName;
    for (const key of ['workEmail', 'employeeNumber', 'jobTitle', 'workPhone', 'workLocation', 'privateEmail', 'privatePhone', 'addressStreet', 'addressPostalCode', 'addressCity', 'bankName'] as const) {
      if (v[key]) input[key] = v[key];
    }
    for (const key of ['employmentStartDate', 'dateOfBirth'] as const) {
      if (!v[key]) continue;
      const date = parseImportDate(v[key]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) input[key] = date;
      else errors.push(`${EMPLOYEE_FIELD_LABELS[key]}: "${v[key]}" is not a date (use YYYY-MM-DD or DD.MM.YYYY)`);
    }
    if (v.employmentType) {
      const type = parseEmploymentType(v.employmentType);
      if (type) input.employmentType = type;
      else errors.push(`Employment type: "${v.employmentType}" is not Permanent, Fixed term, Contractor or Student`);
    }
    if (v.weeklyHours) {
      const hours = parseHours(v.weeklyHours);
      if (hours === null) errors.push(`Weekly hours: "${v.weeklyHours}" is not a number`);
      else if (hours < 1 || hours > 60) errors.push(`Weekly hours: ${v.weeklyHours} is not between 1 and 60`);
      else input.weeklyHours = hours;
    }
    const parsed = ImportedEmployee.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        const label = EMPLOYEE_FIELD_LABELS[field] ?? field;
        if (issue.message === 'Not a valid date') errors.push(`${label}: "${v[field]}" is not a date (use YYYY-MM-DD or DD.MM.YYYY)`);
        else errors.push(`${label}: ${issue.message}`);
      }
    }
    if (v.iban) {
      plan.iban = parseBankAccount(v.iban);
      if (!plan.iban) errors.push('IBAN: not a valid IBAN or Serbian account number');
    }
    if (v.department && cleanOrgName(v.department).length > 100) errors.push('Department: at most 100 characters');
    if (v.team && cleanOrgName(v.team).length > 100) errors.push('Team: at most 100 characters');
    if (v.team && !v.department) errors.push(`Team: "${v.team}" needs a department in the same row`);
    if (v.managerEmail && !emailCheck.safeParse(v.managerEmail.toLowerCase()).success) errors.push('Manager email: Not a valid email address');

    const data = parsed.success ? parsed.data : {};
    plan.email = data.workEmail ?? null;
    const number = data.employeeNumber ?? null;

    // Duplicates within the file: the later row is the error.
    if (plan.email) {
      const first = fileEmails.get(plan.email);
      if (first !== undefined) errors.push(`Same email as line ${first}`);
      else fileEmails.set(plan.email, row.line);
    }
    if (number) {
      const first = fileNumbers.get(number);
      if (first !== undefined) errors.push(`Same employee number as line ${first}`);
      else fileNumbers.set(number, row.line);
    }

    // Duplicates with existing employees: by work email (spec 8.6); rows without one never are.
    plan.existing = plan.email ? (byEmail.get(plan.email) ?? null) : null;
    if (number) {
      const owner = byNumber.get(number);
      if (owner && owner.id !== plan.existing?.id) errors.push(`Employee number: ${number} is already used by ${owner.fullName}`);
    }
    // Required by the workspace for every employee the import creates or updates without one.
    if (lk.numberRequired && !number && !(plan.existing && (duplicates === 'skip' || plan.existing.employeeNumber))) errors.push('Employee number is required in this workspace');
    if (plan.email && v.managerEmail && v.managerEmail.toLowerCase() === plan.email) errors.push("Manager email: an employee can't be their own manager");

    if (errors.length) {
      plan.status = 'invalid';
      return plan;
    }
    // The work email is the match key: an update never changes it (spec 8.6).
    plan.work = present({
      firstName: data.firstName,
      lastName: data.lastName,
      workEmail: plan.existing ? undefined : (plan.email ?? undefined),
      employeeNumber: data.employeeNumber ?? undefined,
      jobTitle: data.jobTitle ?? undefined,
      workPhone: data.workPhone ?? undefined,
      workLocation: data.workLocation ?? undefined,
      employmentStartDate: data.employmentStartDate,
      employmentType: data.employmentType,
      weeklyHours: data.weeklyHours,
    }) as WorkFields;
    plan.personal = present({
      dateOfBirth: data.dateOfBirth ?? undefined,
      privateEmail: data.privateEmail ?? undefined,
      privatePhone: data.privatePhone ?? undefined,
      addressStreet: data.addressStreet ?? undefined,
      addressPostalCode: data.addressPostalCode ?? undefined,
      addressCity: data.addressCity ?? undefined,
      bankName: data.bankName ?? undefined,
    }) as PersonalFields;
    plan.department = v.department ? cleanOrgName(v.department) : null;
    plan.team = v.team ? cleanOrgName(v.team) : null;

    if (plan.existing) {
      plan.id = plan.existing.id;
      if (duplicates === 'skip') {
        plan.status = 'skip';
        plan.messages.push(`An employee with the email ${plan.email} already exists`);
        return plan;
      }
      plan.status = 'update';
      plan.notes.push(`Updates ${plan.existing.fullName}`);
      if (plan.existing.deactivatedAt) plan.notes.push('Inactive: not reactivated');
    }
    // A new employee without weekly hours gets the workspace's default (Settings → Employees).
    if (!plan.existing) plan.work.weeklyHours ??= lk.defaultWeeklyHours;
    if (!plan.work.employmentStartDate && !plan.existing?.employmentStartDate) plan.warnings.push('Employment start date missing');
    if (!plan.email) plan.warnings.push('No work email: cannot be invited or matched later');
    if (plan.iban?.convertedFromDomestic) plan.warnings.push(`IBAN converted from the account number: ${formatIban(plan.iban.iban)}`);
    return plan;
  });

  // ---------------------------------------------------------------- pass 2: managers
  // A row with errors may have no checked email (its fields didn't parse): its email as written
  // still finds it, so the message points at that line, not "Manager not found" (CD-224, B14).
  const rowByEmail = new Map<string, RowPlan>();
  for (const p of plans) {
    const email = p.email ?? p.values.workEmail?.trim().toLowerCase();
    if (email && !rowByEmail.has(email)) rowByEmail.set(email, p);
  }
  for (const p of plans) {
    const managerEmail = p.values.managerEmail?.toLowerCase();
    if (!managerEmail || p.status === 'invalid' || p.status === 'skip') continue;
    const existing = byEmail.get(managerEmail);
    if (existing) {
      if (existing.deactivatedAt) invalidate(p, 'Manager has left the company');
      else if (existing.id === p.id) invalidate(p, "Manager email: an employee can't be their own manager");
      else p.manager = { kind: 'existing', id: existing.id };
      continue;
    }
    const row = rowByEmail.get(managerEmail);
    if (row) p.manager = { kind: 'row', row };
    else invalidate(p, `Manager not found: ${managerEmail}`);
  }

  // ---------------------------------------------------------------- pass 3: no loops in the final tree
  const existingById = new Map(lk.employees.map((e) => [e.id, e]));
  // A row in a loop is not imported; that puts its employee's old line back (or removes a new
  // employee), which can close another loop, so check again until none is left.
  for (;;) {
    const loops = findLoops(plans, lk.employees);
    if (!loops.length) break;
    for (const loop of loops) {
      for (const node of loop) if (typeof node !== 'string') invalidate(node, loopText(loop, node, existingById));
    }
  }
  for (const p of plans) {
    if ((p.status === 'create' || p.status === 'update') && p.manager?.kind === 'row' && p.manager.row.status !== 'create') {
      const line = p.manager.row.line;
      p.warnings.push(p.status === 'create' ? `Manager is on line ${line}, which has errors: imported without a manager` : `Manager is on line ${line}, which has errors: manager not changed`);
    }
  }

  // ---------------------------------------------------------------- departments and teams to create
  const departments = new Map(lk.departments.map((d) => [orgKey(d.name), d.id]));
  const teams = new Set(lk.teams.map((t) => `${t.departmentId}\u0000${orgKey(t.name)}`));
  const newDepartments = new Map<string, string>();
  const newTeams = new Map<string, { department: string; name: string }>();
  for (const p of plans) {
    if ((p.status !== 'create' && p.status !== 'update') || !p.department) continue;
    const departmentId = departments.get(orgKey(p.department));
    if (!departmentId && !newDepartments.has(orgKey(p.department))) {
      newDepartments.set(orgKey(p.department), p.department);
      p.notes.push(`New department: ${p.department}`);
    }
    if (!p.team) continue;
    const exists = departmentId ? teams.has(`${departmentId}\u0000${orgKey(p.team)}`) : false;
    if (!exists && !newTeams.has(teamKey(p.department, p.team))) {
      newTeams.set(teamKey(p.department, p.team), { department: newDepartments.get(orgKey(p.department)) ?? p.department, name: p.team });
      p.notes.push(`New team: ${p.team}`);
    }
  }
  return { rows: plans, newDepartments: [...newDepartments.values()], newTeams: [...newTeams.values()] };
}

/** Makes a row an error (not imported). */
function invalidate(p: RowPlan, message: string) {
  if (p.status !== 'invalid') p.messages.length = 0;
  p.status = 'invalid';
  p.warnings.length = 0;
  p.notes.length = 0;
  p.messages.push(message);
}

/** The id a row's employee has in the final tree, or null when the row creates nobody. */
function nodeOf(p: RowPlan): string | null {
  if (p.status === 'create' || p.status === 'update' || p.status === 'skip') return p.id;
  return p.existing?.id ?? null;
}

/** The manager id a row sets, or undefined when it leaves the manager as it is. */
function managerOf(p: RowPlan): string | null | undefined {
  if (p.status === 'create') return p.manager ? managerId(p.manager) : null;
  if (p.status === 'update' && p.manager) return managerId(p.manager) ?? undefined;
  return undefined;
}

function managerId(target: ManagerTarget): string | null {
  return target.kind === 'existing' ? target.id : nodeOf(target.row);
}

/**
 * Reporting loops in the tree the import would leave: the existing reporting lines with the rows'
 * changes applied. Each loop is a list of nodes from a row back to itself; nodes are rows (when a
 * row of the file sets that employee's manager) or the ids of existing employees.
 */
export function findLoops(plans: RowPlan[], existing: ExistingEmployee[]): (RowPlan | string)[][] {
  const manager = new Map<string, string | null>();
  const rowOf = new Map<string, RowPlan>();
  for (const e of existing) manager.set(e.id, e.managerId);
  for (const p of plans) {
    const m = managerOf(p);
    if (m === undefined) continue;
    manager.set(p.id, m);
    rowOf.set(p.id, p);
  }
  const done = new Set<string>();
  const loops: (RowPlan | string)[][] = [];
  for (const start of rowOf.keys()) {
    if (done.has(start)) continue;
    const path: string[] = [];
    const onPath = new Map<string, number>();
    let at: string | null | undefined = start;
    while (at && !done.has(at)) {
      if (onPath.has(at)) {
        const cycle = path.slice(onPath.get(at)!).map((id) => rowOf.get(id) ?? id);
        // Existing data never has a loop (the API refuses them), so every loop has a row; skip it otherwise.
        if (cycle.some((n) => typeof n !== 'string')) loops.push(cycle);
        break;
      }
      onPath.set(at, path.length);
      path.push(at);
      at = manager.get(at);
    }
    for (const id of path) done.add(id);
  }
  return loops;
}

/** "Reporting loop: lines 5 → 9 → 5", or with existing employees "Reporting loop: line 5 → Marko Ilić → line 5", starting at `from`. */
function loopText(loop: (RowPlan | string)[], from: RowPlan, existing: Map<string, ExistingEmployee>): string {
  const at = loop.indexOf(from);
  const ordered = [...loop.slice(at), ...loop.slice(0, at), from];
  const allRows = ordered.every((n) => typeof n !== 'string');
  const label = (n: RowPlan | string) => (typeof n === 'string' ? (existing.get(n)?.fullName ?? 'an employee') : allRows ? String(n.line) : `line ${n.line}`);
  return `Reporting loop: ${allRows ? 'lines ' : ''}${ordered.map(label).join(' → ')}`;
}

/** Only the values that are present, so an update never blanks a field the file left empty. */
function present<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;
}
