import { describe, expect, it } from 'vitest';
import { dealTotals, type LineInput, lineCycles } from '../src/modules/crm/deals/deal-value';

const line = (over: Partial<LineInput> = {}): LineInput => ({
  quantity: 1,
  unitPrice: 100,
  vatRate: 20,
  discountKind: 'percent',
  discountValue: 0,
  billingFrequency: 'one_time',
  billingCycles: null,
  ...over,
});

describe('deal value (CD-83)', () => {
  it('counts a recurring product for its whole contract; until canceled is one year', () => {
    expect(lineCycles(line())).toBe(1);
    expect(lineCycles(line({ billingFrequency: 'monthly', billingCycles: 4 }))).toBe(4);
    expect(lineCycles(line({ billingFrequency: 'monthly' }))).toBe(12);
    expect(lineCycles(line({ billingFrequency: 'weekly' }))).toBe(52);
    expect(lineCycles(line({ billingFrequency: 'quarterly' }))).toBe(4);
    expect(lineCycles(line({ billingFrequency: 'annually' }))).toBe(1);
    const t = dealTotals([line({ unitPrice: 40, billingFrequency: 'monthly', billingCycles: 4 })], 'exclusive', []);
    expect(t).toMatchObject({ subtotal: 160, tax: 32, total: 192, mrr: 40, arr: 480, acv: 480 });
  });

  it('applies line discounts (percent or capped amount) and tax modes', () => {
    expect(dealTotals([line({ quantity: 2, discountKind: 'percent', discountValue: 25 })], 'exclusive', [])).toMatchObject({ subtotal: 150, tax: 30, total: 180 });
    expect(dealTotals([line({ discountKind: 'amount', discountValue: 500 })], 'exclusive', [])).toMatchObject({ subtotal: 0, total: 0 });
    expect(dealTotals([line({ unitPrice: 120 })], 'inclusive', [])).toMatchObject({ subtotal: 100, tax: 20, total: 120 });
    expect(dealTotals([line()], 'none', [])).toMatchObject({ subtotal: 100, tax: 0, total: 100 });
  });

  it('applies deal discounts to one-time products only', () => {
    const t = dealTotals(
      [line({ unitPrice: 1000 }), line({ unitPrice: 50, billingFrequency: 'monthly', billingCycles: 2 })],
      'exclusive',
      [
        { kind: 'percent', value: 10 },
        { kind: 'amount', value: 50 },
      ],
    );
    expect(t.discount).toBe(150);
    // one-time 1,000 - 150 = 850; recurring 50 × 2 = 100.
    expect(t).toMatchObject({ subtotal: 950, oneTimeTotal: 1020, lines: [{ perCycle: 850, cycles: 1 }, { perCycle: 50, cycles: 2 }] });
    // A discount can't make the one-time products negative.
    expect(dealTotals([line()], 'exclusive', [{ kind: 'amount', value: 999 }])).toMatchObject({ subtotal: 0, discount: 100 });
  });
});
