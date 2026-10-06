/**
 * People (milestone 13): the store's employee slice and the Org structure page's rules (CD-137).
 *
 * The directory isn't part of the workspace load. The first screen that needs it (the Org
 * structure page, Ctrl/⌘K) calls `people.watch()`; the whole directory then comes in one response
 * (the API sends all rows, up to a few thousand) with the org levels and units (CD-226) and the
 * caller's own access, and stays in `s.people`. Filters, search, sorting and both charts run in the browser on
 * that copy, so they answer at once and agree with each other.
 *
 * What a row carries is the API's decision (spec 9): `employment`, `hr` and `roles` are present only
 * where the caller may see them. Nothing here assumes they exist.
 *
 * Live updates (CD-20): hints `employee`, `org_unit`, `org_level` and `employee_role` read the
 * directory again (a rename or a new manager changes other rows' names too), after a short pause.
 */
import { type ApiDataIssue, type ApiEmployee, type ApiEmployeePersonalExport, type ApiEmployeeStatus, type ApiAccountState, type ApiOrgLevel, type ApiOrgUnit, type ApiPeopleAccess, type BulkEmployeesInput, peopleApi } from '../lib/api';
import { withHeadConfirm } from '../lib/headMoves';
import type { LiveEvent } from './live';
import { collator, unitIdsFromParams, unitsBelow } from './orgChart';
import type { State } from './types';

export interface PeopleState {
  /** The directory as the API shows this caller: active and leaving, plus inactive for Admins. */
  employees: ApiEmployee[];
  /** The org levels top-down and every unit (CD-226). */
  levels: ApiOrgLevel[];
  units: ApiOrgUnit[];
  access: ApiPeopleAccess | null;
  /** Read at least once. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
}
export const emptyPeople = (): PeopleState => ({ employees: [], levels: [], units: [], access: null, loaded: false, loading: false, error: null });

/** The live hint types that mean "read the directory again". */
export const PEOPLE_HINTS = new Set(['employee', 'org_unit', 'org_level', 'employee_role']);

// ---------------------------------------------------------------- who the caller is

export const isAdminOf = (a: ApiPeopleAccess | null) => !!a?.roles.includes('admin');
/** HR work (manages employees, sees inactive ones, data issues, bulk actions, export): Admins only since CD-225. */
export const isHrOf = (a: ApiPeopleAccess | null) => isAdminOf(a);
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
    .map(({ e }) => ({ id: e.id, title: e.fullName, subtitle: [e.jobTitle, e.unitName].filter(Boolean).join(' · '), initials: initialsOfEmployee(e) }));
}

/** "AP" for Ana Petrović. */
export const initialsOfEmployee = (e: Pick<ApiEmployee, 'firstName' | 'lastName'>) => ((e.firstName[0] ?? '') + (e.lastName[0] ?? '')).toUpperCase() || '?';

// ---------------------------------------------------------------- filters (spec 5.2)

export type ManagerScope = 'direct' | 'indirect';
export interface PeopleFilters {
  q: string;
  /** People in these units or a unit inside them (CD-226). */
  unitIds: string[];
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
  { value: 'no_unit', label: 'No unit' },
];
export const ISSUE_LABEL: Record<ApiDataIssue, string> = {
  no_manager: 'No manager',
  no_start_date: 'Start date missing',
  no_unit: 'No unit',
  manager_no_account: 'Manager has no account',
  no_employee_number: 'Employee number missing',
};
export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = { permanent: 'Permanent', fixed_term: 'Fixed term', contractor: 'Contractor', student: 'Student' };
export const ROLE_LABEL: Record<string, string> = { employee: 'Employee', manager: 'Manager', admin: 'Admin' };

const list = <T extends string>(v: string | null, allowed: readonly T[]): T[] => (v ?? '').split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));
const ids = (v: string | null) => (v ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));

/**
 * The filters in the page's URL (`?q=&unit=&manager=&scope=&status=&account=&issues=`). Links from
 * before CD-226 (`dept=`, `team=`) still work: departments and teams became units with the same ids.
 */
export function filtersFromParams(p: URLSearchParams): PeopleFilters {
  return {
    q: p.get('q') ?? '',
    unitIds: unitIdsFromParams(p),
    managerId: ids(p.get('manager'))[0] ?? null,
    managerScope: p.get('scope') === 'indirect' ? 'indirect' : 'direct',
    statuses: p.has('status') ? list(p.get('status'), ['active', 'leaving', 'inactive'] as const) : DEFAULT_STATUSES,
    accounts: list(p.get('account'), ['linked', 'invited', 'none'] as const),
    issues: list(p.get('issues'), ['no_manager', 'no_start_date', 'no_unit', 'manager_no_account', 'no_employee_number'] as const),
  };
}

/** Whether any filter narrows the directory (the search included). */
export const isFiltered = (f: PeopleFilters) =>
  !!f.q.trim() || f.unitIds.length > 0 || !!f.managerId || f.accounts.length > 0 || f.issues.length > 0 || f.statuses.join() !== DEFAULT_STATUSES.join();

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
 * API's (`GET /api/people/employees`): a unit with the units inside it, the manager's direct or
 * all reports, statuses as the caller sees them, accounts and data issues where present.
 */
export function filterEmployees(employees: readonly ApiEmployee[], f: PeopleFilters, access: ApiPeopleAccess | null, units: readonly ApiOrgUnit[] = []): ApiEmployee[] {
  const hr = isHrOf(access);
  const inUnits = new Set(f.unitIds.flatMap((id) => [...unitsBelow(units, id)]));
  const below = f.managerId && f.managerScope === 'indirect' ? reportIdsBelow(reportsByManager(employees), f.managerId) : null;
  const statuses = new Set(f.statuses);
  return employees.filter((e) => {
    if (!statuses.has(e.status)) return false;
    if (f.unitIds.length && !(e.unitId && inUnits.has(e.unitId))) return false;
    if (f.managerId && (below ? !below.has(e.id) : e.managerId !== f.managerId)) return false;
    if (f.accounts.length && !(e.hr && f.accounts.includes(e.hr.account))) return false;
    if (f.issues.length && !(e.hr && f.issues.some((i) => e.hr!.dataIssues.includes(i)))) return false;
    if (f.q.trim() && !matchesText(e, f.q, hr)) return false;
    return true;
  });
}

// ---------------------------------------------------------------- sorting (the list)

export type SortKey = 'name' | 'jobTitle' | 'unit' | 'manager' | 'workEmail' | 'workPhone' | 'startDate' | 'type' | 'status' | 'account';
const sortValue = (e: ApiEmployee, key: SortKey): string => {
  switch (key) {
    case 'name':
      return `${e.lastName}\u0000${e.firstName}`;
    case 'jobTitle':
      return e.jobTitle ?? '';
    case 'unit':
      return e.unitName ?? '';
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

export { managerForUnit, reportingTree, type TreeNode, unitChart, type UnitChart, unitForManager, type UnitNode, unitPath, unitPathLabel, unitsBelow, unitTree } from './orgChart';

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

  /** Reads the caller's access, then the directory (inactive too for HR), the levels and units. */
  const load = async () => {
    const seq = ++rt.seq;
    patch({ loading: true });
    try {
      const access = await peopleApi.access();
      const [employees, levels, units] = await Promise.all([
        peopleApi.employees(isHrOf(access) ? { status: ['active', 'leaving', 'inactive'] } : {}),
        peopleApi.levels(),
        peopleApi.units(),
      ]);
      if (seq !== rt.seq) return;
      patch({ employees, levels, units, access, loaded: true, loading: false, error: null });
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
   * "Set unit" / "Set manager" for the ticked rows (spec 5.4), and a drop on the chart (a person on
   * a unit or on a person, CD-226). All or nothing on the server, which applies the org rules.
   * Moving a unit's lead elsewhere asks first (CD-225). Returns an error message, or null when
   * saved (or not confirmed).
   */
  const bulkUpdate = async (input: BulkEmployeesInput, done: string): Promise<string | null> => {
    try {
      const saved = await withHeadConfirm((clear) => peopleApi.bulkUpdate(clear ? { ...input, clearLeadRoles: true } : input));
      if (!saved) return null;
      const { updated } = saved;
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
