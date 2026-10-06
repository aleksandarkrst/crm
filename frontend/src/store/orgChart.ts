/**
 * The Org structure page's two charts (CD-137, spec 5.3; CD-225): "By department" blocks and the
 * "Reporting lines" tree, from the directory as the caller sees it. Pure functions without React
 * or the store, so `frontend/test` runs them in Node; store/people.ts re-exports them.
 */
import type { ApiDepartment, ApiEmployee, ApiTeam } from '../lib/api';

export const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
export const byName = (a: ApiEmployee, b: ApiEmployee) => collator.compare(a.lastName, b.lastName) || collator.compare(a.firstName, b.firstName);

export interface TeamBlock {
  team: ApiTeam | null;
  /** The lead first (when they are in the list), then members by name. */
  people: ApiEmployee[];
  leadId: string | null;
}
export interface DepartmentBlock {
  department: ApiDepartment | null;
  /** Shown once, at the top of the department (CD-225): never again in a team box or "No team". */
  head: ApiEmployee | null;
  teams: TeamBlock[];
  /** People of the department (the head included). */
  count: number;
}

/**
 * "By department": one block per department by name (head on top, once), a box per team (lead
 * first, then members by name), "No team" for the department's people without one, and a last
 * block "No department". `people` is who to show; with `all`, empty departments and teams show
 * too. The CEO (`ceoId`, CD-225) sits in the company node above the departments, so they are left
 * out here whatever their department.
 */
export function departmentChart(
  people: readonly ApiEmployee[],
  everyone: readonly ApiEmployee[],
  departments: readonly ApiDepartment[],
  teams: readonly ApiTeam[],
  all: boolean,
  ceoId: string | null = null,
): DepartmentBlock[] {
  const byId = new Map(everyone.map((e) => [e.id, e]));
  const byDept = new Map<string | null, ApiEmployee[]>();
  for (const e of people) {
    if (e.id === ceoId) continue;
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
    const headId = d?.headEmployeeId && d.headEmployeeId !== ceoId ? d.headEmployeeId : null;
    const byTeam = new Map<string | null, ApiEmployee[]>();
    for (const e of members) {
      if (e.id === headId) continue; // shown at the top

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
    const head = headId ? (byId.get(headId) ?? null) : null;
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
