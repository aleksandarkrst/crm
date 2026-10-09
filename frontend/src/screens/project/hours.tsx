import type { ApiProject } from '../../lib/projectsApi';
import { shortHours } from '../../lib/timesheetApi';
import { useStore } from '../../store/store';

/**
 * Logged hours on projects (CD-277, design `Timesheet.dc.html#cd-277`): everyone's time entries on
 * a project's tasks and work orders, against its budget when it has one, in the workspace's format.
 */

/** "41.5 h" (or "41:30 h") in the workspace's format. */
export function useHours() {
  const { s } = useStore();
  const format = s.workspace.timesheet.timeFormat;
  return (minutes: number) => `${shortHours(minutes, format)} h`;
}

const budgetMinutesOf = (p: Pick<ApiProject, 'budgetHours'>) => (p.budgetHours == null ? null : Math.round(Number(p.budgetHours) * 60));

/** The colour of logged against the budget: red over it, amber from 95 %, green below; grey without a budget. */
export function loggedColor(p: Pick<ApiProject, 'budgetHours' | 'loggedMinutes'>): string {
  const budget = budgetMinutesOf(p);
  if (!budget) return 'var(--text-2)';
  if (p.loggedMinutes > budget) return 'var(--danger)';
  return p.loggedMinutes >= budget * 0.95 ? 'var(--warn)' : 'var(--green-500)';
}

/** "38 / 40 h" with a bar, or "286 h" without a budget (the Projects table's Logged / budget). */
export function LoggedBudget({ project }: { project: ApiProject }) {
  const h = useHours();
  const budget = budgetMinutesOf(project);
  const color = loggedColor(project);
  const pct = budget ? Math.min(100, Math.round((project.loggedMinutes / budget) * 100)) : 0;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }} data-testid="project-logged" title={budget ? `${h(project.loggedMinutes)} of a ${h(budget)} budget` : 'No budget'}>
      <span style={{ fontSize: 12.5, color, minWidth: 70, whiteSpace: 'nowrap' }}>{budget ? `${h(project.loggedMinutes).replace(' h', '')} / ${h(budget)}` : h(project.loggedMinutes)}</span>
      <span style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--chip)', overflow: 'hidden', minWidth: 30 }}>
        <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: color }} />
      </span>
    </span>
  );
}

/** "126 of 120 h" (red over the budget) or "286 h logged · no budget": the company card's total per project. */
export function loggedTotalText(p: ApiProject, h: (minutes: number) => string): string {
  const budget = budgetMinutesOf(p);
  return budget ? `${h(p.loggedMinutes).replace(' h', '')} of ${h(budget)}` : `${h(p.loggedMinutes)} logged · no budget`;
}
