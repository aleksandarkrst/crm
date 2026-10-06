/**
 * The Org structure page's two charts (CD-137, spec 5.3; CD-225, CD-226): the unit tree (company →
 * units of the top level → units inside → … → people) and the "Reporting lines" tree, from the
 * directory as the caller sees it, plus the unit helpers the screens share (paths, units inside,
 * and the org rules' guesses for the confirmations). Pure functions without React or the store, so
 * `frontend/test` runs them in Node; store/people.ts re-exports them.
 */
import type { ApiEmployee, ApiOrgLevel, ApiOrgUnit } from '../lib/api';

export const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export const byName = (a: ApiEmployee, b: ApiEmployee) => collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName);

// ---------------------------------------------------------------- units

/** Units in tree order (parents before their units, siblings by name), with their depth. */
export function unitTree(units: readonly ApiOrgUnit[]): { unit: ApiOrgUnit; depth: number }[] {
  const ids = new Set(units.map((u) => u.id));
  const children = new Map<string | null, ApiOrgUnit[]>();
  for (const u of units) {
    const key = u.parentId && ids.has(u.parentId) ? u.parentId : null;
    const at = children.get(key);
    if (at) at.push(u);
    else children.set(key, [u]);
  }
  const out: { unit: ApiOrgUnit; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const u of [...(children.get(parent) ?? [])].sort((a, b) => collator.compare(a.name, b.name))) {
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      out.push({ unit: u, depth });
      walk(u.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The names from the top down to the unit: ["Sales", "Field sales"]. */
export function unitPath(units: readonly ApiOrgUnit[], unitId: string | null | undefined): string[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: string[] = [];
  let at = unitId ? byId.get(unitId) : undefined;
  while (at && out.length < 20) {
    out.unshift(at.name);
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return out;
}

/** "Sales › Field sales", or the fallback when the unit isn't known. */
export const unitPathLabel = (units: readonly ApiOrgUnit[], unitId: string | null | undefined, fallback: string | null = null) => unitPath(units, unitId).join(' › ') || fallback || '';

/** The unit and every unit inside it. */
export function unitsBelow(units: readonly ApiOrgUnit[], unitId: string): Set<string> {
  const out = new Set([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Who the server will make someone's manager when they join `unitId` (org rules, CD-226): the
 * unit's lead, else the nearest lead above, else the CEO; never the person. For the confirmations
 * only: the server also skips anyone who would close a loop.
 */
export function managerForUnit(units: readonly ApiOrgUnit[], unitId: string, personId: string, ceoId: string | null): string | null {
  if (personId === ceoId) return null;
  const byId = new Map(units.map((u) => [u.id, u]));
  let at = byId.get(unitId);
  let guard = 0;
  while (at && guard++ < 20) {
    if (at.leadEmployeeId && at.leadEmployeeId !== personId) return at.leadEmployeeId;
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return ceoId && ceoId !== personId ? ceoId : null;
}

/** The unit someone joins when they get `managerId`: the one the manager leads, else the manager's own (CD-226). */
export function unitForManager(units: readonly ApiOrgUnit[], employees: readonly Pick<ApiEmployee, 'id' | 'unitId'>[], managerId: string): string | null {
  return units.find((u) => u.leadEmployeeId === managerId)?.id ?? employees.find((e) => e.id === managerId)?.unitId ?? null;
}

/**
 * The unit filter's ids from the page's URL: `unit=`, and links from before CD-226 (`dept=`,
 * `team=`; departments and teams became units with the same ids; a team narrowed its department).
 */
export function unitIdsFromParams(p: URLSearchParams): string[] {
  const ids = (v: string | null) => (v ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  return [...new Set([...ids(p.get('unit')), ...ids(p.get('team')), ...(p.has('team') ? [] : ids(p.get('dept')))])];
}

// ---------------------------------------------------------------- the unit chart

export interface UnitNode {
  unit: ApiOrgUnit;
  level: ApiOrgLevel | null;
  /** Shown once, on top of the unit: never again among the members of any unit or "No unit". */
  lead: ApiEmployee | null;
  /** Direct members by name (the lead and the CEO left out). */
  members: ApiEmployee[];
  children: UnitNode[];
  /** People in the unit and the units inside it (the lead included). */
  count: number;
}

export interface UnitChart {
  /** Units directly under the company, by level and name. */
  roots: UnitNode[];
  /** People without a unit (hanging off the company node). */
  noUnit: ApiEmployee[];
}

/**
 * "By unit" (CD-226): the company's units as a tree, each with its lead on top and its direct
 * members, then the units inside it; people without a unit in `noUnit`. `people` is who to show;
 * with `all` (no filter), units without anyone show too, otherwise only units with someone in
 * them or below. The CEO (`ceoId`, CD-225) sits in the company node, so is left out here.
 */
export function unitChart(
  people: readonly ApiEmployee[],
  everyone: readonly ApiEmployee[],
  levels: readonly ApiOrgLevel[],
  units: readonly ApiOrgUnit[],
  all: boolean,
  ceoId: string | null = null,
): UnitChart {
  const shown = new Set(people.map((e) => e.id));
  const byId = new Map(everyone.map((e) => [e.id, e]));
  const unitIds = new Set(units.map((u) => u.id));
  const leads = new Set(units.map((u) => u.leadEmployeeId).filter((id): id is string => !!id && id !== ceoId));
  const levelOf = new Map(levels.map((l) => [l.id, l]));
  const position = (u: ApiOrgUnit) => levelOf.get(u.levelId)?.position ?? 99;

  const members = new Map<string | null, ApiEmployee[]>();
  for (const e of people) {
    if (e.id === ceoId || leads.has(e.id)) continue;
    const key = e.unitId && unitIds.has(e.unitId) ? e.unitId : null;
    const at = members.get(key);
    if (at) at.push(e);
    else members.set(key, [e]);
  }
  const children = new Map<string | null, ApiOrgUnit[]>();
  for (const u of units) {
    const key = u.parentId && unitIds.has(u.parentId) ? u.parentId : null;
    const at = children.get(key);
    if (at) at.push(u);
    else children.set(key, [u]);
  }
  const order = (a: ApiOrgUnit, b: ApiOrgUnit) => position(a) - position(b) || collator.compare(a.name, b.name);

  const seen = new Set<string>();
  const build = (u: ApiOrgUnit): UnitNode | null => {
    seen.add(u.id);
    const kids = (children.get(u.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(order)
      .map(build)
      .filter((n): n is UnitNode => !!n);
    const own = (members.get(u.id) ?? []).sort(byName);
    const leadRow = u.leadEmployeeId && u.leadEmployeeId !== ceoId ? byId.get(u.leadEmployeeId) : undefined;
    const lead = leadRow && leadRow.status !== 'inactive' && shown.has(leadRow.id) ? leadRow : null;
    const count = own.length + (lead ? 1 : 0) + kids.reduce((n, k) => n + k.count, 0);
    if (!count && !all) return null;
    return { unit: u, level: levelOf.get(u.levelId) ?? null, lead, members: own, children: kids, count };
  };
  const roots = (children.get(null) ?? [])
    .sort(order)
    .map(build)
    .filter((n): n is UnitNode => !!n);
  return { roots, noUnit: (members.get(null) ?? []).sort(byName) };
}

// ---------------------------------------------------------------- reporting lines

export interface TreeNode {
  employee: ApiEmployee;
  depth: number;
  children: TreeNode[];
  /** Everyone below, at any depth. */
  size: number;
}

/**
 * "Reporting lines": a tree from "reports to". Roots are people without a manager (or whose
 * manager isn't shown, e.g. inactive); several roots stand side by side, the CEO first when set
 * (CD-225), then the biggest. Children by name. Built from `people` (inactive people never appear).
 */
export function reportingTree(people: readonly ApiEmployee[], ceoId: string | null = null): TreeNode[] {
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
  return trees.sort((a, b) => Number(b.employee.id === ceoId) - Number(a.employee.id === ceoId) || b.size - a.size || byName(a.employee, b.employee));
}
