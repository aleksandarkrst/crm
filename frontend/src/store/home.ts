import type { ApiApprovals } from '../lib/timesheetApi';
import type { ApiApprovalRow as ApiTimeOffApproval } from '../lib/timeOffApi';
import { timeOffApi } from '../lib/timeOffApi';
import { addDays, approvalsApi } from '../lib/timesheetApi';
import { useProjectsRead } from './projects';
import { overdueTasks, todayIso } from './selectors';
import { useStore } from './store';
import { useTasks } from './tasks';
import { type WaitingItem, waitingItems } from './waiting';

export type { WaitingItem } from './waiting';

/**
 * The rows of "Waiting for you" for the signed-in person, from the store (CRM tasks) and the
 * modules' own reads, each read again when its module changes. `loading` until every source that
 * applies has answered once; a source that fails adds nothing.
 */
export function useWaiting(open: ReadonlySet<string>): { items: WaitingItem[]; loading: boolean } {
  const { s, session } = useStore();
  const approver = session.tenant.role === 'owner' || session.tenant.role === 'admin' || s.visitScope.seesTeam;
  const wantTasks = open.has('projects');
  const wantTimesheet = open.has('timesheet') && approver;
  const wantTimeOff = open.has('timeoff') && approver;
  const tasks = useTasks({ assigneeId: 'me' }, wantTasks);
  // The Approvals page's week (the latest whose deadline passed) and the one before: days still waiting there need them too.
  const timesheet = useProjectsRead<ApiApprovals[]>(
    wantTimesheet,
    async () => {
      const latest = await approvalsApi.list();
      return [latest, await approvalsApi.list(addDays(latest.weekStart, -7))];
    },
    'home:timesheet-approvals',
    'timesheetRev',
  );
  const timeOff = useProjectsRead<ApiTimeOffApproval[]>(wantTimeOff, () => timeOffApi.approvals.list(), 'home:timeoff-approvals', 'timeOffRev');
  const pending = (want: boolean, r: { data: unknown; error: string | null }) => want && r.data === null && r.error === null;
  const crmTasks = open.has('crm')
    ? overdueTasks(s, session.userId).map((t) => {
        const lead = s.leads.find((l) => l.id === t.leadId);
        return { id: t.id, title: t.title, due: t.due, leadId: t.leadId, leadName: lead?.title || lead?.company || '' };
      })
    : [];
  const items = waitingItems({
    today: todayIso(s.workspace.timezone),
    open,
    crmTasks,
    projectTasks: wantTasks ? tasks.data : null,
    timesheets: wantTimesheet ? timesheet.data : null,
    timeOff: wantTimeOff ? timeOff.data : null,
  });
  return { items, loading: pending(wantTasks, tasks) || pending(wantTimesheet, timesheet) || pending(wantTimeOff, timeOff) };
}
