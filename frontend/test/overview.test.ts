// Overview's links to the Pipeline and its funnel bands (CD-531): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GROUP } from '../src/store/filters.ts';
import { bandShade, bandWidth, daysSince, pipelineFilters } from '../src/store/overview.ts';

const overview = {
  order: ['owner', 'close', 'value'],
  f: { owner: { op: 'is' as const, vals: ['u1'] }, close: { preset: 'quarter' as const }, value: { min: '1000' }, audience: { vals: ['f2'] } },
};

describe('Overview cards open the Pipeline with the same filter (CD-531)', () => {
  it('Open pipeline keeps Salesperson, Closing date and added filters, with Status Open', () => {
    const v = pipelineFilters(overview, { kind: 'open' });
    assert.deepEqual(v.order, ['owner', 'status', 'close', 'value']);
    assert.deepEqual(v.f.owner, { op: 'is', vals: ['u1'] });
    assert.deepEqual(v.f.status, { op: 'is', vals: [GROUP] });
    assert.deepEqual(v.f.close, { preset: 'quarter' });
    assert.equal(v.f.audience, undefined, 'the Pipeline choice is not a Pipeline filter');
  });

  it('Won picks the won outcome', () => {
    assert.deepEqual(pipelineFilters(overview, { kind: 'won' }).f.status, { op: 'is', vals: ['__won'] });
  });

  it('Stalled adds no contact for 3+ days', () => {
    const v = pipelineFilters(overview, { kind: 'stalled' });
    assert.equal(v.order.at(-1), 'stall');
    assert.deepEqual(v.f.stall, { min: '3' });
  });

  it('works without a Salesperson filter', () => {
    assert.deepEqual(pipelineFilters({ order: [], f: {} }, { kind: 'open' }).f.owner, { op: 'is', vals: [] });
  });
});

describe('funnel bands (CD-531)', () => {
  it('shade from light green to green 700, the won stage lime', () => {
    assert.deepEqual([0, 1, 2, 3, 4].map((i) => bandShade(i, 6, false).shade), [0, 1, 3, 4, 6]);
    assert.deepEqual(bandShade(5, 6, true), { shade: 'won', dark: false }, 'lime takes dark text');
    assert.equal(bandShade(0, 6, false).dark, false);
    assert.equal(bandShade(0, 1, false).shade, 0, 'a one-stage funnel');
  });

  it('narrow from full width', () => {
    assert.equal(bandWidth(0, 6), '100%');
    assert.equal(bandWidth(5, 6), '42%');
    assert.equal(bandWidth(0, 1), '100%');
  });

  it('count days in a stage', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    assert.equal(daysSince('2026-11-15T13:00:00Z', now), 2);
    assert.equal(daysSince(undefined, now), 0);
    assert.equal(daysSince('2026-12-01T00:00:00Z', now), 0);
  });
});
