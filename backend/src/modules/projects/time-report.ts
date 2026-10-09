/**
 * The time report (CD-149, spec 10.2), pure and unit-tested: the period's dates, the tree of
 * projects, stages (the spec's phases), tasks and people with limits, remaining hours and flags, and
 * its CSV. TimeReportService reads one row per person and task from the database and builds it here.
 *
 * Logged and Approved are the period's; Remaining, Used % and the flag always compare the limit with
 * all-time logged hours, since a limit is for the whole task.
 */

export const REPORT_PERIODS = ['all', 'this_month', 'last_month', 'this_quarter', 'this_year', 'range'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
/** The last day of month `m` (1–12; 13 is January of the next year). */
const lastDay = (y: number, m: number) => iso(y, m + 1, 0);

/**
 * The period's first and last day (both included), or null for All time. Quarters and years follow
 * the fiscal year (`fiscalStartMonth`, 1 = January): with April, "This year" on 9 Oct 2026 is 1 Apr
 * 2026 to 31 Mar 2027 and "This quarter" 1 Oct to 31 Dec.
 */
export function periodRange(period: ReportPeriod, today: string, fiscalStartMonth: number, from?: string, to?: string): { from: string; to: string } | null {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (period) {
    case 'all':
      return null;
    case 'this_month':
      return { from: iso(y, m, 1), to: lastDay(y, m) };
    case 'last_month':
      return { from: iso(y, m - 1, 1), to: lastDay(y, m - 1) };
    case 'this_quarter': {
      const start = m - ((m - fiscalStartMonth + 12) % 3);
      return { from: iso(y, start, 1), to: lastDay(y, start + 2) };
    }
    case 'this_year': {
      const startYear = m >= fiscalStartMonth ? y : y - 1;
      return { from: iso(startYear, fiscalStartMonth, 1), to: lastDay(startYear, fiscalStartMonth + 11) };
    }
    case 'range':
      return { from: from!, to: to! };
  }
}

/** One person on one task, as read: current assignees and anyone who logged time on it. */
export interface ReportLeaf {
  projectId: string;
  projectName: string;
  projectCode: string | null;
  companyName: string;
  stageId: string | null;
  stageName: string | null;
  stagePosition: number | null;
  taskId: string;
  taskNumber: number;
  taskName: string;
  taskStatus: string;
  employeeId: string;
  personName: string;
  /** Assigned now; false: "Not assigned any more" (their hours still count). */
  active: boolean;
  /** Their limit in minutes; null without one, or when no longer assigned. */
  limitMinutes: number | null;
  loggedMinutes: number;
  approvedMinutes: number;
  allTimeMinutes: number;
}

export type ReportFlag = 'eighty' | 'reached' | 'over';
export type NodeKind = 'project' | 'stage' | 'task' | 'person';

export interface ReportNode {
  kind: NodeKind;
  id: string;
  name: string;
  /** "T-142" for tasks, the project's code for projects. */
  code: string | null;
  /** Projects: the company. Tasks: the status. People on a task: whether still assigned. */
  companyName?: string;
  status?: string;
  notAssigned?: boolean;
  /** Minutes. Null: unknown. `limitPartial`: the sum of the known limits only (spec: "partial"). */
  limitMinutes: number | null;
  limitPartial: boolean;
  loggedMinutes: number;
  approvedMinutes: number;
  allTimeMinutes: number;
  /** Limit minus all-time logged (negative when over); null without a full limit. */
  remainingMinutes: number | null;
  /** All-time logged / limit, rounded; null without a full limit. */
  usedPercent: number | null;
  /** "80%" from 80 %, "Limit reached" at 100 %, "Over limit" above it. */
  flag: ReportFlag | null;
  children: ReportNode[];
}

export const flagOf = (allTime: number, limit: number | null): ReportFlag | null =>
  limit == null || limit <= 0 ? null : allTime > limit ? 'over' : allTime === limit ? 'reached' : allTime * 5 >= limit * 4 ? 'eighty' : null;

/** Whether a person on a task is at 80 % of their limit or more ("Only over 80% of limit"). */
export const over80 = (l: ReportLeaf) => flagOf(l.allTimeMinutes, l.limitMinutes) !== null;

type Limit = { limitMinutes: number | null; limitPartial: boolean };

function node(kind: NodeKind, id: string, name: string, code: string | null, limit: Limit, children: ReportNode[], leaves: ReportLeaf[], extra: Partial<ReportNode> = {}): ReportNode {
  const sum = (f: (l: ReportLeaf) => number) => leaves.reduce((a, l) => a + f(l), 0);
  const allTime = sum((l) => l.allTimeMinutes);
  const full = limit.limitMinutes != null && !limit.limitPartial;
  return {
    kind,
    id,
    name,
    code,
    ...extra,
    ...limit,
    loggedMinutes: sum((l) => l.loggedMinutes),
    approvedMinutes: sum((l) => l.approvedMinutes),
    allTimeMinutes: allTime,
    remainingMinutes: full ? limit.limitMinutes! - allTime : null,
    usedPercent: full && limit.limitMinutes! > 0 ? Math.round((allTime / limit.limitMinutes!) * 100) : null,
    flag: full ? flagOf(allTime, limit.limitMinutes) : null,
    children,
  };
}

/** A group's limit: the sum of its children's known limits, "partial" when some are unknown. */
function sumLimits(children: Limit[]): Limit {
  const known = children.filter((c) => c.limitMinutes != null);
  if (!known.length) return { limitMinutes: null, limitPartial: false };
  return { limitMinutes: known.reduce((a, c) => a + c.limitMinutes!, 0), limitPartial: known.length < children.length || known.some((c) => c.limitPartial) };
}

/** A task's limit: the sum of its current assignees' limits when every one of them has one (spec 8, 10.2). */
function taskLimit(leaves: ReportLeaf[]): Limit {
  const current = leaves.filter((l) => l.active);
  const full = current.length > 0 && current.every((l) => l.limitMinutes != null);
  return { limitMinutes: full ? current.reduce((a, l) => a + l.limitMinutes!, 0) : null, limitPartial: false };
}

function groupBy<K>(leaves: ReportLeaf[], key: (l: ReportLeaf) => K): Map<K, ReportLeaf[]> {
  const groups = new Map<K, ReportLeaf[]>();
  for (const l of leaves) groups.set(key(l), [...(groups.get(key(l)) ?? []), l]);
  return groups;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const leafLimit = (l: ReportLeaf): Limit => ({ limitMinutes: l.limitMinutes, limitPartial: false });
const personLeaf = (l: ReportLeaf) => node('person', l.employeeId, l.personName, null, leafLimit(l), [], [l], { notAssigned: !l.active });
const taskOf = (ls: ReportLeaf[], limit: Limit, children: ReportNode[], extra: Partial<ReportNode> = {}) =>
  node('task', ls[0]!.taskId, ls[0]!.taskName, `T-${ls[0]!.taskNumber}`, limit, children, ls, { status: ls[0]!.taskStatus, ...extra });
const byNumber = (ls: ReportLeaf[][]) => ls.sort((a, b) => a[0]!.taskNumber - b[0]!.taskNumber);

/** Project › Stage › Task › Person: tasks without a stage sit right under the project. */
function byProject(leaves: ReportLeaf[]): ReportNode[] {
  const task = (ls: ReportLeaf[]) => taskOf(ls, taskLimit(ls), ls.map(personLeaf).sort(byName));
  return [...groupBy(leaves, (l) => l.projectId).values()]
    .map((pls) => {
      const stages = [...groupBy(pls.filter((l) => l.stageId), (l) => l.stageId!).values()]
        .sort((a, b) => (a[0]!.stagePosition ?? 0) - (b[0]!.stagePosition ?? 0))
        .map((sls) => {
          const tasks = byNumber([...groupBy(sls, (l) => l.taskId).values()]).map(task);
          return node('stage', sls[0]!.stageId!, sls[0]!.stageName ?? 'Stage', null, sumLimits(tasks), tasks, sls);
        });
      const loose = byNumber([...groupBy(pls.filter((l) => !l.stageId), (l) => l.taskId).values()]).map(task);
      const children = [...stages, ...loose];
      const p = pls[0]!;
      return node('project', p.projectId, p.projectName, p.projectCode, sumLimits(children), children, pls, { companyName: p.companyName });
    })
    .sort(byName);
}

/** Person › Project › Task: someone's time across projects; a task's limit is theirs. */
function byPerson(leaves: ReportLeaf[]): ReportNode[] {
  return [...groupBy(leaves, (l) => l.employeeId).values()]
    .map((els) => {
      const projects = [...groupBy(els, (l) => l.projectId).values()]
        .map((pls) => {
          // One leaf per task here: the person's own line, with their limit.
          const tasks = byNumber([...groupBy(pls, (l) => l.taskId).values()]).map((ls) => taskOf(ls, leafLimit(ls[0]!), [], { notAssigned: !ls[0]!.active }));
          const p = pls[0]!;
          return node('project', p.projectId, p.projectName, p.projectCode, sumLimits(tasks), tasks, pls, { companyName: p.companyName });
        })
        .sort(byName);
      return node('person', els[0]!.employeeId, els[0]!.personName, null, sumLimits(projects), projects, els);
    })
    .sort(byName);
}

export interface TimeReport {
  groupBy: 'project' | 'person';
  period: { from: string; to: string } | null;
  rows: ReportNode[];
  total: ReportNode;
}

/** The report from its leaves; `onlyOver80` keeps the people at 80 % of their limit or more. */
export function buildReport(leaves: ReportLeaf[], opts: { groupBy: 'project' | 'person'; period: { from: string; to: string } | null; onlyOver80?: boolean }): TimeReport {
  const kept = opts.onlyOver80 ? leaves.filter(over80) : leaves;
  const rows = opts.groupBy === 'person' ? byPerson(kept) : byProject(kept);
  return { groupBy: opts.groupBy, period: opts.period, rows, total: node('project', 'total', 'Total', null, sumLimits(rows), [], kept) };
}

/** "7.25" (hours with up to two decimals, spec 10.1). */
const hours = (minutes: number | null) => (minutes == null ? null : Math.round((minutes / 60) * 100) / 100);
const FLAG_TEXT: Record<ReportFlag, string> = { eighty: '80%', reached: 'Limit reached', over: 'Over limit' };

export type CsvValue = string | number | null;

/** One cell like the CRM exports: numbers stay numbers, text is guarded against formulas and quoted when needed. */
export function csvCell(value: CsvValue): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",;\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The report as CSV (UTF-8 with a BOM, CRLF): one line per row of the screen, subtotals included, in
 * its order, with the path in the first columns, then the Total line.
 */
export function reportCsv(report: TimeReport): string {
  const levels: NodeKind[] = report.groupBy === 'person' ? ['person', 'project', 'task'] : ['project', 'stage', 'task', 'person'];
  const LABEL: Record<NodeKind, string> = { project: 'Project', stage: 'Phase', task: 'Task', person: 'Person' };
  const header = [...levels.map((k) => LABEL[k]), 'Limit (h)', 'Limit partial', 'Logged (h)', 'Approved (h)', 'Remaining (h)', 'Used %', 'Flag', 'Note'];
  const lines: CsvValue[][] = [header];
  const figures = (n: ReportNode): CsvValue[] => [
    hours(n.limitMinutes),
    n.limitPartial ? 'partial' : null,
    hours(n.loggedMinutes),
    hours(n.approvedMinutes),
    hours(n.remainingMinutes),
    n.usedPercent,
    n.flag ? (n.flag === 'over' ? `Over limit +${hours(n.allTimeMinutes - n.limitMinutes!)} h` : FLAG_TEXT[n.flag]) : null,
    n.notAssigned ? 'Not assigned any more' : null,
  ];
  const walk = (n: ReportNode, path: Partial<Record<NodeKind, string>>) => {
    const here = { ...path, [n.kind]: n.code && n.kind === 'task' ? `${n.code} ${n.name}` : n.name };
    lines.push([...levels.map((k) => here[k] ?? null), ...figures(n)]);
    for (const c of n.children) walk(c, here);
  };
  for (const r of report.rows) walk(r, {});
  lines.push(['Total', ...levels.slice(1).map(() => null), ...figures(report.total)]);
  return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
