// Deal amounts without tax (CD-365): the payment-due chart on Overview counts them, like the deal value. `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dealTotals } from '../src/store/dealMath.ts';
import type { DealLine } from '../src/store/types.ts';

const line = (over: Partial<DealLine>): DealLine => ({
  id: 'l1',
  itemId: '',
  description: '',
  qty: 1,
  price: 1000,
  discountKind: 'percent',
  discount: 0,
  vat: 20,
  frequency: 'one_time',
  cycles: null,
  start: '2026-11-01',
  ...over,
});

describe('deal amounts without tax (CD-365)', () => {
  it('a line on prices without tax: net 1,000, with tax 1,200', () => {
    const t = dealTotals([line({})], 'exclusive', []);
    assert.deepEqual(t.lines[0], { perCycle: 1000, cycles: 1, tcv: 1200, net: 1000 });
    assert.deepEqual([t.oneTimeNet, t.oneTimeTotal], [1000, 1200]);
  });

  it('a line on prices with tax included: 1,200 is 1,000 without tax', () => {
    const t = dealTotals([line({ price: 1200 })], 'inclusive', []);
    assert.equal(t.lines[0]!.net, 1000);
    assert.equal(t.lines[0]!.tcv, 1200);
    assert.deepEqual([t.oneTimeNet, t.oneTimeTotal], [1000, 1200]);
  });

  it('a monthly line for 12 months: the net is the 12 cycles without tax', () => {
    const t = dealTotals([line({ frequency: 'monthly', cycles: 12, price: 100 })], 'exclusive', []);
    assert.deepEqual(t.lines[0], { perCycle: 100, cycles: 12, tcv: 1440, net: 1200 });
  });
});
