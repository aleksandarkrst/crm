// Unit tests of the company page's KPI row and tabs (CD-534, 28 Nov boards). `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { companyTasks, lastActivityKpi, lifetimeLine, longDate, nextMeetingKpi, openValueLine, opportunitiesEmpty, opportunityGroups, taskSummary, winRateLine } from '../src/store/companyTabs.ts';
import type { Lead, LeadTask } from '../src/store/types.ts';

const lead = (over: Partial<Lead>): Lead => ({ id: 'd1', company: 'Mercator-S', contact: '', role: '', initials: '', email: '', phone: '', segment: 'f', stage: 's1', value: '€60,000', taxMode: 'exclusive', discounts: [], installments: [], lateDays: 0, docsComplete: {}, approval: { requestedAt: null, requestedBy: null, approvedAt: null, approvedBy: null, sentAt: null }, score: 0, stall: 0, industry: '', hq: '', size: '', source: '', saleType: '', need: '', constraint: '', decisionMaker: '', discoveryDate: '', headline: '', sponsorContactId: '', powerSponsorContactId: '', pain: '', painSolution: '', qualificationSteps: [], qualificationOther: '', lines: [], total: '', outcome: 'open', ...over } as Lead);
const look = { stageName: () => 'Negotiation', ownerName: (l: Lead) => l.owner ?? 'Marko', valueNum: (l: Lead) => Number(l.value.replace(/\D/g, '')), tz: 'Europe/Belgrade', dayLabel: (iso: string) => iso.slice(8, 10) + ' Dec' };

describe('the Opportunities tab', () => {
  it('splits the opportunities into open, won and lost with their lines and totals, leaving empty groups out', () => {
    const groups = opportunityGroups(
      [
        lead({ id: 'a', title: 'Loyalty renewal', closeDate: '2026-12-18', value: '€60,000' }),
        lead({ id: 'b', title: 'Promo analytics', outcome: 'won', stageSince: '2026-03-14T08:30:00Z', value: '€90,000' }),
        lead({ id: 'c', title: 'Price optimization', outcome: 'lost', lostAt: '2026-06-20T09:20:00Z', lostReason: 'Price', value: '€35,000' }),
        lead({ id: 'd', title: 'Store dashboards', outcome: 'won', stageSince: '2025-09-02T08:00:00Z', value: '€50,000' }),
      ],
      look,
    );
    assert.deepEqual(
      groups.map((g) => [g.title, g.rows.map((r) => [r.name, r.line, r.extra]), g.total]),
      [
        ['Open', [['Loyalty renewal', 'Negotiation', 'Closes 18 Dec']], 60000],
        ['Won', [['Promo analytics', 'Won 14 Mar 2026'], ['Store dashboards', 'Won 2 Sep 2025']].map((r) => [...r, '']), 140000],
        ['Lost', [['Price optimization', 'Lost 20 Jun 2026', 'Price']], 35000],
      ],
    );
    assert.deepEqual(opportunityGroups([lead({ id: 'x', outcome: 'won', value: '€1,000' })], look).map((g) => g.title), ['Won']);
  });

  it('writes the win rate, the value lines and the empty states', () => {
    assert.equal(winRateLine(2, 1), 'Win rate 67%, 2 won, 1 lost');
    assert.equal(winRateLine(0, 0), '');
    assert.equal(openValueLine(0), 'No open opportunities');
    assert.equal(openValueLine(1), '1 open opportunity');
    assert.equal(lifetimeLine(0, 0), 'Nothing won yet');
    assert.equal(lifetimeLine(2, 1), '2 won, 1 lost');
    assert.deepEqual(opportunitiesEmpty('lead', 'Tarkett', 3), { title: 'Leads cannot have opportunities yet', text: 'Complete the 3 missing items in the banner above. Tarkett then becomes an opportunity by itself.' });
    assert.deepEqual(opportunitiesEmpty('opportunity', 'Tarkett', 0), { title: 'No opportunities yet', text: 'Add the first opportunity for Tarkett.' });
  });
});

describe('the Tasks tab and the KPIs', () => {
  const task = (over: Partial<LeadTask>): LeadTask => ({ id: 't', leadId: 'd1', stageId: 's', title: 'Do', channel: 'NT', due: '', ownerId: '', note: '', done: false, ...over });

  it('lists the opportunities’ to-dos, open ones first by due date, and counts the late ones', () => {
    const tasks = companyTasks([task({ id: 'done', done: true, due: '2026-11-01' }), task({ id: 'later', due: '2026-12-05' }), task({ id: 'late', due: '2026-11-20' }), task({ id: 'other', leadId: 'zz' })], ['d1']);
    assert.deepEqual(
      tasks.map((t) => t.id),
      ['late', 'later', 'done'],
    );
    assert.deepEqual(taskSummary(tasks, '2026-11-28'), { open: 2, late: 1, line: '2 open, 1 late', kpiSub: '1 late' });
    assert.equal(taskSummary([], '2026-11-28').kpiSub, 'None late');
  });

  it('says when the last activity was and what it was, and when the next meeting is', () => {
    const day = (at: string) => at.slice(0, 10);
    assert.deepEqual(lastActivityKpi({ channel: 'PH', at: '2026-10-30T10:40:00Z' }, [{ at: '2026-10-30T10:40:00Z', title: 'Call with Dragana Popov' }], day, '2026-11-28'), { value: '30 Oct', sub: 'Call with Dragana Popov' });
    assert.deepEqual(lastActivityKpi({ channel: 'EM', at: '2026-11-27T10:40:00Z' }, [], day, '2026-11-28'), { value: 'Yesterday', sub: 'Email' });
    assert.deepEqual(lastActivityKpi(null, [], day, '2026-11-28'), { value: 'None', sub: 'Nothing yet' });
    const now = Date.parse('2026-11-28T08:00:00Z');
    assert.deepEqual(nextMeetingKpi([{ title: 'Old', startsAt: '2026-10-30T13:00:00Z' }, { title: 'Tarkett plant visit', startsAt: '2026-12-12T13:00:00Z' }], now, day, '2026-11-28'), { value: '12 Dec', sub: 'Tarkett plant visit' });
    assert.deepEqual(nextMeetingKpi([{ title: 'Standup', startsAt: '2026-11-28T15:00:00Z' }], now, day, '2026-11-28'), { value: 'Today', sub: 'Standup' });
    assert.deepEqual(nextMeetingKpi([], now, day, '2026-11-28'), { value: 'None', sub: 'Nothing planned yet' });
    assert.equal(longDate('2026-03-14T08:30:00Z', 'Europe/Belgrade'), '14 Mar 2026');
  });
});
