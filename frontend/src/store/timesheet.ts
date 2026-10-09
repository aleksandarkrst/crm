import { type ApiTimesheetWeek, timesheetApi } from '../lib/timesheetApi';
import { useProjectsRead } from './projects';

/** The caller's timesheet week (CD-152), read again after any timesheet, task, work order or project change (`s.timesheetRev`). */
export const useTimesheetWeek = (week: string | undefined) => useProjectsRead<ApiTimesheetWeek>(true, () => timesheetApi.week(week), `timesheet:${week ?? ''}`, 'timesheetRev');
