import { api } from './api';

export type EmployeeTimesheetSummary = { applicable: false } | {
  applicable: true;
  from: string;
  through: string;
  lateCount: number;
  autoSubmittedCount: number;
  returnedWeekCount: number;
  lastWeek: { weekStart: string; status: string; statusLabel: string; late: boolean };
  recent: { weekStart: string; label: string; deadline: { date: string; time: string }; firstSubmittedAt: string | null; autoSubmitted: boolean; detail: string }[];
};

export const employeeTimesheetSummary = (id: string) => api<EmployeeTimesheetSummary>(`/timesheet/employees/${id}/late`);
