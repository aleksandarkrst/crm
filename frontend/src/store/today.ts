/**
 * Today (CD-532, board C-Today): which group a to-do sits in, its due tag, and whether a ticked one
 * still shows. Pure (no React, no store), so it is unit-tested with Node's runner (test/today.test.ts).
 *
 * "Today" is the person's own day: their device's time zone, else the workspace's.
 */
import { instantToZoned } from './time.ts';

/** Late: due before today. Today: due today or later (and approvals). Won: on a won opportunity. */
export type TodayGroup = 'late' | 'today' | 'won';

export const TODAY_GROUPS: { id: TodayGroup; title: string; sub: string }[] = [
  { id: 'late', title: 'Late', sub: 'Past their date' },
  { id: 'today', title: 'Today', sub: 'Your sales work' },
  { id: 'won', title: 'After the win', sub: 'Hand over to delivery, kept apart from open sales' },
];

/** The task a proposal approval request makes for the approver (backend proposal-approval.service.ts). */
export const APPROVAL_TASK_TITLE = 'Approve the proposal';

const DAY = 86_400_000;
const utc = (iso: string) => Date.parse(iso + 'T00:00:00Z');
/** Whole days from `a` to `b` (ISO dates); positive when `b` is later. */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / DAY);

/**
 * The group of a to-do: a won opportunity's to-dos are kept apart, an approval waiting for you is
 * today's work however long ago it was asked for, and the rest go by their due date (none: today).
 */
export function groupOf(t: { dueIso: string; won: boolean; approval: boolean }, today: string): TodayGroup {
  if (t.won) return 'won';
  if (t.approval) return 'today';
  return t.dueIso && t.dueIso < today ? 'late' : 'today';
}

export type DueTone = 'late' | 'today' | 'later' | 'done';

/** The tag on the right of a row: "3 days late", "Today", "Fri" this week, "30 Nov" further out; "Done" once ticked. */
export function dueTag(dueIso: string, today: string, done = false): { text: string; tone: DueTone } {
  if (done) return { text: 'Done', tone: 'done' };
  const days = dueIso ? daysBetween(today, dueIso) : 0;
  if (days < 0) return { text: days === -1 ? '1 day late' : `${-days} days late`, tone: 'late' };
  if (days === 0) return { text: 'Today', tone: 'today' };
  const opts: Intl.DateTimeFormatOptions = days < 7 ? { weekday: 'short', timeZone: 'UTC' } : { day: 'numeric', month: 'short', timeZone: 'UTC' };
  return { text: new Date(utc(dueIso)).toLocaleDateString('en-GB', opts), tone: 'later' };
}

/** A ticked to-do stays on Today, struck through, until the end of the day it was ticked (in `tz`). */
export function tickedToday(t: { done: boolean; doneAt?: string }, today: string, tz: string): boolean {
  return t.done && !!t.doneAt && instantToZoned(t.doneAt, tz).date === today;
}

/** "3 to-dos left", "1 to-do left", "all done for today". */
export function leftText(open: number): string {
  return open === 0 ? 'all done for today' : open === 1 ? '1 to-do left' : `${open} to-dos left`;
}

/** Pultly suggests (the board's rule): meetings of the last seven days that were held and still have no minutes. */
export function minutesSuggestion(count: number): string | null {
  if (count <= 0) return null;
  return `${count === 1 ? '1 meeting' : `${count} meetings`} last week still ${count === 1 ? 'has' : 'have'} no minutes. Clients get the PDF minutes the day you send them.`;
}
