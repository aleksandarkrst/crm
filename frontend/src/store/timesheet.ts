import { api } from '../lib/api';
import { type ApiApprovals, type ApiApproverWeek, approvalsApi, type ApiTimeCard, type ApiTimesheetWeek, timesheetApi } from '../lib/timesheetApi';
import { useProjectsRead } from './projects';

/** The caller's timesheet week (CD-152), read again after any timesheet, task, work order or project change (`s.timesheetRev`). */
export const useTimesheetWeek = (week: string | undefined) => useProjectsRead<ApiTimesheetWeek>(true, () => timesheetApi.week(week), `timesheet:${week ?? ''}`, 'timesheetRev');

/** The Approvals list (CD-157): the weeks the caller approves, read again after any timesheet change. */
export const useApprovals = (week: string | undefined) => useProjectsRead<ApiApprovals>(true, () => approvalsApi.list(week), `approvals:${week ?? ''}`, 'timesheetRev');

/** One person's week for their approver (CD-157). */
export const useApproverWeek = (employeeId: string | undefined, week: string | undefined) =>
  useProjectsRead<ApiApproverWeek>(!!employeeId, () => approvalsApi.week(employeeId!, week), `approver-week:${employeeId ?? ''}:${week ?? ''}`, 'timesheetRev');

/** A task's Time card (CD-276), read again after any task or time change. */
export const useTaskTime = (id: string | undefined) => useProjectsRead<ApiTimeCard>(!!id, () => api<ApiTimeCard>(`/tasks/${id}/time`), `task-time:${id ?? ''}`, 'taskRev');

/** A work order's Track time card (CD-276), read again after any work order or time change. */
export const useWorkOrderTime = (id: string | undefined) => useProjectsRead<ApiTimeCard>(!!id, () => api<ApiTimeCard>(`/work-orders/${id}/time`), `work-order-time:${id ?? ''}`, 'workOrderRev');
