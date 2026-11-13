import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { type ApiApprovals, type ApiApproverWeek, approvalsApi, type ApiTeamStatus, type ApiTimeCard, type ApiTimesheetWeek, type ApiWeekHistory, teamStatusApi, timesheetApi } from '../lib/timesheetApi';
import { useProjectsRead } from './projects';

/** The caller's timesheet week (CD-152), read again after any timesheet, task, work order or project change (`s.timesheetRev`). */
export const useTimesheetWeek = (week: string | undefined, employeeId?: string) =>
  useProjectsRead<ApiTimesheetWeek>(true, () => timesheetApi.week(week, employeeId), `timesheet:${week ?? ''}:${employeeId ?? ''}`, 'timesheetRev');

/** Whether a read was refused (403): Approvals sends callers who approve nobody away (CD-521). */
function useRefused() {
  const [refused, setRefused] = useState(false);
  const watch = <T>(read: Promise<T>) =>
    read.catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 403) setRefused(true);
      throw err;
    });
  return [refused, watch] as const;
}

/** The Approvals list (CD-157): the weeks the caller approves, read again after any timesheet change. `refused`: the caller approves nobody (CD-521). */
export const useApprovals = (week: string | undefined) => {
  const [refused, watch] = useRefused();
  return { ...useProjectsRead<ApiApprovals>(true, () => watch(approvalsApi.list(week)), `approvals:${week ?? ''}`, 'timesheetRev'), refused };
};

/** One person's week history (CD-159): status events and entry changes, read again after any timesheet change. */
export const useWeekHistory = (employeeId: string | undefined, week: string | undefined) =>
  useProjectsRead<ApiWeekHistory>(!!employeeId, () => approvalsApi.history(employeeId!, week), `week-history:${employeeId ?? ''}:${week ?? ''}`, 'timesheetRev');

/** One person's week for their approver (CD-157). `refused`: 403, someone outside the caller's reports or a caller who approves nobody. */
export const useApproverWeek = (employeeId: string | undefined, week: string | undefined) => {
  const [refused, watch] = useRefused();
  return { ...useProjectsRead<ApiApproverWeek>(!!employeeId, () => watch(approvalsApi.week(employeeId!, week)), `approver-week:${employeeId ?? ''}:${week ?? ''}`, 'timesheetRev'), refused };
};

/** A task's Time card (CD-276), read again after any task or time change. */
export const useTaskTime = (id: string | undefined) => useProjectsRead<ApiTimeCard>(!!id, () => api<ApiTimeCard>(`/tasks/${id}/time`), `task-time:${id ?? ''}`, 'taskRev');

/** A work order's Track time card (CD-276), read again after any work order or time change. */
export const useWorkOrderTime = (id: string | undefined) => useProjectsRead<ApiTimeCard>(!!id, () => api<ApiTimeCard>(`/work-orders/${id}/time`), `work-order-time:${id ?? ''}`, 'workOrderRev');

/** Today's status (CD-162) for a date, everyone or (`reports`) the caller's reports; read again on any change it shows (`s.statusRev`). */
export const useTeamStatus = (enabled: boolean, date: string | undefined, scope?: 'reports') =>
  useProjectsRead<ApiTeamStatus>(enabled, () => teamStatusApi.list(date, scope), `team-status:${date ?? ''}:${scope ?? ''}`, 'statusRev');
