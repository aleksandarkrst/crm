// The payment-due bands on Overview (CD-365): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TIME_BUCKETS } from '../src/store/metrics.ts';

describe('payment-due bands (CD-365)', () => {
  it('are labelled as separate periods, furthest first', () => {
    assert.deepEqual(
      TIME_BUCKETS.map((b) => b.label),
      ['Over 9 months', '6 to 9 months', '3 to 6 months', '1 to 3 months', '2 weeks to 1 month', 'Overdue and next 2 weeks'],
    );
  });

  it('cover every month once: each band starts where the next one ends, with nothing left over', () => {
    for (let i = 0; i < TIME_BUCKETS.length - 1; i++) assert.equal(TIME_BUCKETS[i]!.range[0], TIME_BUCKETS[i + 1]!.range[1], TIME_BUCKETS[i]!.label);
    assert.equal(TIME_BUCKETS.at(-1)!.range[0], -999, 'the nearest band takes everything overdue');
  });
});
