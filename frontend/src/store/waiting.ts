// Pure rules of Home's "Waiting for you" (CD-288); the hook that feeds them is in home.ts.
import type { ApiTask } from '../lib/tasksApi';
import type { ApiApprovals } from '../lib/timesheetApi';
import type { ApiApprovalRow as ApiTimeOffApproval } from '../lib/timeOffApi';
import { paths } from '../lib/paths';

/** The modules "Waiting for you" reads from (CD-288). */
export type WaitingModule = 'crm' | 'projects' | 'timesheet' | 'timeoff';

/** One row of "Waiting for you": what needs this person, where it is and when, and where to act on it. */
export interface WaitingItem {
  key: string;
  module: WaitingModule;
  text: string;
  /** "Timesheet · Week 41", "CRM · 3 days late". */
  meta: string;
  action: 'Open' | 'Review';
  to: string;
  /** For the order: the oldest first. */
  date: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const parts = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
const dayNumber = (iso: string) => {
  const { y, m, d } = parts(iso);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** A past day as people say it: "Today", "Yesterday", a weekday within the week, else "12 October". */
export function whenLabel(iso: string, today: string): string {
  const ago = dayNumber(today) - dayNumber(iso);
  if (ago <= 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  if (ago < 7) return WEEKDAYS[new Date(Date.UTC(parts(iso).y, parts(iso).m - 1, parts(iso).d)).getUTCDay()]!;
  return `${parts(iso).d} ${MONTHS[parts(iso).m - 1]}`;
}

/** "3 days late" for something due before today. */
export function lateLabel(due: string, today: string): string {
  const n = dayNumber(today) - dayNumber(due);
  return n === 1 ? '1 day late' : `${n} days late`;
}

/** "26 October", "26 to 28 October", "30 October to 2 November". */
export function periodLabel(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} ${MONTHS[a.m - 1]}`;
  if (a.y === b.y && a.m === b.m) return `${a.d} to ${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d} ${MONTHS[a.m - 1]} to ${b.d} ${MONTHS[b.m - 1]}`;
}

const hours = (minutes: number) => {
  const h = Math.round((minutes / 60) * 10) / 10;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
};

export interface WaitingSources {
  today: string;
  /** The modules this person can open (Home's tiles). */
  open: ReadonlySet<string>;
  /** Their overdue opportunity tasks, with the opportunity's name. */
  crmTasks: { id: string; title: string; due: string; leadId: string; leadName: string }[];
  /** Project tasks assigned to them (any due date; only overdue ones are kept). */
  projectTasks: ApiTask[] | null;
  /** The Approvals lists of the last weeks (managers, Admins and the owner), or null when not theirs or not loaded. */
  timesheets: ApiApprovals[] | null;
  /** Time off requests waiting for their decision, or null when not theirs or not loaded. */
  timeOff: ApiTimeOffApproval[] | null;
}

/**
 * "Waiting for you" (CD-288): what needs this person across the modules they can open, oldest
 * first. Overdue opportunity tasks (CRM) and project tasks (Projects) that are theirs; the weeks
 * they approve with days waiting (Timesheet); the time off requests waiting for their decision
 * (Time off). A module that is off or not theirs adds nothing.
 */
export function waitingItems(src: WaitingSources): WaitingItem[] {
  const out: WaitingItem[] = [];
  if (src.open.has('crm'))
    for (const t of src.crmTasks)
      out.push({ key: 'crm:' + t.id, module: 'crm', text: t.leadName ? `${t.title}, ${t.leadName}` : t.title, meta: `CRM · ${lateLabel(t.due, src.today)}`, action: 'Open', to: paths.lead(t.leadId), date: t.due });
  if (src.open.has('projects'))
    for (const t of src.projectTasks ?? [])
      if (t.dueDate && t.dueDate < src.today && t.status !== 'done')
        out.push({ key: 'task:' + t.id, module: 'projects', text: `${t.name}, ${t.projectName}`, meta: `Projects · ${lateLabel(t.dueDate, src.today)}`, action: 'Open', to: paths.task(t.id), date: t.dueDate });
  if (src.open.has('timesheet'))
    for (const w of src.timesheets ?? [])
      for (const r of w.rows) {
        if (r.waiting === 0 || !r.approvable) continue;
        const what = w.approvalMode === 'week' ? `week ${w.weekNumber}` : `${r.waiting} ${r.waiting === 1 ? 'day' : 'days'} of week ${w.weekNumber}`;
        out.push({ key: `ts:${r.employee.id}:${w.weekStart}`, module: 'timesheet', text: `${r.employee.name} submitted ${what}, ${hours(r.enteredMinutes)}`, meta: `Timesheet · ${whenLabel(w.deadline.date, src.today)}`, action: 'Review', to: paths.approval(r.employee.id, w.weekStart), date: w.weekStart });
      }
  if (src.open.has('timeoff'))
    for (const r of src.timeOff ?? []) {
      const days = r.workingDays === 1 ? '1 day' : `${r.workingDays} days`;
      const submitted = r.submittedAt.slice(0, 10);
      out.push({ key: 'to:' + r.id, module: 'timeoff', text: `${r.employee.fullName} asks for ${days} off, ${periodLabel(r.startDate, r.endDate)}`, meta: `Time off · ${whenLabel(submitted, src.today)}`, action: 'Review', to: paths.timeOff({ tab: 'approvals' }), date: submitted });
    }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}
