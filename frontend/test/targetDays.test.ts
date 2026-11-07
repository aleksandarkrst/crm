// Target days (CD-487): `npm test` in frontend. Out-of-range values are refused, never clamped.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { targetOf } from '../src/lib/validate.ts';

describe('targetOf (CD-487)', () => {
  it('accepts whole days 1..365, and empty as no target', () => {
    assert.equal(targetOf('1'), 1);
    assert.equal(targetOf('365'), 365);
    assert.equal(targetOf(''), null);
    assert.equal(targetOf('  '), null);
  });

  it('refuses out of range, fractions and bad input instead of clamping', () => {
    for (const raw of ['-5', '0', '366', '99999999', '1.5', 'abc']) assert.equal(targetOf(raw), undefined, raw);
    assert.equal(targetOf('', true), undefined);
  });
});
