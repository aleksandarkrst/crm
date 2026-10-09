/**
 * A project's Report tab and the Workload report (CD-261, design v2 §2 and §9), pure and
 * unit-tested. Hours compare with estimates, in minutes. A task's estimate is shared evenly by its
 * current people, so the person view adds up to the stage view; logged hours are each person's own.
 */

export interface ReportTask {
  id: string;
  stageId: string | null;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  estimateMinutes: number | null;
  /** Current people on the task. */
  assigneeIds: string[];
  /** Logged minutes per person (removed people too). */
  logged: Map<string, number>;
}

export interface Stats {
  tasks: number;
  doneTasks: number;
  openTasks: number;
  estimateMinutes: number;
  loggedMinutes: number;
  /** Open tasks only: estimate minus logged, never below 0 per task. */
  remainingMinutes: number;
  /** Estimate of the done tasks as a share of the whole estimate ("Done, by estimate"). */
  donePercent: number;
  /** Logged on done tasks above their estimate (logged turns red). */
  overEstimate: boolean;
  /** Logged vs estimate on done tasks, in percent (+12 = 12 % over); null without done estimates. */
  variancePercent: number | null;
  lateTasks: number;
}

interface Line {
  done: boolean;
  late: boolean;
  estimate: number;
  logged: number;
}

function stats(lines: Line[]): Stats {
  const sum = (ls: Line[], f: (l: Line) => number) => ls.reduce((a, l) => a + f(l), 0);
  const done = lines.filter((l) => l.done);
  const open = lines.filter((l) => !l.done);
  const estimate = sum(lines, (l) => l.estimate);
  const doneEst = sum(done, (l) => l.estimate);
  const doneLog = sum(done, (l) => l.logged);
  return {
    tasks: lines.length,
    doneTasks: done.length,
    openTasks: open.length,
    estimateMinutes: estimate,
    loggedMinutes: sum(lines, (l) => l.logged),
    remainingMinutes: sum(open, (l) => Math.max(l.estimate - l.logged, 0)),
    donePercent: estimate ? Math.round((doneEst / estimate) * 100) : 0,
    overEstimate: doneLog > doneEst,
    variancePercent: doneEst ? Math.round(((doneLog - doneEst) / doneEst) * 100) : null,
    lateTasks: open.filter((l) => l.late).length,
  };
}

const allLogged = (t: ReportTask) => [...t.logged.values()].reduce((a, m) => a + m, 0);
const isLate = (t: ReportTask, today: string) => t.status !== 'done' && !!t.dueDate && t.dueDate < today;
/** A person's share of a task's estimate: split evenly among its current people. */
export const shareOf = (t: ReportTask, employeeId: string) => (t.assigneeIds.includes(employeeId) && t.estimateMinutes ? t.estimateMinutes / t.assigneeIds.length : 0);

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface StageRow extends Stats {
  id: string | null;
  name: string;
  /** The latest due date of its tasks. */
  dueDate: string | null;
}

export interface PersonRow extends Stats {
  employeeId: string;
  name: string;
}

export interface ProjectReport {
  summary: Stats & {
    budgetMinutes: number | null;
    onHoldTasks: number;
    /** Days the finish slips: the latest open task's lateness, plus 5 when work is on hold; null without an end date or when closed. */
    forecast: { slipDays: number; date: string } | null;
  };
  stages: StageRow[];
  people: PersonRow[];
}

/**
 * The Report tab: the summary, "By stage" (stages in order that have tasks, then tasks without a
 * stage) and "By person" (current people on its tasks and anyone who logged time on them).
 */
export function projectReport(input: {
  tasks: ReportTask[];
  stages: { id: string; name: string; position: number }[];
  people: Map<string, string>;
  today: string;
  budgetHours: number | null;
  endDate: string | null;
  open: boolean;
}): ProjectReport {
  const { tasks, today } = input;
  const taskLine = (t: ReportTask): Line => ({ done: t.status === 'done', late: isLate(t, today), estimate: t.estimateMinutes ?? 0, logged: allLogged(t) });
  const all = stats(tasks.map(taskLine));
  const groups = [...[...input.stages].sort((a, b) => a.position - b.position), { id: null, name: 'No stage', position: Infinity }];
  const stages = groups
    .map((g) => ({ g, ts: tasks.filter((t) => t.stageId === g.id || (g.id === null && !input.stages.some((s) => s.id === t.stageId))) }))
    .filter(({ ts }) => ts.length > 0)
    .map(({ g, ts }) => ({ id: g.id, name: g.name, dueDate: ts.reduce<string | null>((m, t) => (t.dueDate && (!m || t.dueDate > m) ? t.dueDate : m), null), ...stats(ts.map(taskLine)) }));
  const ids = new Set(tasks.flatMap((t) => [...t.assigneeIds, ...[...t.logged.entries()].filter(([, m]) => m > 0).map(([id]) => id)]));
  const people = [...ids]
    .map((id) => {
      const mine = tasks.filter((t) => t.assigneeIds.includes(id) || (t.logged.get(id) ?? 0) > 0);
      const lines = mine.map((t) => ({ done: t.status === 'done', late: isLate(t, today) && t.assigneeIds.includes(id), estimate: shareOf(t, id), logged: t.logged.get(id) ?? 0 }));
      const s = stats(lines);
      // Open tasks count only the ones they're still on.
      return { employeeId: id, name: input.people.get(id) ?? 'Former employee', ...s, openTasks: mine.filter((t) => t.status !== 'done' && t.assigneeIds.includes(id)).length };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const onHold = openTasks.filter((t) => t.status === 'on_hold').length;
  const slip = openTasks.reduce((m, t) => Math.max(m, t.dueDate && t.dueDate < today ? daysBetween(t.dueDate, today) : 0), 0) + (onHold ? 5 : 0);
  return {
    summary: {
      ...all,
      budgetMinutes: input.budgetHours == null ? null : Math.round(input.budgetHours * 60),
      onHoldTasks: onHold,
      forecast: input.open && input.endDate ? { slipDays: slip, date: addDays(input.endDate, slip) } : null,
    },
    stages,
    people,
  };
}

/** An open task's remaining minutes for one person, and when the work happens. */
export interface WorkloadTask {
  startDate: string | null;
  dueDate: string | null;
  remainingMinutes: number;
}

/**
 * The Workload report's cells (design §9): each open task's remaining minutes, spread evenly over
 * its days from its start (or today) to its due date (or today when late, or its start without
 * one), summed per week (Monday to Sunday, `weeks` are Mondays). Work after the last week is left out.
 */
export function workloadCells(tasks: WorkloadTask[], weeks: string[], today: string): number[] {
  const cells = weeks.map(() => 0);
  for (const t of tasks) {
    if (t.remainingMinutes <= 0) continue;
    const start = t.startDate && t.startDate > today ? t.startDate : today;
    const due = t.dueDate ?? start;
    const end = due > start ? due : start;
    const span = daysBetween(start, end) + 1;
    weeks.forEach((w, i) => {
      const from = w > start ? w : start;
      const sunday = addDays(w, 6);
      const to = sunday < end ? sunday : end;
      const days = daysBetween(from, to) + 1;
      if (days > 0) cells[i]! += (t.remainingMinutes * days) / span;
    });
  }
  return cells.map((m) => Math.round(m));
}
