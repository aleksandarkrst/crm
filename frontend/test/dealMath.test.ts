// Typed amounts in the product and deal forms (CD-479): refused, never stripped or clamped. `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { amountProblem, lineAmount, MAX_PRICE, num, quantityProblem } from '../src/store/dealMath.ts';

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

describe('quantityProblem', () => {
  it('refuses 0 and an empty quantity instead of saving 1 or a zero line (CD-502)', () => {
    for (const zero of ['0', '0.00', '', ' ', 0, null]) assert.equal(quantityProblem(zero), 'Quantity must be more than 0', String(zero));
  });

  it('accepts any positive quantity up to the maximum', () => {
    for (const ok of ['1', '0.5', '.25', '1,000', 3]) assert.equal(quantityProblem(ok), '', String(ok));
    assert.equal(quantityProblem('10,000,000'), 'Quantity can be at most 9,999,999');
  });

  it('keeps the number and sign messages', () => {
    assert.equal(quantityProblem('abc'), 'Quantity must be a number');
    assert.equal(quantityProblem('-1'), "Quantity can't be negative");
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

describe('lineAmount', () => {
  it('never adds a negative discount to the amount (CD-479 QA round 3)', () => {
    // A refused line is counted with quantity 0: its € -10 discount used to show as +€10.
    assert.equal(lineAmount({ qty: 0, price: 100, discountKind: 'amount', discount: -10 }), 0);
    assert.equal(lineAmount({ qty: 1, price: 100, discountKind: 'amount', discount: -10 }), 100);
    assert.equal(lineAmount({ qty: 1, price: 100, discountKind: 'percent', discount: -5 }), 100);
  });

  it('takes a valid discount off, never below zero', () => {
    assert.equal(lineAmount({ qty: 2, price: 100, discountKind: 'amount', discount: 10 }), 190);
    assert.equal(lineAmount({ qty: 2, price: 100, discountKind: 'percent', discount: 10 }), 180);
    assert.equal(lineAmount({ qty: 1, price: 100, discountKind: 'amount', discount: 500 }), 0);
  });
});
