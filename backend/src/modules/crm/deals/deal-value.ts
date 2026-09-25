import type { BillingFrequency, DealDiscount, DiscountKind, TaxMode } from '../../../shared/database/schema';

/**
 * A deal's money (CD-83), from its lines, tax mode and discounts. Pure, so the API and the tests
 * compute the same numbers; the frontend has the same rules in store/dealMath.ts.
 *
 * - A line's amount per billing cycle is quantity × unit price, less its discount (a percentage,
 *   or an amount capped at the line). The deal's tax mode says whether that amount excludes tax,
 *   includes it, or has none.
 * - Deal discounts apply to one-time products only: they lower the one-time lines proportionally.
 * - A one-time line bills once; a recurring one every period, for its cycles. "Renews until
 *   canceled" counts one year of cycles, so the contract value stays finite.
 * - The deal value (deals.amount) is the contract value without tax.
 */
export interface LineInput {
  quantity: number;
  unitPrice: number;
  vatRate: number;
  discountKind: DiscountKind;
  discountValue: number;
  billingFrequency: BillingFrequency;
  billingCycles: number | null;
}

export const CYCLES_PER_YEAR: Record<Exclude<BillingFrequency, 'one_time'>, number> = { weekly: 52, monthly: 12, quarterly: 4, annually: 1 };

const round2 = (n: number) => Math.round(n * 100) / 100;

export const isRecurring = (l: Pick<LineInput, 'billingFrequency'>) => l.billingFrequency !== 'one_time';

/** How many times a line bills in the contract. */
export function lineCycles(l: Pick<LineInput, 'billingFrequency' | 'billingCycles'>): number {
  if (l.billingFrequency === 'one_time') return 1;
  return l.billingCycles ?? CYCLES_PER_YEAR[l.billingFrequency];
}

/** A line's amount per cycle as entered (after its own discount), in the deal's tax mode. */
export function lineAmount(l: LineInput): number {
  const base = l.quantity * l.unitPrice;
  const off = l.discountKind === 'percent' ? (base * Math.min(100, l.discountValue)) / 100 : Math.min(base, l.discountValue);
  return Math.max(0, base - off);
}

/** Splits an amount as entered into net and tax. */
export function splitTax(amount: number, rate: number, mode: TaxMode): { net: number; tax: number } {
  if (mode === 'none') return { net: amount, tax: 0 };
  if (mode === 'inclusive') {
    const net = amount / (1 + rate / 100);
    return { net, tax: amount - net };
  }
  return { net: amount, tax: (amount * rate) / 100 };
}

export interface DealTotals {
  /** Contract value without tax: the deal value. */
  subtotal: number;
  tax: number;
  /** Contract value with tax. */
  total: number;
  /** What the deal discounts take off (as entered, before tax is split). */
  discount: number;
  /** One-time products after discounts, with tax: what installments should add up to. */
  oneTimeTotal: number;
  /** Recurring revenue without tax, per month and per year; ACV is the first year's value. */
  mrr: number;
  arr: number;
  acv: number;
  /** Per line: amount per cycle after deal discounts (as entered), cycles, and contract value with tax. */
  lines: { perCycle: number; cycles: number; tcv: number }[];
}

export function dealTotals(lines: LineInput[], mode: TaxMode, discounts: Pick<DealDiscount, 'kind' | 'value'>[]): DealTotals {
  const oneTime = lines.filter((l) => !isRecurring(l)).reduce((a, l) => a + lineAmount(l), 0);
  const wanted = discounts.reduce((a, d) => a + (d.kind === 'percent' ? (oneTime * Math.min(100, d.value)) / 100 : d.value), 0);
  const discount = Math.min(oneTime, wanted);
  const factor = oneTime > 0 ? (oneTime - discount) / oneTime : 1;

  let subtotal = 0;
  let tax = 0;
  let oneTimeTotal = 0;
  let mrr = 0;
  let oneTimeNet = 0;
  const out: DealTotals['lines'] = [];
  for (const l of lines) {
    const perCycle = lineAmount(l) * (isRecurring(l) ? 1 : factor);
    const cycles = lineCycles(l);
    const { net, tax: t } = splitTax(perCycle, l.vatRate, mode);
    subtotal += net * cycles;
    tax += t * cycles;
    out.push({ perCycle, cycles, tcv: (net + t) * cycles });
    if (isRecurring(l)) mrr += (net * CYCLES_PER_YEAR[l.billingFrequency as Exclude<BillingFrequency, 'one_time'>]) / 12;
    else {
      oneTimeTotal += net + t;
      oneTimeNet += net;
    }
  }
  return {
    subtotal: round2(subtotal),
    tax: round2(tax),
    total: round2(subtotal + tax),
    discount: round2(discount),
    oneTimeTotal: round2(oneTimeTotal),
    mrr: round2(mrr),
    arr: round2(mrr * 12),
    acv: round2(oneTimeNet + mrr * 12),
    lines: out.map((x) => ({ perCycle: round2(x.perCycle), cycles: x.cycles, tcv: round2(x.tcv) })),
  };
}
