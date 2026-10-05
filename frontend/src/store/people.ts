/**
 * People (milestone 13): the store's employee slice and the Org structure page's rules (CD-137).
 *
 * The directory isn't part of the workspace load. The first screen that needs it (the Org
 * structure page, Ctrl/⌘K) calls `people.watch()`; the whole directory then comes in one response
 * (the API sends all rows, up to a few thousand) with the departments, teams and the caller's own
 * access, and stays in `s.people`. Filters, search, sorting and both charts run in the browser on
 * that copy, so they answer at once and agree with each other.
 *
 * What a row carries is the API's decision (spec 9): `employment`, `hr` and `roles` are present only
 * where the caller may see them. Nothing here assumes they exist.
 *
 * Live updates (CD-20): hints `employee`, `department`, `team` and `employee_role` read the
 * directory again (a rename or a new manager changes other rows' names too), after a short pause.
 */
import { type ApiDataIssue, type ApiDepartment, type ApiEmployee, type ApiEmployeePersonalExport, type ApiEmployeeStatus, type ApiAccountState, type ApiPeopleAccess, type ApiTeam, type BulkEmployeesInput, peopleApi } from '../lib/api';
import type { LiveEvent } from './live';
import type { State } from './types';

export interface PeopleState {
  /** The directory as the API shows this caller: active and leaving, plus inactive for Administration and Admin. */
  employees: ApiEmployee[];
  departments: ApiDepartment[];
  teams: ApiTeam[];
  access: ApiPeopleAccess | null;
  /** Read at least once. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
}
export const emptyPeople = (): PeopleState => ({ employees: [], departments: [], teams: [], access: null, loaded: false, loading: false, error: null });

/** The live hint types that mean "read the directory again". */
export const PEOPLE_HINTS = new Set(['employee', 'department', 'team', 'employee_role']);

// ---------------------------------------------------------------- who the caller is

export const isAdminOf = (a: ApiPeopleAccess | null) => !!a?.roles.includes('admin');
/** Administration or Admin: manages employees, sees inactive ones, data issues, bulk actions, export. */
export const isHrOf = (a: ApiPeopleAccess | null) => !!a && (a.roles.includes('admin') || a.roles.includes('administration'));
export const isManagerOf = (a: ApiPeopleAccess | null) => !!a?.roles.includes('manager');

// ---------------------------------------------------------------- search

/**
 * Lower case without accents, as the API folds names (people_fold): "Petrović" → "petrovic",
 * "Đorđe" → "dorde". Typing "dj" for "đ" works too (matchesText tries both).
 */
export function foldName(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}
const foldDj = (value: string | null | undefined) => foldName((value ?? '').replace(/đ/g, 'dj').replace(/Đ/g, 'Dj'));

/** Whether every word of the query is in the employee's name, job title or work email (employee number for HR). */
export function matchesText(e: ApiEmployee, query: string, withNumber: boolean): boolean {
  const words = foldName(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const parts = [e.fullName, e.jobTitle, e.workEmail, withNumber ? e.employment?.employeeNumber : null];
  const hay = parts.map(foldName).join(' ');
  const hayDj = parts.map(foldDj).join(' ');
  return words.every((w) => hay.includes(w) || hayDj.includes(w));
}

/**
 * Ctrl/⌘K (spec 5.2): active employees by name, job title or work email, names starting with the
 * query first. Opening one goes to their card.
 */
export function searchEmployees(employees: readonly ApiEmployee[], query: string, limit = 5): { id: string; title: string; subtitle: string; initials: string }[] {
  const q = foldName(query.trim());
  if (!q) return [];
  const scored: { e: ApiEmployee; score: number }[] = [];
  for (const e of employees) {
    if (e.status === 'inactive' || !matchesText(e, query, false)) continue;
    const name = foldName(e.fullName);
    const score = name.startsWith(q) || foldName(e.lastName).startsWith(q) ? 3 : name.includes(q) ? 2 : 1;
    scored.push({ e, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || collator.compare(a.e.fullName, b.e.fullName))
    .slice(0, limit)
    .map(({ e }) => ({ id: e.id, title: e.fullName, subtitle: [e.jobTitle, e.teamName ?? e.departmentName].filter(Boolean).join(' · '), initials: initialsOfEmployee(e) }));
}

/** "AP" for Ana Petrović. */
export const initialsOfEmployee = (e: Pick<ApiEmployee, 'firstName' | 'lastName'>) => ((e.firstName[0] ?? '') + (e.lastName[0] ?? '')).toUpperCase() || '?';

// ---------------------------------------------------------------- filters (spec 5.2)

export type ManagerScope = 'direct' | 'indirect';
export interface PeopleFilters {
  q: string;
  departmentIds: string[];
  teamIds: string[];
  managerId: string | null;
  managerScope: ManagerScope;
  statuses: ApiEmployeeStatus[];
  accounts: ApiAccountState[];
  issues: ApiDataIssue[];
}
/** Active and leaving people (someone leaving still works here); Inactive is opt-in for HR. */
export const DEFAULT_STATUSES: ApiEmployeeStatus[] = ['active', 'leaving'];
export const STATUS_LABEL: Record<ApiEmployeeStatus, string> = { active: 'Active', leaving: 'Leaving', inactive: 'Inactive' };
export const ACCOUNT_LABEL: Record<ApiAccountState, string> = { linked: 'Has account', invited: 'Invited', none: 'No account' };
/** The Data issues filter's choices (spec 5.2). */
export const ISSUE_FILTERS: { value: ApiDataIssue; label: string }[] = [
  { value: 'no_manager', label: 'No manager' },
  { value: 'no_start_date', label: 'Start date missing' },
  { value: 'no_department', label: 'No department' },
];
export const ISSUE_LABEL: Record<ApiDataIssue, string> = {
  no_manager: 'No manager',
  no_start_date: 'Start date missing',
  no_department: 'No department',
  manager_no_account: 'Manager has no account',
  no_employee_number: 'Employee number missing',
};
export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = { permanent: 'Permanent', fixed_term: 'Fixed term', contractor: 'Contractor', student: 'Student' };
export const ROLE_LABEL: Record<string, string> = { employee: 'Employee', manager: 'Manager', administration: 'Administration', payroll: 'Payroll', admin: 'Admin' };

const list = <T extends string>(v: string | null, allowed: readonly T[]): T[] => (v ?? '').split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));
const ids = (v: string | null) => (v ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));

/** The filters in the page's URL (`?q=&dept=&team=&manager=&scope=&status=&account=&issues=`). */
export function filtersFromParams(p: URLSearchParams): PeopleFilters {
  return {
    q: p.get('q') ?? '',
    departmentIds: ids(p.get('dept')),
    teamIds: ids(p.get('team')),
    managerId: ids(p.get('manager'))[0] ?? null,
    managerScope: p.get('scope') === 'indirect' ? 'indirect' : 'direct',
    statuses: p.has('status') ? list(p.get('status'), ['active', 'leaving', 'inactive'] as const) : DEFAULT_STATUSES,
    accounts: list(p.get('account'), ['linked', 'invited', 'none'] as const),
    issues: list(p.get('issues'), ['no_manager', 'no_start_date', 'no_department', 'manager_no_account', 'no_employee_number'] as const),
  };
}

/** Whether any filter narrows the directory (the search included). */
export const isFiltered = (f: PeopleFilters) =>
  !!f.q.trim() || f.departmentIds.length > 0 || f.teamIds.length > 0 || !!f.managerId || f.accounts.length > 0 || f.issues.length > 0 || f.statuses.join() !== DEFAULT_STATUSES.join();

/** Managers' reports by manager id (active and leaving only: inactive people report to nobody). */
export function reportsByManager(employees: readonly ApiEmployee[]): Map<string, ApiEmployee[]> {
  const out = new Map<string, ApiEmployee[]>();
  for (const e of employees) {
    if (!e.managerId || e.status === 'inactive') continue;
    const reports = out.get(e.managerId);
    if (reports) reports.push(e);
    else out.set(e.managerId, [e]);
  }
  return out;
}

/** Everyone below `managerId` at any depth ("Including indirect reports"). */
export function reportIdsBelow(byManager: Map<string, ApiEmployee[]>, managerId: string): Set<string> {
  const out = new Set<string>();
  const queue = [managerId];
  while (queue.length) {
    for (const r of byManager.get(queue.pop()!) ?? []) {
      if (out.has(r.id) || r.id === managerId) continue;
      out.add(r.id);
      queue.push(r.id);
    }
  }
  return out;
}

/**
 * The employees that pass every filter (spec 5.2), in the directory's order. The rules match the
 * API's (`GET /api/people/employees`): teams only within the chosen departments, the manager's
 * direct or all reports, statuses as the caller sees them, accounts and data issues where present.
 */
export function filterEmployees(employees: readonly ApiEmployee[], f: PeopleFilters, access: ApiPeopleAccess | null): ApiEmployee[] {
  const hr = isHrOf(access);
  const departments = new Set(f.departmentIds);
  const teams = new Set(f.teamIds);
  const below = f.managerId && f.managerScope === 'indirect' ? reportIdsBelow(reportsByManager(employees), f.managerId) : null;
  const statuses = new Set(f.statuses);
  return employees.filter((e) => {
    if (!statuses.has(e.status)) return false;
    if (departments.size && !(e.departmentId && departments.has(e.departmentId))) return false;
    if (teams.size && !(e.teamId && teams.has(e.teamId))) return false;
    if (f.managerId && (below ? !below.has(e.id) : e.managerId !== f.managerId)) return false;
    if (f.accounts.length && !(e.hr && f.accounts.includes(e.hr.account))) return false;
    if (f.issues.length && !(e.hr && f.issues.some((i) => e.hr!.dataIssues.includes(i)))) return false;
    if (f.q.trim() && !matchesText(e, f.q, hr)) return false;
    return true;
  });
}

// ---------------------------------------------------------------- sorting (the list)

export type SortKey = 'name' | 'jobTitle' | 'department' | 'team' | 'manager' | 'workEmail' | 'workPhone' | 'startDate' | 'type' | 'status' | 'account';
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const sortValue = (e: ApiEmployee, key: SortKey): string => {
  switch (key) {
    case 'name':
      return `${e.lastName}\u0000${e.firstName}`;
    case 'jobTitle':
      return e.jobTitle ?? '';
    case 'department':
      return e.departmentName ?? '';
    case 'team':
      return e.teamName ?? '';
    case 'manager':
      return e.managerName ?? '';
    case 'workEmail':
      return e.workEmail ?? '';
    case 'workPhone':
      return e.workPhone ?? '';
    case 'startDate':
      return e.employment?.startDate ?? '';
    case 'type':
      return e.employment ? (EMPLOYMENT_TYPE_LABEL[e.employment.type] ?? e.employment.type) : '';
    case 'status':
      return STATUS_LABEL[e.status];
    case 'account':
      return e.hr ? ACCOUNT_LABEL[e.hr.account] : '';
  }
};
/** Sorted by a column; empty values last in either direction, then by name. */
export function sortEmployees(employees: readonly ApiEmployee[], key: SortKey, dir: 1 | -1): ApiEmployee[] {
  const keyed = employees.map((e) => ({ e, v: sortValue(e, key), n: sortValue(e, 'name') }));
  keyed.sort((a, b) => {
    if (!a.v !== !b.v) return a.v ? -1 : 1;
    return dir * collator.compare(a.v, b.v) || collator.compare(a.n, b.n);
  });
  return keyed.map((k) => k.e);
}

// ---------------------------------------------------------------- the charts (spec 5.3)

export interface TeamBlock {
  team: ApiTeam | null;
  /** The lead first (when they are in the list), then members by name. */
  people: ApiEmployee[];
  leadId: string | null;
}
export interface DepartmentBlock {
  department: ApiDepartment | null;
  head: ApiEmployee | null;
  teams: TeamBlock[];
  /** People of the department in the blocks (the head is shown at the top, and in their team too). */
  count: number;
}

const byName = (a: ApiEmployee, b: ApiEmployee) => collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName);

/**
 * "By department": one block per department by name (head on top), a box per team (lead first,
 * then members by name), "No team" for the department's people without one, and a last block
 * "No department". `people` is who to show; with `all`, empty departments and teams show too.
 */
export function departmentChart(people: readonly ApiEmployee[], everyone: readonly ApiEmployee[], departments: readonly ApiDepartment[], teams: readonly ApiTeam[], all: boolean): DepartmentBlock[] {
  const byId = new Map(everyone.map((e) => [e.id, e]));
  const byDept = new Map<string | null, ApiEmployee[]>();
  for (const e of people) {
    const key = e.departmentId && departments.some((d) => d.id === e.departmentId) ? e.departmentId : null;
    const at = byDept.get(key);
    if (at) at.push(e);
    else byDept.set(key, [e]);
  }
  const blocks: DepartmentBlock[] = [];
  const sortedDepartments = [...departments].sort((a, b) => collator.compare(a.name, b.name));
  for (const d of [...sortedDepartments, null]) {
    const members = byDept.get(d?.id ?? null) ?? [];
    if (!members.length && (!all || !d)) continue;
    const ownTeams = d ? teams.filter((t) => t.departmentId === d.id).sort((a, b) => collator.compare(a.name, b.name)) : [];
    const byTeam = new Map<string | null, ApiEmployee[]>();
    for (const e of members) {
      const key = e.teamId && ownTeams.some((t) => t.id === e.teamId) ? e.teamId : null;
      const at = byTeam.get(key);
      if (at) at.push(e);
      else byTeam.set(key, [e]);
    }
    const boxes: TeamBlock[] = [];
    for (const t of ownTeams) {
      const inTeam = (byTeam.get(t.id) ?? []).sort(byName);
      if (!inTeam.length && !all) continue;
      const leadAt = inTeam.findIndex((e) => e.id === t.leadEmployeeId);
      const ordered = leadAt > 0 ? [inTeam[leadAt]!, ...inTeam.slice(0, leadAt), ...inTeam.slice(leadAt + 1)] : inTeam;
      boxes.push({ team: t, people: ordered, leadId: t.leadEmployeeId });
    }
    const noTeam = (byTeam.get(null) ?? []).sort(byName);
    if (noTeam.length) boxes.push({ team: null, people: noTeam, leadId: null });
    const head = d?.headEmployeeId ? (byId.get(d.headEmployeeId) ?? null) : null;
    blocks.push({ department: d, head: head && head.status !== 'inactive' ? head : null, teams: boxes, count: members.length });
  }
  return blocks;
}

export interface TreeNode {
  employee: ApiEmployee;
  depth: number;
  children: TreeNode[];
  /** Everyone below, at any depth. */
  size: number;
}

/**
 * "Reporting lines": a tree from "reports to". Roots are people without a manager (or whose
 * manager isn't shown, e.g. inactive); several roots stand side by side, the biggest first.
 * Children by name. Built from `people` (inactive people never appear).
 */
export function reportingTree(people: readonly ApiEmployee[]): TreeNode[] {
  const shown = new Map(people.map((e) => [e.id, e]));
  const children = new Map<string, ApiEmployee[]>();
  const roots: ApiEmployee[] = [];
  for (const e of people) {
    if (e.managerId && shown.has(e.managerId) && e.managerId !== e.id) {
      const at = children.get(e.managerId);
      if (at) at.push(e);
      else children.set(e.managerId, [e]);
    } else roots.push(e);
  }
  const seen = new Set<string>();
  const build = (e: ApiEmployee, depth: number): TreeNode => {
    seen.add(e.id);
    const kids = (children.get(e.id) ?? []).filter((c) => !seen.has(c.id)).sort(byName);
    const nodes = kids.map((c) => build(c, depth + 1));
    return { employee: e, depth, children: nodes, size: nodes.reduce((n, c) => n + 1 + c.size, 0) };
  };
  const trees = roots.sort(byName).map((r) => build(r, 0));
  // A loop the database forbids can't occur, but never lose anyone: what's left becomes a root.
  for (const e of people) if (!seen.has(e.id)) trees.push(build(e, 0));
  return trees.sort((a, b) => b.size - a.size || byName(a.employee, b.employee));
}

/** The ids of every ancestor of the matching people (to expand the path to them). */
export function pathsTo(people: readonly ApiEmployee[], matches: ReadonlySet<string>): Set<string> {
  const byId = new Map(people.map((e) => [e.id, e]));
  const out = new Set<string>();
  for (const id of matches) {
    let at = byId.get(id)?.managerId ?? null;
    let guard = 0;
    while (at && byId.has(at) && !out.has(at) && guard++ < 1000) {
      out.add(at);
      at = byId.get(at)!.managerId;
    }
  }
  return out;
}

// ---------------------------------------------------------------- the store's people actions

/** Mutable bookkeeping that outlives the store's action object (it is rebuilt on navigation). */
export interface PeopleRuntime {
  watchers: number;
  seq: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}
export const newPeopleRuntime = (): PeopleRuntime => ({ watchers: 0, seq: 0, timer: undefined });

interface Ctx {
  cur: () => State;
  set: (u: Partial<State> | ((s: State) => Partial<State>)) => void;
  flash: (msg: string, ms?: number) => void;
  rt: PeopleRuntime;
  errText: (err: unknown) => string;
}

export function peopleActions(ctx: Ctx) {
  const { cur, set, flash, rt } = ctx;
  const patch = (p: Partial<PeopleState>) => set((s) => ({ people: { ...s.people, ...p } }));

  /** Reads the caller's access, then the directory (inactive too for HR), departments and teams. */
  const load = async () => {
    const seq = ++rt.seq;
    patch({ loading: true });
    try {
      const access = await peopleApi.access();
      const [employees, departments, teams] = await Promise.all([
        peopleApi.employees(isHrOf(access) ? { status: ['active', 'leaving', 'inactive'] } : {}),
        peopleApi.departments(),
        peopleApi.teams(),
      ]);
      if (seq !== rt.seq) return;
      patch({ employees, departments, teams, access, loaded: true, loading: false, error: null });
    } catch (err) {
      if (seq !== rt.seq) return;
      patch({ loading: false, error: ctx.errText(err) });
    }
  };

  /** Reads again soon (live hints come in bursts). */
  const refresh = (ms = 300) => {
    if (!cur().people.loaded && !rt.watchers) return;
    clearTimeout(rt.timer);
    rt.timer = setTimeout(() => void load(), ms);
  };

  /** A screen shows the directory: read it (again); the returned function says it is gone. */
  const watch = () => {
    rt.watchers++;
    if (!cur().people.loading) void load();
    return () => {
      rt.watchers = Math.max(0, rt.watchers - 1);
    };
  };

  /** Reads the directory once if it never was (Ctrl/⌘K finds employees). */
  const ensure = () => {
    const p = cur().people;
    if (!p.loaded && !p.loading) void load();
  };

  const onLive = (e: LiveEvent) => {
    if (PEOPLE_HINTS.has(e.type)) refresh();
  };

  /**
   * "Set department and team" / "Set manager" for the ticked rows (spec 5.4), and a drop on the
   * chart (spec 6.3). All or nothing on the server. Returns an error message, or null when saved.
   */
  const bulkUpdate = async (input: BulkEmployeesInput, done: string): Promise<string | null> => {
    try {
      const { updated } = await peopleApi.bulkUpdate(input);
      await load();
      flash(updated === 0 ? 'Nothing to change: they already have these values' : done.replace('{n}', updated === 1 ? '1 employee' : `${updated} employees`));
      return null;
    } catch (err) {
      return ctx.errText(err);
    }
  };

  /** Personal details and bank accounts of these employees, for an export (audited on the server). */
  const exportPersonal = (employeeIds: string[]): Promise<ApiEmployeePersonalExport[]> => peopleApi.exportPersonal(employeeIds);

  return { load, refresh, watch, ensure, onLive, bulkUpdate, exportPersonal };
}
