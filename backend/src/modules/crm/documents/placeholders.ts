/**
 * Merge fields of document templates (CD-13): the reference shown in Settings → Document templates,
 * and the pure function that turns a deal into their values. No I/O here, so it is unit tested
 * (test/document-placeholders.spec.ts).
 *
 * Templates write fields in double braces: `{{opportunity.title}}`. `{{deal.title}}` fills the same
 * value. Opportunity lines repeat with a loop, usually around one table row:
 * `{{#lines}} {{line.product}} … {{line.total}} {{/lines}}`.
 */

import type { BillingFrequency, DealDiscount, DiscountKind, TaxMode } from '../../../shared/database/schema';
import { dealTotals, splitTax } from '../deals/deal-value';

export interface PlaceholderDef {
  tag: string;
  label: string;
  group: string;
  example: string;
}

const P = (group: string, tag: string, label: string, example: string): PlaceholderDef => ({ group, tag, label, example });

/** `{{opportunity.*}}` is what the help lists. `{{deal.*}}` is the same field, kept for saved templates. */
const OPPORTUNITY_FIELDS = [
  ['title', 'Opportunity title', 'ESG communications'],
  ['amount', 'Opportunity value without tax, in the opportunity currency', '€78,000'],
  ['vat', 'Tax on the opportunity', '€15,600'],
  ['total', 'Total with tax', '€93,600'],
  ['discount', 'Opportunity discount on one-time products', '€2,000'],
  ['currency', 'Currency code', 'EUR'],
  ['closing_date', 'Closing date', '31 October 2026'],
  ['stage', 'Stage', 'Proposal'],
  ['funnel', 'Funnel', 'Enterprise'],
  ['source', 'Source', 'Conference'],
] as const;

/** Every field a template can use outside the lines loop. */
export const PLACEHOLDERS: readonly PlaceholderDef[] = [
  P('Company', 'company.name', 'Company name', 'Voltek Energy'),
  P('Company', 'company.industry', 'Industry', 'Renewable energy'),
  P('Company', 'company.hq', 'Headquarters', 'Novi Sad'),
  P('Company', 'company.website', 'Website', 'voltek.eu'),
  P('Contact', 'contact.name', 'Primary contact', 'Ivana Radić'),
  P('Contact', 'contact.first_name', 'Contact first name', 'Ivana'),
  P('Contact', 'contact.job_title', 'Contact job title', 'Communications Lead'),
  P('Contact', 'contact.email', 'Contact email', 'i.radic@voltek.eu'),
  P('Contact', 'contact.phone', 'Contact phone', '+381 21 660 118'),
  ...OPPORTUNITY_FIELDS.map(([field, label, example]) => P('Opportunity', `opportunity.${field}`, label, example)),
  P('Owner', 'owner.name', 'Opportunity owner', 'Mila Jovanović'),
  P('Owner', 'owner.email', 'Owner email', 'mila@studio.rs'),
  P('Owner', 'owner.job_title', 'Owner job title', 'Account Director'),
  P('Owner', 'owner.phone', 'Owner phone', '+381 60 123 4567'),
  P('Workspace', 'workspace.name', 'Workspace name', 'Studio Kap'),
  P('Workspace', 'today', "Today's date", '24 September 2026'),
];

/** Fields inside `{{#lines}} … {{/lines}}`, one repetition per opportunity line. */
export const LINE_PLACEHOLDERS: readonly PlaceholderDef[] = [
  P('Opportunity lines', 'line.product', 'Product or service', 'Communications strategy'),
  P('Opportunity lines', 'line.description', 'Line description', 'Strategy, messaging and launch plan'),
  P('Opportunity lines', 'line.quantity', 'Quantity', '12'),
  P('Opportunity lines', 'line.unit', 'Unit of the product', 'hour'),
  P('Opportunity lines', 'line.unit_price', 'Unit price', '€2,400'),
  P('Opportunity lines', 'line.discount', 'Line discount', '10%'),
  P('Opportunity lines', 'line.vat_rate', 'Tax rate', '20%'),
  P('Opportunity lines', 'line.net', 'Line value without tax (all billing cycles)', '€28,800'),
  P('Opportunity lines', 'line.vat', 'Line tax', '€5,760'),
  P('Opportunity lines', 'line.total', 'Line total with tax', '€34,560'),
  P('Opportunity lines', 'line.schedule', 'Billing', 'Monthly, 12 cycles'),
  P('Opportunity lines', 'line.start_date', 'Billing start date', '1 November 2026'),
];

/** The loop over opportunity lines. */
export const LINES_LOOP = 'lines';

/** Short forms, as the design's examples write them. */
export const ALIASES: Readonly<Record<string, string>> = {
  company: 'company.name',
  contact_name: 'contact.name',
  price: 'opportunity.amount',
  total: 'opportunity.total',
};

/**
 * Discovery notes are no longer merged into documents (CD-362). Templates saved before still work:
 * the headline becomes the opportunity title and the others render empty, never as raw `{{tags}}`.
 * They are left out of the reference and of the missing-field lists.
 */
const RETIRED: Readonly<Record<string, { label: string; value: (src: DocumentSource) => string }>> = {
  'deal.headline': { label: 'Opportunity title (was the proposal headline)', value: (src) => text(src.deal.title) },
  'opportunity.headline': { label: 'Opportunity title (was the proposal headline)', value: (src) => text(src.deal.title) },
  'discovery.need': { label: 'Discovery need (no longer filled)', value: () => '' },
  'discovery.constraint': { label: 'Discovery constraint (no longer filled)', value: () => '' },
  'discovery.decision_maker': { label: 'Discovery decision maker (no longer filled)', value: () => '' },
  'discovery.date': { label: 'Discovery call date (no longer filled)', value: () => '' },
  need: { label: 'Discovery need (no longer filled)', value: () => '' },
};

const LABELS = new Map<string, string>([...PLACEHOLDERS, ...LINE_PLACEHOLDERS].map((p) => [p.tag, p.label]));
for (const [alias, tag] of Object.entries(ALIASES)) LABELS.set(alias, LABELS.get(tag)!);
for (const [field] of OPPORTUNITY_FIELDS) LABELS.set(`deal.${field}`, LABELS.get(`opportunity.${field}`)!);
LABELS.set(LINES_LOOP, 'Opportunity lines');
for (const [tag, { label }] of Object.entries(RETIRED)) LABELS.set(tag, label);

/** `deal.X` and a short alias of it count as the `opportunity.X` field in missing-field lists. */
const CANONICAL = new Map<string, string>(OPPORTUNITY_FIELDS.map(([field]) => [`deal.${field}`, `opportunity.${field}`]));
const canonicalTag = (tag: string): string => {
  const resolved = ALIASES[tag] ?? tag;
  return CANONICAL.get(resolved) ?? resolved;
};

/** A field found in a template, and whether the CRM fills it. */
export interface FoundPlaceholder {
  tag: string;
  known: boolean;
  label: string | null;
}

export function describeTags(tags: Iterable<string>): FoundPlaceholder[] {
  return [...new Set(tags)].map((tag) => ({ tag, known: LABELS.has(tag), label: LABELS.get(tag) ?? null }));
}

// ---------------------------------------------------------------- building the values

/** Everything a document is filled from; DocumentsService loads it inside withTenant. */
export interface DocumentSource {
  workspace: { name: string; currency: string; timezone: string };
  deal: {
    title: string;
    amount: string | number;
    currency: string;
    closeDate: string | null;
    source: string | null;
    stage: string | null;
    funnel: string | null;
    taxMode: TaxMode;
    discounts: Pick<DealDiscount, 'kind' | 'value'>[];
  };
  company: { name: string; industry: string | null; hq: string | null; domain: string | null } | null;
  contact: { fullName: string; jobTitle: string | null; email: string | null; phone: string | null } | null;
  owner: { name: string | null; email: string | null; jobTitle: string | null; phone: string | null } | null;
  lines: {
    product: string | null;
    unit: string | null;
    description: string | null;
    quantity: string | number;
    unitPrice: string | number;
    vatRate: string | number;
    discountKind: DiscountKind;
    discountValue: string | number;
    billingFrequency: BillingFrequency;
    billingCycles: number | null;
    startDate: string | null;
  }[];
  now: Date;
}

export interface TemplateData {
  [tag: string]: string | Record<string, string>[];
  lines: Record<string, string>[];
}

/** English locales that write a currency the way its home market does (as the UI does). */
const LOCALES: Record<string, string> = { EUR: 'en-IE', USD: 'en-US', GBP: 'en-GB', CHF: 'en-CH', AUD: 'en-AU', CAD: 'en-CA', NZD: 'en-NZ', INR: 'en-IN', SGD: 'en-SG', HKD: 'en-HK', ZAR: 'en-ZA' };

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * An amount in `currency`, written in the locale of the workspace currency (like the UI:
 * a euro workspace writes "€14,000" and "US$2,500"). Whole amounts have no decimals, others two.
 */
export function formatMoney(amount: number, currency: string, workspaceCurrency: string): string {
  const n = round2(amount);
  const digits = Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat(LOCALES[workspaceCurrency] ?? 'en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  } catch {
    return `${n.toFixed(digits)} ${currency}`; // not an ISO 4217 code
  }
}

/** A calendar date ("2026-09-24") as "24 September 2026". Empty for none. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Today in the workspace time zone, as "24 September 2026". */
export function formatToday(now: Date, timezone: string): string {
  try {
    return now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone });
  } catch {
    return now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
}

const FREQUENCY: Record<BillingFrequency, string> = { one_time: 'One time', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', annually: 'Annually' };

/** "One time", "Monthly, 4 cycles" or "Monthly, until canceled". */
export function billingText(frequency: BillingFrequency, cycles: number | null): string {
  if (frequency === 'one_time') return FREQUENCY.one_time;
  return `${FREQUENCY[frequency]}, ${cycles ? `${cycles} ${cycles === 1 ? 'cycle' : 'cycles'}` : 'until canceled'}`;
}
const text = (v: string | null | undefined) => (v ?? '').trim();
const quantity = (v: string | number) => String(round2(num(v)));
const percent = (v: string | number) => `${round2(num(v))}%`;

/**
 * The values of every merge field for one deal. Missing values are empty strings (never "null"),
 * so a template renders cleanly; `missingFields` says which of the used ones were empty.
 */
export function buildTemplateData(src: DocumentSource): TemplateData {
  const cur = src.deal.currency || src.workspace.currency;
  const money = (n: number) => formatMoney(n, cur, src.workspace.currency);

  const inputs = src.lines.map((ln) => ({
    quantity: num(ln.quantity),
    unitPrice: num(ln.unitPrice),
    vatRate: num(ln.vatRate),
    discountKind: ln.discountKind,
    discountValue: num(ln.discountValue),
    billingFrequency: ln.billingFrequency,
    billingCycles: ln.billingCycles,
  }));
  const totals = dealTotals(inputs, src.deal.taxMode, src.deal.discounts);
  const lines = src.lines.map((ln, i) => {
    const { tcv } = totals.lines[i]!;
    const { net } = splitTax(tcv, num(ln.vatRate), src.deal.taxMode === 'none' ? 'none' : 'inclusive');
    return {
      'line.product': text(ln.product),
      'line.description': text(ln.description),
      'line.quantity': quantity(ln.quantity),
      'line.unit': text(ln.unit),
      'line.unit_price': money(num(ln.unitPrice)),
      'line.discount': num(ln.discountValue) > 0 ? (ln.discountKind === 'percent' ? percent(ln.discountValue) : money(num(ln.discountValue))) : '',
      'line.vat_rate': percent(ln.vatRate),
      'line.net': money(net),
      'line.vat': money(tcv - net),
      'line.total': money(tcv),
      'line.schedule': billingText(ln.billingFrequency, ln.billingCycles),
      'line.start_date': formatDate(ln.startDate),
    };
  });
  const amount = num(src.deal.amount);
  const vat = totals.tax;
  const contactName = text(src.contact?.fullName);

  const values: Record<string, string> = {
    'company.name': text(src.company?.name),
    'company.industry': text(src.company?.industry),
    'company.hq': text(src.company?.hq),
    'company.website': text(src.company?.domain),
    'contact.name': contactName,
    'contact.first_name': contactName.split(/\s+/)[0] ?? '',
    'contact.job_title': text(src.contact?.jobTitle),
    'contact.email': text(src.contact?.email),
    'contact.phone': text(src.contact?.phone),
    'deal.title': text(src.deal.title),
    'deal.amount': money(amount),
    'deal.vat': money(vat),
    'deal.total': money(amount + vat),
    'deal.discount': totals.discount > 0 ? money(totals.discount) : '',
    'deal.currency': cur,
    'deal.closing_date': formatDate(src.deal.closeDate),
    'deal.stage': text(src.deal.stage),
    'deal.funnel': text(src.deal.funnel),
    'deal.source': text(src.deal.source),
    'owner.name': text(src.owner?.name),
    'owner.email': text(src.owner?.email),
    'owner.job_title': text(src.owner?.jobTitle),
    'owner.phone': text(src.owner?.phone),
    'workspace.name': text(src.workspace.name),
    today: formatToday(src.now, src.workspace.timezone),
  };
  for (const [field] of OPPORTUNITY_FIELDS) values[`opportunity.${field}`] = values[`deal.${field}`]!;
  for (const [alias, tag] of Object.entries(ALIASES)) values[alias] = values[tag]!;
  for (const [tag, { value }] of Object.entries(RETIRED)) values[tag] = value(src);
  return { ...values, [LINES_LOOP]: lines };
}

/** Labels of the fields a template uses that had no value for this deal (for the document list). */
export function missingFields(usedTags: Iterable<string>, data: TemplateData): string[] {
  const out = new Set<string>();
  for (const tag of new Set(usedTags)) {
    if (tag === LINES_LOOP) {
      if (data.lines.length === 0) out.add(LINES_LOOP);
      continue;
    }
    if (tag.startsWith('line.')) continue; // per line; an empty cell in one row isn't worth a warning
    if (data[tag] === '') out.add(canonicalTag(tag));
  }
  // In the order of the reference, so the list reads the same for every document.
  return ORDER.filter((tag) => out.has(tag)).map((tag) => LABELS.get(tag)!);
}

const ORDER = [...PLACEHOLDERS.map((p) => p.tag), LINES_LOOP];
