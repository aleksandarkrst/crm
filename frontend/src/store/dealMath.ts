/**
 * A deal's money (CD-83): the same rules as the API's deal-value.ts, so the products dialog shows
 * the numbers the API saves.
 *
 * - A line's amount per billing cycle is quantity × unit price, less its discount (a percentage,
 *   or an amount capped at the line). The deal's tax mode says whether that amount excludes tax,
 *   includes it, or has none.
 * - Deal discounts apply to one-time products only: they lower the one-time lines proportionally.
 * - A one-time line bills once; a recurring one every period, for its cycles. "Renews until
 *   canceled" counts one year of cycles, so the contract value stays finite.
 * - The deal value is the contract value without tax.
 */
import type { BillingFrequency, DealDiscount, DealLine, TaxMode } from './types';

const num = (v: unknown): number => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const FREQUENCIES: { value: BillingFrequency; label: string }[] = [
  { value: 'one_time', label: 'One time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
];
export const TAX_MODES: { value: TaxMode; label: string }[] = [
  { value: 'exclusive', label: 'Tax exclusive' },
  { value: 'inclusive', label: 'Tax inclusive' },
  { value: 'none', label: 'No tax' },
];
export const CYCLES_PER_YEAR: Record<Exclude<BillingFrequency, 'one_time'>, number> = { weekly: 52, monthly: 12, quarterly: 4, annually: 1 };
/** Months between two billing dates (weekly: a quarter of a month is not used; see billingDates). */
const PERIOD_MONTHS: Record<Exclude<BillingFrequency, 'one_time' | 'weekly'>, number> = { monthly: 1, quarterly: 3, annually: 12 };

export const frequencyLabel = (f: BillingFrequency): string => FREQUENCIES.find((x) => x.value === f)?.label ?? f;
export const isRecurring = (l: { frequency: BillingFrequency }) => l.frequency !== 'one_time';

/** "One time", "Monthly (4 cycles)", "Monthly (until canceled)". */
export function billingText(frequency: BillingFrequency, cycles: number | null): string {
  if (frequency === 'one_time') return 'One time';
  return `${frequencyLabel(frequency)} (${cycles ? `${cycles} ${cycles === 1 ? 'cycle' : 'cycles'}` : 'until canceled'})`;
}

/** How many times a line bills in the contract. */
export function lineCycles(l: { frequency: BillingFrequency; cycles: number | null }): number {
  if (l.frequency === 'one_time') return 1;
  return l.cycles ?? CYCLES_PER_YEAR[l.frequency];
}

/** A line's amount per cycle as entered (after its own discount), in the deal's tax mode. */
export function lineAmount(l: Pick<DealLine, 'qty' | 'price' | 'discountKind' | 'discount'>): number {
  const base = num(l.qty) * num(l.price);
  const off = l.discountKind === 'percent' ? (base * Math.min(100, num(l.discount))) / 100 : Math.min(base, num(l.discount));
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
  /** What the deal discounts take off. */
  discount: number;
  /** One-time products after discounts, with tax: what installments should add up to. */
  oneTimeTotal: number;
  mrr: number;
  arr: number;
  /** First year's value: one-time products plus a year of recurring ones, without tax. */
  acv: number;
  /** Per line: amount per cycle after deal discounts (as entered), cycles, contract value with tax. */
  lines: { perCycle: number; cycles: number; tcv: number }[];
}

export function dealTotals(lines: DealLine[], mode: TaxMode, discounts: Pick<DealDiscount, 'kind' | 'value'>[]): DealTotals {
  const oneTime = lines.filter((l) => !isRecurring(l)).reduce((a, l) => a + lineAmount(l), 0);
  const wanted = discounts.reduce((a, d) => a + (d.kind === 'percent' ? (oneTime * Math.min(100, num(d.value))) / 100 : num(d.value)), 0);
  const discount = Math.min(oneTime, wanted);
  const factor = oneTime > 0 ? (oneTime - discount) / oneTime : 1;

  let subtotal = 0;
  let tax = 0;
  let oneTimeTotal = 0;
  let oneTimeNet = 0;
  let mrr = 0;
  const out: DealTotals['lines'] = [];
  for (const l of lines) {
    const perCycle = lineAmount(l) * (isRecurring(l) ? 1 : factor);
    const cycles = lineCycles(l);
    const { net, tax: t } = splitTax(perCycle, num(l.vat), mode);
    subtotal += net * cycles;
    tax += t * cycles;
    out.push({ perCycle, cycles, tcv: (net + t) * cycles });
    if (l.frequency !== 'one_time') mrr += (net * CYCLES_PER_YEAR[l.frequency]) / 12;
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

/** `iso` moved by whole months (kept within the target month: 31 Jan + 1 month is 28 Feb) or days; '' without a date. */
function shift(iso: string, months: number, days = 0): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay) + days);
  return d.toISOString().slice(0, 10);
}

/** The billing dates of a line from its start date (until canceled: the first year). */
export function billingDates(l: Pick<DealLine, 'frequency' | 'cycles' | 'start'>): string[] {
  if (!l.start) return [];
  const n = lineCycles(l);
  return Array.from({ length: n }, (_, i) => (l.frequency === 'one_time' ? l.start : l.frequency === 'weekly' ? shift(l.start, 0, 7 * i) : shift(l.start, PERIOD_MONTHS[l.frequency] * i)));
}

/** The last billing date of a line ('' without a start date). */
export const lastBillingDate = (l: Pick<DealLine, 'frequency' | 'cycles' | 'start'>): string => billingDates(l).at(-1) ?? '';
