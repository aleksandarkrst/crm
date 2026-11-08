// A salesperson's bonus rule in Settings (CD-479 QA): a refused number is named, never flipped or clamped. `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bonusRuleProblems } from '../src/store/dealMath.ts';

describe('bonusRuleProblems', () => {
  it('accepts an empty rule and valid numbers', () => {
    assert.deepEqual(bonusRuleProblems({ rate: '', floor: '', fixed: '' }), { rate: '', floor: '', fixed: '' });
    assert.deepEqual(bonusRuleProblems({ rate: '7.5', floor: '10,000', fixed: 250 }), { rate: '', floor: '', fixed: '' });
  });

  it('names a negative, a too-large rate and letters per field', () => {
    assert.deepEqual(bonusRuleProblems({ rate: '-5', floor: '-1', fixed: 'abc' }), {
      rate: "Rate can't be negative",
      floor: "Minimum can't be negative",
      fixed: 'Flat amount must be a number',
    });
    assert.equal(bonusRuleProblems({ rate: '150', floor: '', fixed: '' }).rate, 'Rate can be at most 100');
    assert.equal(bonusRuleProblems({ rate: '', floor: '1,000,000,000,000', fixed: '' }).floor, 'Minimum can be at most 999,999,999,999');
  });
});
