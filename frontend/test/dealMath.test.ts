// Typed amounts in the product and deal forms (CD-479): refused, never stripped or clamped. `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { amountProblem, MAX_PRICE, num } from '../src/store/dealMath.ts';

describe('amountProblem', () => {
  const check = (raw: unknown, max = MAX_PRICE) => amountProblem(raw, 'Price', max);

  it('accepts plain numbers, decimals and comma thousands separators', () => {
    for (const ok of ['', '0', '1234.50', '.5', '12.', '1,234.50', '1,234,567', '999,999,999']) assert.equal(check(ok), '', ok);
  });

  it('refuses letters and badly grouped commas', () => {
    for (const bad of ['abc', '12a', '1,2,3', '12,34', '1,2345', ',123', '1.2.3']) assert.equal(check(bad), 'Price must be a number', bad);
  });

  it('refuses a negative value instead of flipping its sign', () => {
    assert.equal(check('-500'), "Price can't be negative");
    assert.equal(check('-1,000'), "Price can't be negative");
  });

  it('refuses a value over the maximum instead of clamping it', () => {
    assert.equal(check('150', 100), 'Price can be at most 100');
    assert.equal(check('100', 100), '');
    assert.equal(check('1,000,000,000'), 'Price can be at most 999,999,999');
  });
});

describe('num', () => {
  it('keeps the minus sign', () => {
    assert.equal(num('-500'), -500);
    assert.equal(num(-2), -2);
  });

  it('drops thousands commas and symbols', () => {
    assert.equal(num('1,234.50'), 1234.5);
    assert.equal(num('€ 1,200'), 1200);
  });

  it('reads anything else as 0', () => {
    for (const x of [null, undefined, '', 'abc', '5-']) assert.equal(num(x), 0, String(x));
  });
});
