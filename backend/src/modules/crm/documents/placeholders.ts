/**
 * Merge fields of document templates (CD-13): the reference shown in Settings → Document templates,
 * and the pure function that turns a deal into their values. No I/O here, so it is unit tested
 * (test/document-placeholders.spec.ts).
 *
 * Templates write fields in double braces, as the design's template dialog says: `{{deal.title}}`.
 * Deal lines repeat with a loop, usually around one table row:
 * `{{#lines}} {{line.product}} … {{line.total}} {{/lines}}`.
 */

export interface PlaceholderDef {
  tag: string;
  label: string;
  group: string;
  example: string;
}

const P = (group: string, tag: string, label: string, example: string): PlaceholderDef => ({ group, tag, label, example });

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
  P('Deal', 'deal.title', 'Deal title', 'ESG communications'),
  P('Deal', 'deal.headline', 'Proposal headline (the deal title when empty)', 'An ESG story investors can verify'),
  P('Deal', 'deal.amount', 'Net amount, in the deal currency', '€78,000'),
  P('Deal', 'deal.vat', 'VAT on the deal lines', '€15,600'),
  P('Deal', 'deal.total', 'Total incl. VAT', '€93,600'),
  P('Deal', 'deal.currency', 'Currency code', 'EUR'),
  P('Deal', 'deal.closing_date', 'Closing date', '31 October 2026'),
  P('Deal', 'deal.stage', 'Stage', 'Proposal'),
  P('Deal', 'deal.funnel', 'Funnel', 'Enterprise'),
  P('Deal', 'deal.source', 'Source', 'Conference'),
  P('Discovery', 'discovery.need', 'Need', 'an ESG communications programme…'),
  P('Discovery', 'discovery.constraint', 'Constraint', 'investor day in March'),
  P('Discovery', 'discovery.decision_maker', 'Decision maker', 'the CEO with board visibility'),
  P('Discovery', 'discovery.date', 'Discovery call date', '5 September 2026'),
  P('Owner', 'owner.name', 'Deal owner', 'Mila Jovanović'),
  P('Owner', 'owner.email', 'Owner email', 'mila@studio.rs'),
  P('Owner', 'owner.job_title', 'Owner job title', 'Account Director'),
  P('Owner', 'owner.phone', 'Owner phone', '+381 60 123 4567'),
  P('Workspace', 'workspace.name', 'Workspace name', 'Studio Kap'),
  P('Workspace', 'today', "Today's date", '24 September 2026'),
];

/** Fields inside `{{#lines}} … {{/lines}}`, one repetition per deal line. */
export const LINE_PLACEHOLDERS: readonly PlaceholderDef[] = [
  P('Deal lines', 'line.product', 'Product or service', 'Communications strategy'),
  P('Deal lines', 'line.quantity', 'Quantity', '12'),
  P('Deal lines', 'line.unit', 'Unit (h, mo, yr, or empty)', 'mo'),
  P('Deal lines', 'line.unit_price', 'Unit price', '€2,400'),
  P('Deal lines', 'line.vat_rate', 'VAT rate', '20%'),
  P('Deal lines', 'line.net', 'Line net (quantity × price)', '€28,800'),
  P('Deal lines', 'line.vat', 'Line VAT', '€5,760'),
  P('Deal lines', 'line.total', 'Line total incl. VAT', '€34,560'),
  P('Deal lines', 'line.schedule', 'Payment schedule', 'Equal monthly instalments'),
  P('Deal lines', 'line.start_date', 'First payment', '1 November 2026'),
];

/** The loop over deal lines. */
export const LINES_LOOP = 'lines';

/** Short forms, as the design's examples write them. */
export const ALIASES: Readonly<Record<string, string>> = {
  company: 'company.name',
  contact_name: 'contact.name',
  price: 'deal.amount',
  total: 'deal.total',
  need: 'discovery.need',
};

const LABELS = new Map<string, string>([...PLACEHOLDERS, ...LINE_PLACEHOLDERS].map((p) => [p.tag, p.label]));
for (const [alias, tag] of Object.entries(ALIASES)) LABELS.set(alias, LABELS.get(tag)!);
LABELS.set(LINES_LOOP, 'Deal lines');

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
    headline: string | null;
    amount: string | number;
    currency: string;
    closeDate: string | null;
    source: string | null;
    stage: string | null;
    funnel: string | null;
    need: string | null;
    constraint: string | null;
    decisionMaker: string | null;
    discoveryDate: string | null;
  };
  company: { name: string; industry: string | null; hq: string | null; domain: string | null } | null;
  contact: { fullName: string; jobTitle: string | null; email: string | null; phone: string | null } | null;
  owner: { name: string | null; email: string | null; jobTitle: string | null; phone: string | null } | null;
  lines: {
    product: string | null;
    billingKind: string | null;
    quantity: string | number;
    unitPrice: string | number;
    vatRate: string | number;
    schedule: string;
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

const UNITS: Record<string, string> = { Hourly: 'h', Monthly: 'mo', Yearly: 'yr' };
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

  const lines = src.lines.map((ln) => {
    const net = num(ln.quantity) * num(ln.unitPrice);
    const vat = (net * num(ln.vatRate)) / 100;
    return {
      'line.product': text(ln.product),
      'line.quantity': quantity(ln.quantity),
      'line.unit': UNITS[ln.billingKind ?? ''] ?? '',
      'line.unit_price': money(num(ln.unitPrice)),
      'line.vat_rate': percent(ln.vatRate),
      'line.net': money(net),
      'line.vat': money(vat),
      'line.total': money(net + vat),
      'line.schedule': ln.schedule,
      'line.start_date': formatDate(ln.startDate),
    };
  });
  const amount = num(src.deal.amount);
  const vat = src.lines.reduce((sum, ln) => sum + (num(ln.quantity) * num(ln.unitPrice) * num(ln.vatRate)) / 100, 0);
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
    'deal.headline': text(src.deal.headline) || text(src.deal.title),
    'deal.amount': money(amount),
    'deal.vat': money(vat),
    'deal.total': money(amount + vat),
    'deal.currency': cur,
    'deal.closing_date': formatDate(src.deal.closeDate),
    'deal.stage': text(src.deal.stage),
    'deal.funnel': text(src.deal.funnel),
    'deal.source': text(src.deal.source),
    'discovery.need': text(src.deal.need),
    'discovery.constraint': text(src.deal.constraint),
    'discovery.decision_maker': text(src.deal.decisionMaker),
    'discovery.date': formatDate(src.deal.discoveryDate),
    'owner.name': text(src.owner?.name),
    'owner.email': text(src.owner?.email),
    'owner.job_title': text(src.owner?.jobTitle),
    'owner.phone': text(src.owner?.phone),
    'workspace.name': text(src.workspace.name),
    today: formatToday(src.now, src.workspace.timezone),
  };
  for (const [alias, tag] of Object.entries(ALIASES)) values[alias] = values[tag]!;
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
    if (data[tag] === '') out.add(ALIASES[tag] ?? tag);
  }
  // In the order of the reference, so the list reads the same for every document.
  return ORDER.filter((tag) => out.has(tag)).map((tag) => LABELS.get(tag)!);
}

const ORDER = [...PLACEHOLDERS.map((p) => p.tag), LINES_LOOP];
