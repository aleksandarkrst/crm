import { describe, expect, it } from 'vitest';
import { type CountedMeeting, type CountedPlan, countVisits, creditedSalesperson, periodShare } from '../src/modules/crm/visit-plans/visit-counting';
import { zonedDayStart } from '../src/shared/time/zoned-time';

const ANA = 'user-ana';
const BOB = 'user-bob';
const CEO = 'user-ceo';
const ACME = 'company-acme';
const BETA = 'company-beta';
const GAMMA = 'company-gamma';

let seq = 0;
/** A held Customer visit by Ana at Acme, one hour long, unless told otherwise. */
function visit(startsAt: string, over: Partial<CountedMeeting> = {}): CountedMeeting {
  const start = new Date(startsAt);
  return {
    id: `m${++seq}`,
    type: 'visit',
    status: 'held',
    startsAt: start,
    endsAt: new Date(start.getTime() + 60 * 60 * 1000),
    companyId: ACME,
    companyName: 'Acme',
    organizerUserId: ANA,
    dealOwnerUserId: null,
    internalUserIds: [ANA],
    ...over,
  };
}

const october = (lines: CountedPlan['lines'] = [{ companyId: ACME, plannedVisits: 3 }], salespersonUserId = ANA): CountedPlan => ({
  salespersonUserId,
  periodStart: '2026-10-01',
  periodEnd: '2026-11-01',
  lines,
});
/** Well after October, so nothing is upcoming or "just ended". */
const LATER = new Date('2026-12-15T12:00:00Z');
const BELGRADE = 'Europe/Belgrade';
const NEW_YORK = 'America/New_York';

describe('zonedDayStart', () => {
  it('is local midnight, across daylight saving changes', () => {
    expect(zonedDayStart('2026-10-01', BELGRADE).toISOString()).toBe('2026-09-30T22:00:00.000Z'); // CEST
    expect(zonedDayStart('2026-11-01', BELGRADE).toISOString()).toBe('2026-10-31T23:00:00.000Z'); // CET
    expect(zonedDayStart('2026-10-25', BELGRADE).toISOString()).toBe('2026-10-24T22:00:00.000Z'); // the day clocks go back
    expect(zonedDayStart('2026-10-26', BELGRADE).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(zonedDayStart('2026-03-29', BELGRADE).toISOString()).toBe('2026-03-28T23:00:00.000Z'); // the day clocks go forward
    expect(zonedDayStart('2026-03-30', BELGRADE).toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(zonedDayStart('2026-11-01', NEW_YORK).toISOString()).toBe('2026-11-01T04:00:00.000Z'); // EDT until 02:00
    expect(zonedDayStart('2026-11-02', NEW_YORK).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(zonedDayStart('2026-03-08', NEW_YORK).toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(zonedDayStart('2026-10-01', 'UTC').toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('countVisits: period edges (spec 9.1, start date in the workspace time zone)', () => {
  it('Europe/Belgrade: 00:15 on the first day and 23:30 on the last day count; a minute outside does not', () => {
    const inside = [visit('2026-09-30T22:15:00Z'), visit('2026-10-31T22:30:00Z')]; // 1 Oct 00:15 CEST, 31 Oct 23:30 CET
    const outside = [visit('2026-09-30T21:30:00Z'), visit('2026-10-31T23:15:00Z')]; // 30 Sep 23:30, 1 Nov 00:15
    const p = countVisits(october([{ companyId: ACME, plannedVisits: 9 }]), [...inside, ...outside], LATER, BELGRADE);
    expect(p.lines[0]!.held).toBe(2);
    expect(p.lines[0]!.heldMeetingIds).toEqual(inside.map((m) => m.id));
  });

  it('America/New_York: the same wall-clock edges, though their UTC dates are the next day', () => {
    const inside = [visit('2026-10-01T04:15:00Z'), visit('2026-11-01T03:30:00Z')]; // 1 Oct 00:15 EDT, 31 Oct 23:30 EDT
    const outside = [visit('2026-10-01T03:30:00Z'), visit('2026-11-01T04:15:00Z')]; // 30 Sep 23:30, 1 Nov 00:15 (still EDT)
    const p = countVisits(october([{ companyId: ACME, plannedVisits: 9 }]), [...inside, ...outside], LATER, NEW_YORK);
    expect(p.lines[0]!.heldMeetingIds).toEqual(inside.map((m) => m.id));
    // In Belgrade the same instants fall differently: both 1 October ones are October there, neither 1 November one.
    expect(countVisits(october([{ companyId: ACME, plannedVisits: 9 }]), [...inside, ...outside], LATER, BELGRADE).lines[0]!.held).toBe(2);
  });

  it('counts visits in a daylight saving week (Belgrade, clocks go back on 25 October)', () => {
    const week = [visit('2026-10-24T22:30:00Z'), visit('2026-10-25T00:30:00Z'), visit('2026-10-25T01:30:00Z'), visit('2026-10-25T22:59:00Z')];
    const p = countVisits(october([{ companyId: ACME, plannedVisits: 9 }]), week, LATER, BELGRADE);
    expect(p.lines[0]!.held).toBe(4);
  });

  it('counts a March plan across the spring-forward day in New York', () => {
    const march: CountedPlan = { salespersonUserId: ANA, periodStart: '2026-03-01', periodEnd: '2026-04-01', lines: [{ companyId: ACME, plannedVisits: 2 }] };
    const p = countVisits(march, [visit('2026-03-08T14:00:00Z'), visit('2026-03-01T05:00:00Z'), visit('2026-03-01T04:59:00Z')], LATER, NEW_YORK);
    expect(p.lines[0]!.held).toBe(2); // 8 Mar 10:00 EDT and 1 Mar 00:00 EST; 28 Feb 23:59 is February
  });
});

describe('countVisits: statuses', () => {
  const now = new Date('2026-10-15T12:00:00Z');

  it('splits planned visits into upcoming and not closed; cancelled never count', () => {
    const upcoming = visit('2026-10-20T08:00:00Z', { status: 'planned' });
    const notClosed = visit('2026-10-10T08:00:00Z', { status: 'planned' }); // ended 5 days ago
    const justEnded = visit('2026-10-15T08:00:00Z', { status: 'planned' }); // ended 3 hours ago: neither yet
    const cancelled = visit('2026-10-05T08:00:00Z', { status: 'cancelled' });
    const cancelledAhead = visit('2026-10-25T08:00:00Z', { status: 'cancelled' });
    const held = visit('2026-10-02T08:00:00Z');
    const p = countVisits(october(), [upcoming, notClosed, justEnded, cancelled, cancelledAhead, held], now, BELGRADE);
    const line = p.lines[0]!;
    expect(line).toMatchObject({ planned: 3, held: 1, upcoming: 1, notClosed: 1, heldCapped: 1, overPlan: 0 });
    expect(line.upcomingMeetingIds).toEqual([upcoming.id]);
    expect(line.notClosedMeetingIds).toEqual([notClosed.id]);
    expect(p.totals).toMatchObject({ planned: 3, held: 1, heldCapped: 1, upcoming: 1, notClosed: 1, unplanned: 0 });
    expect(p.totals.completion).toBeCloseTo(1 / 3);
  });

  it('is not closed exactly after 24 hours past the end', () => {
    const m = visit('2026-10-14T10:00:00Z', { status: 'planned' }); // ends 11:00
    expect(countVisits(october(), [m], new Date('2026-10-15T11:00:00Z'), BELGRADE).totals.notClosed).toBe(0);
    expect(countVisits(october(), [m], new Date('2026-10-15T11:00:01Z'), BELGRADE).totals.notClosed).toBe(1);
  });

  it('only Customer visits count: online, office and phone meetings never do', () => {
    const ms = [visit('2026-10-02T08:00:00Z', { type: 'online' }), visit('2026-10-03T08:00:00Z', { type: 'office' }), visit('2026-10-04T08:00:00Z', { type: 'phone' })];
    expect(countVisits(october(), ms, LATER, BELGRADE).totals).toMatchObject({ held: 0, unplanned: 0, upcoming: 0 });
  });
});

describe('countVisits: completion, over plan and unplanned visits', () => {
  it('caps each line at its plan: extra visits at one customer do not make up for another', () => {
    const ms = [visit('2026-10-02T08:00:00Z'), visit('2026-10-03T08:00:00Z'), visit('2026-10-04T08:00:00Z')]; // 3 at Acme
    const p = countVisits(
      october([
        { companyId: ACME, plannedVisits: 2 },
        { companyId: BETA, plannedVisits: 2 },
      ]),
      ms,
      LATER,
      BELGRADE,
    );
    const acme = p.lines.find((l) => l.companyId === ACME)!;
    const beta = p.lines.find((l) => l.companyId === BETA)!;
    expect(acme).toMatchObject({ planned: 2, held: 3, heldCapped: 2, overPlan: 1, completion: 1 });
    expect(beta).toMatchObject({ planned: 2, held: 0, heldCapped: 0, overPlan: 0, completion: 0 });
    expect(p.totals).toMatchObject({ planned: 4, held: 3, heldCapped: 2, overPlan: 1, completion: 0.5 });
  });

  it('never goes above 100%', () => {
    const ms = [visit('2026-10-02T08:00:00Z'), visit('2026-10-03T08:00:00Z')];
    const p = countVisits(october([{ companyId: ACME, plannedVisits: 1 }]), ms, LATER, BELGRADE);
    expect(p.totals).toMatchObject({ completion: 1, overPlan: 1, pace: 'done' });
  });

  it('lists held visits at companies outside the plan as unplanned, without counting them', () => {
    const gamma1 = visit('2026-10-02T08:00:00Z', { companyId: GAMMA, companyName: 'Gamma' });
    const gamma2 = visit('2026-10-09T08:00:00Z', { companyId: GAMMA, companyName: 'Gamma' });
    const betaPlanned = visit('2026-10-20T08:00:00Z', { companyId: BETA, companyName: 'Beta', status: 'planned' });
    const p = countVisits(october(), [gamma1, gamma2, betaPlanned], new Date('2026-10-15T12:00:00Z'), BELGRADE);
    expect(p.unplanned).toEqual([{ companyId: GAMMA, companyName: 'Gamma', held: 2, meetingIds: [gamma1.id, gamma2.id] }]);
    expect(p.totals).toMatchObject({ held: 0, unplanned: 2, upcoming: 0, completion: 0 });
  });
});

describe('countVisits: who a visit counts for (Q5: one salesperson)', () => {
  it('a visit with two salespeople counts once: for the deal owner when they were there', () => {
    const shared = visit('2026-10-02T08:00:00Z', { organizerUserId: ANA, internalUserIds: [ANA, BOB], dealOwnerUserId: BOB });
    expect(creditedSalesperson(shared)).toBe(BOB);
    expect(countVisits(october([{ companyId: ACME, plannedVisits: 1 }], ANA), [shared], LATER, BELGRADE).totals.held).toBe(0);
    expect(countVisits(october([{ companyId: ACME, plannedVisits: 1 }], BOB), [shared], LATER, BELGRADE).totals.held).toBe(1);
  });

  it('a deal owner who organized it gets it', () => {
    expect(creditedSalesperson({ organizerUserId: BOB, internalUserIds: [BOB, ANA], dealOwnerUserId: BOB })).toBe(BOB);
  });

  it('without a deal, the organizer gets it, not the other participants', () => {
    const shared = visit('2026-10-02T08:00:00Z', { organizerUserId: ANA, internalUserIds: [ANA, BOB], dealOwnerUserId: null });
    expect(countVisits(october([{ companyId: ACME, plannedVisits: 1 }], ANA), [shared], LATER, BELGRADE).totals.held).toBe(1);
    expect(countVisits(october([{ companyId: ACME, plannedVisits: 1 }], BOB), [shared], LATER, BELGRADE).totals.held).toBe(0);
  });

  it('a deal owner who was not there does not get it: the organizer does', () => {
    const m = visit('2026-10-02T08:00:00Z', { organizerUserId: ANA, internalUserIds: [ANA, BOB], dealOwnerUserId: CEO });
    expect(creditedSalesperson(m)).toBe(ANA);
    expect(countVisits(october([{ companyId: ACME, plannedVisits: 1 }], ANA), [m], LATER, BELGRADE).totals.held).toBe(1);
    expect(countVisits(october([{ companyId: ACME, plannedVisits: 1 }], CEO), [m], LATER, BELGRADE).totals.held).toBe(0);
  });

  it('when the organizer left, the visit counts for the deal owner if they were there, else for nobody', () => {
    expect(creditedSalesperson({ organizerUserId: null, internalUserIds: [BOB], dealOwnerUserId: BOB })).toBe(BOB);
    expect(creditedSalesperson({ organizerUserId: null, internalUserIds: [BOB], dealOwnerUserId: CEO })).toBeNull();
  });

  it("other salespeople's visits are not unplanned visits of this plan", () => {
    const bobs = visit('2026-10-02T08:00:00Z', { companyId: GAMMA, companyName: 'Gamma', organizerUserId: BOB, internalUserIds: [BOB] });
    expect(countVisits(october(), [bobs], LATER, BELGRADE).unplanned).toEqual([]);
  });
});

describe('expected pace and the status colour', () => {
  it('is 0 before the period, 1 after it, and the share passed in between', () => {
    expect(periodShare('2026-10-01', '2026-11-01', new Date('2026-09-30T21:59:00Z'), BELGRADE)).toBe(0);
    expect(periodShare('2026-10-01', '2026-11-01', new Date('2026-10-31T23:00:00Z'), BELGRADE)).toBe(1);
    // October in Belgrade is 31 days and one hour (clocks go back).
    const half = new Date((zonedDayStart('2026-10-01', BELGRADE).getTime() + zonedDayStart('2026-11-01', BELGRADE).getTime()) / 2);
    expect(periodShare('2026-10-01', '2026-11-01', half, BELGRADE)).toBeCloseTo(0.5);
  });

  it('is notStarted before the period, behind below pace, onTrack at or above it, done at 100%', () => {
    const one = [visit('2026-10-02T08:00:00Z')];
    expect(countVisits(october(), [], new Date('2026-09-20T12:00:00Z'), BELGRADE).totals).toMatchObject({ pace: 'notStarted', expectedPace: 0 });
    // 1 of 3 on 20 October (about 62% of the month passed): behind.
    expect(countVisits(october(), one, new Date('2026-10-20T12:00:00Z'), BELGRADE).totals.pace).toBe('behind');
    // 1 of 3 on 5 October (about 14% passed): on track.
    expect(countVisits(october(), one, new Date('2026-10-05T12:00:00Z'), BELGRADE).totals.pace).toBe('onTrack');
    expect(countVisits(october([{ companyId: ACME, plannedVisits: 1 }]), one, new Date('2026-10-05T12:00:00Z'), BELGRADE).totals.pace).toBe('done');
    expect(countVisits(october(), one, LATER, BELGRADE).totals).toMatchObject({ pace: 'behind', expectedPace: 1 });
  });
});
