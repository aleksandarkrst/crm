import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../shared/database/database.service';
import { taskTimeFixtures } from '../../shared/database/schema';

/**
 * Hours per person on a task (CD-147): what the People and hours card shows and what limits are
 * checked against. Logged hours are every entry (draft, submitted, returned, approved); approved
 * are the approved ones. Until milestone 15 they come from `task_time_fixtures`, written only by
 * tests: `taskHours` is the one read to swap for time entries.
 */
export async function taskHours(tx: Tx, taskId: string, employeeId?: string): Promise<Map<string, { logged: number; approved: number }>> {
  const rows = await tx
    .select({
      employeeId: taskTimeFixtures.employeeId,
      logged: sql<number>`coalesce(sum(${taskTimeFixtures.hours}), 0)::float`,
      approved: sql<number>`coalesce(sum(${taskTimeFixtures.hours}) filter (where ${taskTimeFixtures.approved}), 0)::float`,
    })
    .from(taskTimeFixtures)
    .where(and(eq(taskTimeFixtures.taskId, taskId), employeeId ? eq(taskTimeFixtures.employeeId, employeeId) : undefined))
    .groupBy(taskTimeFixtures.employeeId);
  return new Map(rows.map((r) => [r.employeeId, { logged: r.logged, approved: r.approved }]));
}

/** How full someone's limit is: neutral below 80 %, amber from 80 %, red from 100 % (spec §8). */
export type UsedLevel = 'neutral' | 'amber' | 'red';
export const usedLevel = (logged: number, limit: number): UsedLevel => (logged >= limit ? 'red' : logged >= limit * 0.8 ? 'amber' : 'neutral');

export interface PersonOnTask {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  active: boolean;
  formerMember: boolean;
  hourLimit: number | null;
}

export interface HoursRow extends PersonOnTask {
  /** False: the viewer may see this person's name, not their hours (the fields below are null). */
  visible: boolean;
  logged: number | null;
  approved: number | null;
  /** Limit minus logged; negative when over. Null without a limit. */
  remaining: number | null;
  /** Logged / limit in percent, rounded. Null without a limit. */
  usedPercent: number | null;
  level: UsedLevel | null;
  over: boolean;
}

export interface HoursSummary {
  rows: HoursRow[];
  total: {
    logged: number;
    approved: number;
    /** The sum of the current people's limits, only when every one of them has a limit (informational). */
    taskLimit: number | null;
    remaining: number | null;
    /** Some current people have no limit: no task limit then ("Some people have no limit"). */
    someWithoutLimit: boolean;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The People and hours card (spec §8), pure and unit-tested. One row per current person and per
 * removed person who logged hours; the total counts everyone, removed people too. `seesAll`: the
 * lead, the people's managers and admins; anyone else sees their own row (`me`) in full and only
 * the names of the others, plus the total.
 */
export function hoursSummary(people: PersonOnTask[], hours: Map<string, { logged: number; approved: number }>, viewer: { seesAll: boolean; me: string | null }): HoursSummary {
  const rows: HoursRow[] = people
    .filter((p) => p.active || (hours.get(p.employeeId)?.logged ?? 0) > 0)
    .map((p) => {
      const h = hours.get(p.employeeId) ?? { logged: 0, approved: 0 };
      const visible = viewer.seesAll || p.employeeId === viewer.me;
      const limited = p.hourLimit != null;
      return {
        ...p,
        visible,
        logged: visible ? h.logged : null,
        approved: visible ? h.approved : null,
        remaining: visible && limited ? round2(p.hourLimit! - h.logged) : null,
        usedPercent: visible && limited ? Math.round((h.logged / p.hourLimit!) * 100) : null,
        level: visible && limited ? usedLevel(h.logged, p.hourLimit!) : null,
        over: visible && limited && h.logged > p.hourLimit!,
      };
    });
  const logged = round2([...hours.values()].reduce((a, h) => a + h.logged, 0));
  const approved = round2([...hours.values()].reduce((a, h) => a + h.approved, 0));
  const current = people.filter((p) => p.active);
  const someWithoutLimit = current.some((p) => p.hourLimit == null);
  const taskLimit = current.length && !someWithoutLimit ? round2(current.reduce((a, p) => a + p.hourLimit!, 0)) : null;
  return { rows, total: { logged, approved, taskLimit, remaining: taskLimit == null ? null : round2(taskLimit - logged), someWithoutLimit } };
}
