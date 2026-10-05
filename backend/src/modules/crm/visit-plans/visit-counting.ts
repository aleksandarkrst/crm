import type { MeetingStatus, MeetingType } from '../../../shared/database/schema';
import { zonedDayStart, zonedParts } from '../../../shared/time/zoned-time';

/**
 * Planned vs. actual visits (CD-135, spec 9.1), as one pure function. The plan page, the list,
 * Reports, the Overview card, the company card, CSV exports and the daily digest all count with
 * `countVisits`, so they always show the same numbers.
 */

/** A planned meeting is "Not closed" this long after its end (as in meeting-rules.ts). */
const NOT_CLOSED_AFTER_MS = 24 * 60 * 60 * 1000;

/** A meeting as counting needs it. */
export interface CountedMeeting {
  id: string;
  type: MeetingType;
  status: MeetingStatus;
  startsAt: Date;
  endsAt: Date;
  companyId: string;
  companyName: string;
  organizerUserId: string | null;
  /** Owner of the meeting's deal; null without a deal (or an unowned one). */
  dealOwnerUserId: string | null;
  /** Members at the meeting (internal participants; the organizer is one of them). */
  internalUserIds: readonly string[];
}

export interface CountedPlan {
  salespersonUserId: string;
  /** First day of the period and first day after it (`YYYY-MM-DD`, workspace calendar). */
  periodStart: string;
  periodEnd: string;
  lines: readonly { companyId: string; plannedVisits: number }[];
}

export interface VisitLineProgress {
  companyId: string;
  planned: number;
  held: number;
  /** min(held, planned): what counts toward completion. */
  heldCapped: number;
  upcoming: number;
  notClosed: number;
  /** Visits held beyond the plan ("+N over plan"). */
  overPlan: number;
  /** min(held, planned) / planned. */
  completion: number;
  heldMeetingIds: string[];
  upcomingMeetingIds: string[];
  notClosedMeetingIds: string[];
}

export interface UnplannedVisits {
  companyId: string;
  companyName: string;
  held: number;
  meetingIds: string[];
}

/** done: 100%; behind: below the share of the period that has passed; notStarted: before the period; onTrack otherwise. */
export type VisitPace = 'done' | 'behind' | 'notStarted' | 'onTrack';

export interface VisitTotals {
  planned: number;
  heldCapped: number;
  /** Held visits at the plan's companies, uncapped. */
  held: number;
  upcoming: number;
  notClosed: number;
  /** Held visits at companies outside the plan. */
  unplanned: number;
  overPlan: number;
  /** Σ min(held, planned) / Σ planned, 0..1. */
  completion: number;
  /** The share of the period that has passed, 0..1. */
  expectedPace: number;
  pace: VisitPace;
}

export interface VisitProgress {
  lines: VisitLineProgress[];
  unplanned: UnplannedVisits[];
  totals: VisitTotals;
}

/**
 * The one salesperson a visit counts for (the Q5 decision): the deal's owner when the meeting has
 * a deal and that owner was there (organizer or internal participant), else the organizer. null
 * when nobody (the organizer left the workspace and the deal owner wasn't there).
 */
export function creditedSalesperson(m: Pick<CountedMeeting, 'organizerUserId' | 'dealOwnerUserId' | 'internalUserIds'>): string | null {
  const owner = m.dealOwnerUserId;
  if (owner && (owner === m.organizerUserId || m.internalUserIds.includes(owner))) return owner;
  return m.organizerUserId;
}

/** The share of [periodStart, periodEnd) (days in the zone) that has passed at `now`: 0 before, 1 after. */
export function periodShare(periodStart: string, periodEnd: string, now: Date, timeZone: string): number {
  const from = zonedDayStart(periodStart, timeZone).getTime();
  const to = zonedDayStart(periodEnd, timeZone).getTime();
  if (now.getTime() <= from) return 0;
  if (now.getTime() >= to) return 1;
  return (now.getTime() - from) / (to - from);
}

export function paceOf(completion: number, expectedPace: number, now: Date, periodStart: string, timeZone: string): VisitPace {
  if (completion >= 1) return 'done';
  if (now.getTime() < zonedDayStart(periodStart, timeZone).getTime()) return 'notStarted';
  return completion < expectedPace ? 'behind' : 'onTrack';
}

/**
 * Counts a plan's visits (spec 9.1 with the Q5 decision). `meetings` may hold more than the
 * plan's: only Customer visits credited to the plan's salesperson whose start date, on the
 * workspace's clock, falls in [periodStart, periodEnd) count.
 * - held: status held, at a plan company (else "unplanned");
 * - upcoming: planned and starting after `now`;
 * - not closed: planned and ended more than 24 hours before `now`;
 * - cancelled meetings never count.
 * A line's completion is capped at its planned number, so extra visits at one customer don't make
 * up for another; the plan's completion is Σ min(held, planned) / Σ planned.
 */
export function countVisits(plan: CountedPlan, meetings: readonly CountedMeeting[], now: Date, timeZone: string): VisitProgress {
  const lines = new Map<string, VisitLineProgress>();
  for (const l of plan.lines) {
    lines.set(l.companyId, {
      companyId: l.companyId,
      planned: l.plannedVisits,
      held: 0,
      heldCapped: 0,
      upcoming: 0,
      notClosed: 0,
      overPlan: 0,
      completion: 0,
      heldMeetingIds: [],
      upcomingMeetingIds: [],
      notClosedMeetingIds: [],
    });
  }
  const unplanned = new Map<string, UnplannedVisits>();
  const sorted = [...meetings].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));

  for (const m of sorted) {
    if (m.type !== 'visit' || m.status === 'cancelled') continue;
    if (creditedSalesperson(m) !== plan.salespersonUserId) continue;
    const day = zonedParts(m.startsAt, timeZone).date;
    if (day < plan.periodStart || day >= plan.periodEnd) continue;
    const line = lines.get(m.companyId);
    if (m.status === 'held') {
      if (line) {
        line.held++;
        line.heldMeetingIds.push(m.id);
      } else {
        const u = unplanned.get(m.companyId) ?? { companyId: m.companyId, companyName: m.companyName, held: 0, meetingIds: [] };
        u.held++;
        u.meetingIds.push(m.id);
        unplanned.set(m.companyId, u);
      }
    } else if (line && m.startsAt.getTime() > now.getTime()) {
      line.upcoming++;
      line.upcomingMeetingIds.push(m.id);
    } else if (line && m.endsAt.getTime() < now.getTime() - NOT_CLOSED_AFTER_MS) {
      line.notClosed++;
      line.notClosedMeetingIds.push(m.id);
    }
  }

  const out = [...lines.values()];
  for (const l of out) {
    l.heldCapped = Math.min(l.held, l.planned);
    l.overPlan = l.held - l.heldCapped;
    l.completion = l.planned > 0 ? l.heldCapped / l.planned : 0;
  }
  const sum = (f: (l: VisitLineProgress) => number) => out.reduce((n, l) => n + f(l), 0);
  const planned = sum((l) => l.planned);
  const heldCapped = sum((l) => l.heldCapped);
  const completion = planned > 0 ? heldCapped / planned : 0;
  const expectedPace = periodShare(plan.periodStart, plan.periodEnd, now, timeZone);
  const unplannedList = [...unplanned.values()].sort((a, b) => a.companyName.localeCompare(b.companyName));
  return {
    lines: out,
    unplanned: unplannedList,
    totals: {
      planned,
      heldCapped,
      held: sum((l) => l.held),
      upcoming: sum((l) => l.upcoming),
      notClosed: sum((l) => l.notClosed),
      unplanned: unplannedList.reduce((n, u) => n + u.held, 0),
      overPlan: sum((l) => l.overPlan),
      completion,
      expectedPace,
      pace: paceOf(completion, expectedPace, now, plan.periodStart, timeZone),
    },
  };
}
