import { describe, expect, it } from 'vitest';
import { buildDocx, docxText, inspectTemplate, renderTemplate, starterTemplate, TemplateFileError } from '../src/modules/crm/documents/docx';
import { ALIASES, buildTemplateData, describeTags, type DocumentSource, formatDate, formatMoney, formatToday, LINE_PLACEHOLDERS, missingFields, PLACEHOLDERS } from '../src/modules/crm/documents/placeholders';

const source = (over: Partial<DocumentSource> = {}): DocumentSource => ({
  workspace: { name: 'Studio Kap', currency: 'EUR', timezone: 'Europe/Belgrade' },
  deal: {
    title: 'Brand refresh',
    amount: '3001.00',
    currency: 'EUR',
    closeDate: '2026-10-31',
    source: 'Referral',
    stage: 'Proposal',
    funnel: 'SMB',
    taxMode: 'exclusive',
    discounts: [],
  },
  company: { name: 'Acme d.o.o.', industry: null, hq: 'Belgrade', domain: null },
  contact: { fullName: 'Ivana Radić', jobTitle: 'CMO', email: 'ivana@acme.test', phone: null },
  owner: { name: 'Mila Jovanović', email: 'mila@studio.test', jobTitle: null, phone: null },
  lines: [
    { product: 'Strategy', unit: 'hour', description: 'Two workshops', quantity: '2.00', unitPrice: '1500.50', vatRate: '20.00', discountKind: 'percent', discountValue: '0', billingFrequency: 'one_time', billingCycles: null, startDate: '2026-11-01' },
    { product: null, unit: null, description: null, quantity: '1', unitPrice: '0', vatRate: '0', discountKind: 'percent', discountValue: '0', billingFrequency: 'monthly', billingCycles: null, startDate: null },
  ],
  now: new Date('2026-09-24T23:30:00Z'),
  ...over,
});

describe('formatting', () => {
  it('writes amounts in the deal currency, in the workspace currency locale', () => {
    expect(formatMoney(14000, 'EUR', 'EUR')).toBe('€14,000');
    expect(formatMoney(1500.5, 'EUR', 'EUR')).toBe('€1,500.50');
    expect(formatMoney(2500, 'USD', 'USD')).toBe('$2,500');
    expect(formatMoney(2500, 'USD', 'EUR')).toBe('US$2,500');
    expect(formatMoney(0.1 + 0.2, 'GBP', 'GBP')).toBe('£0.30');
  });

  it('falls back to the code for a currency Intl does not know', () => {
    expect(formatMoney(10, 'XYZ1', 'EUR')).toBe('10 XYZ1');
  });

  it('writes calendar dates without shifting them, and today in the workspace time zone', () => {
    expect(formatDate('2026-10-31')).toBe('31 October 2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
    // 23:30 UTC is already the 25th in Belgrade.
    expect(formatToday(new Date('2026-09-24T23:30:00Z'), 'Europe/Belgrade')).toBe('25 September 2026');
    expect(formatToday(new Date('2026-09-24T23:30:00Z'), 'Not/AZone')).toBe('24 September 2026');
  });
});

describe('buildTemplateData', () => {
  it('fills lines and totals from the CD-83 billing model: discounts, cycles and tax mode', () => {
    const data = buildTemplateData(
      source({
        deal: { ...source().deal, amount: '1680.00', taxMode: 'exclusive', discounts: [{ kind: 'amount', value: 100 }] },
        lines: [
          { product: 'Setup', unit: 'day', description: null, quantity: '1', unitPrice: '1000', vatRate: '20', discountKind: 'percent', discountValue: '10', billingFrequency: 'one_time', billingCycles: null, startDate: '2026-11-01' },
          { product: 'Support', unit: 'month', description: null, quantity: '1', unitPrice: '200', vatRate: '20', discountKind: 'percent', discountValue: '0', billingFrequency: 'monthly', billingCycles: 4, startDate: '2026-11-01' },
        ],
      }),
    );
    // Setup: 1,000 less 10% = 900, less the €100 deal discount = 800 (+ 20% tax = 960).
    expect(data.lines[0]).toMatchObject({ 'line.discount': '10%', 'line.net': '€800', 'line.vat': '€160', 'line.total': '€960', 'line.schedule': 'One time' });
    // Support: 200 a month for 4 cycles = 800 (+ tax 160).
    expect(data.lines[1]).toMatchObject({ 'line.net': '€800', 'line.vat': '€160', 'line.total': '€960', 'line.schedule': 'Monthly, 4 cycles' });
    expect(data['deal.vat']).toBe('€320');
    expect(data['deal.discount']).toBe('€100');
  });

  it('reads prices as tax inclusive when the deal says so', () => {
    const data = buildTemplateData(
      source({
        deal: { ...source().deal, amount: '1000.00', taxMode: 'inclusive' },
        lines: [{ product: 'Setup', unit: null, description: null, quantity: '1', unitPrice: '1200', vatRate: '20', discountKind: 'percent', discountValue: '0', billingFrequency: 'one_time', billingCycles: null, startDate: null }],
      }),
    );
    expect(data.lines[0]).toMatchObject({ 'line.net': '€1,000', 'line.vat': '€200', 'line.total': '€1,200' });
    expect(data['deal.vat']).toBe('€200');
  });

  it('fills every field of the reference with a string', () => {
    const data = buildTemplateData(source());
    for (const p of PLACEHOLDERS) expect(typeof data[p.tag], p.tag).toBe('string');
    expect(data['company.name']).toBe('Acme d.o.o.');
    expect(data['contact.first_name']).toBe('Ivana');
    expect(data['deal.headline']).toBe('Brand refresh'); // retired (CD-362): the title
    expect(data['deal.amount']).toBe('€3,001');
    expect(data['deal.vat']).toBe('€600.20');
    expect(data['deal.total']).toBe('€3,601.20');
    expect(data['deal.closing_date']).toBe('31 October 2026');
    expect(data['owner.name']).toBe('Mila Jovanović');
    expect(data.today).toBe('25 September 2026');
    expect(data.company).toBe('Acme d.o.o.'); // alias
    expect(data.price).toBe('€3,001');
  });

  it('builds one row per deal line', () => {
    const [first, second] = buildTemplateData(source()).lines;
    expect(first).toMatchObject({ 'line.product': 'Strategy', 'line.description': 'Two workshops', 'line.quantity': '2', 'line.unit': 'hour', 'line.discount': '', 'line.schedule': 'One time', 'line.unit_price': '€1,500.50', 'line.vat_rate': '20%', 'line.net': '€3,001', 'line.vat': '€600.20', 'line.total': '€3,601.20', 'line.start_date': '1 November 2026' });
    expect(second).toMatchObject({ 'line.product': '', 'line.unit': '', 'line.total': '€0', 'line.start_date': '', 'line.schedule': 'Monthly, until canceled' });
  });

  it('uses the deal currency, not the workspace one', () => {
    const data = buildTemplateData(source({ deal: { ...source().deal, currency: 'USD' } }));
    expect(data['deal.amount']).toBe('US$3,001');
    expect(data['deal.currency']).toBe('USD');
  });

  it('leaves missing values empty, never "null" or "undefined"', () => {
    const data = buildTemplateData(source({ company: null, contact: null, owner: null, lines: [] }));
    expect(data['company.name']).toBe('');
    expect(data['contact.first_name']).toBe('');
    expect(data['owner.email']).toBe('');
    expect(data['deal.vat']).toBe('€0');
    expect(data['deal.total']).toBe('€3,001');
    expect(Object.values(data).filter((v) => typeof v === 'string' && /null|undefined|NaN/.test(v))).toEqual([]);
  });
});

describe('missingFields', () => {
  it('lists the used fields that were empty, in reference order, aliases included', () => {
    const data = buildTemplateData(source({ lines: [] }));
    const used = ['contact.phone', 'company.name', 'lines', 'line.product', 'contact_name', 'company.industry', 'unknown.field'];
    expect(missingFields(used, data)).toEqual(['Industry', 'Contact phone', 'Opportunity lines']);
  });

  it('lists an empty opportunity tag once, with the opportunity label, even when the legacy tag is used too', () => {
    const data = buildTemplateData(source({ deal: { ...source().deal, title: '  ', source: null } }));
    expect(data['opportunity.title']).toBe('');
    expect(data['deal.title']).toBe('');
    expect(missingFields(['opportunity.title', 'deal.title', 'opportunity.source', 'deal.source'], data)).toEqual(['Opportunity title', 'Source']);
  });
});

describe('opportunity aliases', () => {
  const fields = ['title', 'amount', 'vat', 'total', 'discount', 'currency', 'closing_date', 'stage', 'funnel', 'source'] as const;

  it('renders {{opportunity.X}} the same as {{deal.X}} for every tag, and a legacy-only template the same as before', () => {
    const data = buildTemplateData(source());
    for (const field of fields) expect(data[`opportunity.${field}`], field).toBe(data[`deal.${field}`]);
    expect(data.price).toBe(data['deal.amount']);
    expect(data.total).toBe(data['deal.total']);

    const legacy = `{{deal.title}} · {{deal.amount}} · {{price}}`;
    const next = `{{opportunity.title}} · {{opportunity.amount}} · {{price}}`;
    const legacyText = docxText(renderTemplate(buildDocx([{ text: legacy }]), data).file);
    const nextText = docxText(renderTemplate(buildDocx([{ text: next }]), data).file);
    expect(legacyText).toBe('Brand refresh · €3,001 · €3,001');
    expect(nextText).toBe(legacyText);

    const allLegacy = fields.map((field) => `{{deal.${field}}}`).join(' | ');
    const allNext = fields.map((field) => `{{opportunity.${field}}}`).join(' | ');
    expect(docxText(renderTemplate(buildDocx([{ text: allNext }]), data).file)).toBe(docxText(renderTemplate(buildDocx([{ text: allLegacy }]), data).file));
  });

  it('lists opportunity names in the help, and no Deal wording in labels or groups', () => {
    const listed = [...PLACEHOLDERS, ...LINE_PLACEHOLDERS];
    expect(listed.map((p) => p.tag)).toEqual(expect.arrayContaining(fields.map((field) => `opportunity.${field}`)));
    expect(listed.some((p) => p.tag.startsWith('deal.'))).toBe(false);
    for (const p of listed) {
      expect(p.label).not.toMatch(/deal/i);
      expect(p.group).not.toMatch(/deal/i);
    }
    expect(PLACEHOLDERS.find((p) => p.tag === 'opportunity.title')).toMatchObject({ group: 'Opportunity', label: 'Opportunity title' });
    expect(PLACEHOLDERS.find((p) => p.tag === 'opportunity.amount')?.label).toMatch(/^Opportunity value/);
    expect(PLACEHOLDERS.find((p) => p.tag === 'owner.name')?.label).toBe('Opportunity owner');
    expect(LINE_PLACEHOLDERS[0]?.group).toBe('Opportunity lines');
    expect(ALIASES.price).toBe('opportunity.amount');
    expect(ALIASES.total).toBe('opportunity.total');
    expect(Object.values(ALIASES).join(' ')).not.toMatch(/deal/i);
  });
});

describe('describeTags', () => {
  it('marks fields the CRM fills and ones it does not', () => {
    expect(describeTags(['deal.title', 'opportunity.title', 'total', 'lines', 'typo.field', 'deal.title'])).toEqual([
      { tag: 'deal.title', known: true, label: 'Opportunity title' },
      { tag: 'opportunity.title', known: true, label: 'Opportunity title' },
      { tag: 'total', known: true, label: 'Total with tax' },
      { tag: 'lines', known: true, label: 'Opportunity lines' },
      { tag: 'typo.field', known: false, label: null },
    ]);
  });
});

describe('docx templates', () => {
  it('finds the fields of the starter template, all of them known', () => {
    const found = describeTags(inspectTemplate(starterTemplate()));
    expect(found.filter((f) => !f.known)).toEqual([]);
    expect(found.map((f) => f.tag)).toEqual(expect.arrayContaining(['deal.title', 'lines', 'line.total', 'deal.total', 'today']));
    expect(found.map((f) => f.tag).filter((t) => t.startsWith('discovery.') || t === 'deal.headline')).toEqual([]);
  });

  it('fills fields and repeats the lines row; unknown fields stay as written', () => {
    const tpl = buildDocx([{ text: 'For {{company.name}} ({{typo}})' }, { table: [['Item', 'Total'], ['{{#lines}}{{line.product}}', '{{line.total}}{{/lines}}']] }]);
    const out = renderTemplate(tpl, buildTemplateData(source()));
    // The second line has no product, so its first cell is empty (docxText skips empty paragraphs).
    expect(docxText(out.file)).toBe('For Acme d.o.o. ({{typo}})\nItem\nTotal\nStrategy\n€3,601.20\n€0');
    expect(out.file.length).toBeGreaterThan(0);
    expect(out.tags).toEqual(expect.arrayContaining(['company.name', 'typo', 'lines', 'line.product']));
  });

  it('a template saved before CD-362 still renders: the headline is the title, discovery notes are empty, nothing is flagged', () => {
    const tpl = buildDocx([{ text: '{{deal.headline}} | {{opportunity.headline}} | [{{discovery.need}}{{discovery.constraint}}{{discovery.decision_maker}}{{discovery.date}}{{need}}]' }]);
    const data = buildTemplateData(source());
    const out = renderTemplate(tpl, data);
    expect(docxText(out.file)).toBe('Brand refresh | Brand refresh | []');
    expect(missingFields(out.tags, data)).toEqual([]);
    expect(describeTags(out.tags).every((f) => f.known)).toBe(true);
  });

  it('rejects files that are not .docx, and broken merge fields', () => {
    expect(() => inspectTemplate(Buffer.from('%PDF-1.7 not a zip'))).toThrow(TemplateFileError);
    expect(() => inspectTemplate(buildDocx([{ text: '{{#lines}} never closed' }]))).toThrow(/merge field error/);
  });
});
