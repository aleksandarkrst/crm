/**
 * Reference data from the Mini CRM v2 design (pick lists, labels, sales scripts) and the store's
 * starting state. No demo records: deals, funnels and products come from the API (CD-103).
 */
import type { Filters, State } from './types';

export const ACTIVITIES = ['Qualify & research', 'Personalized email', 'LinkedIn touch', 'WhatsApp check-in', 'Discovery call', 'Discovery workshop', 'Multi-thread to stakeholders', 'Send proposal + walkthrough', 'Procurement follow-up', 'Negotiation call', 'Kickoff scheduling'];
export const CHANNELS = ['RS', 'EM', 'LI', 'WA', 'MT'] as const;
export const CHANNEL_LABELS: Record<string, string> = { RS: 'Research task', EM: 'Email', LI: 'LinkedIn message', WA: 'WhatsApp message', MT: 'Meeting', PH: 'Call', NT: 'Note' };
export const DOCS = ['None', 'Proposal', 'Quote', 'Contract', 'Invoice'];
export const BUYER_ROLES = ['Decision maker', 'Economic buyer', 'Champion', 'Influencer', 'Gatekeeper', 'End user'];
/** Custom field types (CD-15) and how they are labelled. */
export const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Single select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
] as const;
/** Currencies offered for the workspace, deals and products (ISO 4217). */
export const CURRENCIES = [
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'RSD', label: 'RSD (дин)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'CHF', label: 'CHF (Fr.)' },
];
/** The currency options, plus `current` when it isn't one of them (set through the API). */
export const currencyOptions = (current?: string) => (current && !CURRENCIES.some((c) => c.value === current) ? [...CURRENCIES, { value: current, label: current }] : CURRENCIES);
export const SOURCES = ['Inbound web form', 'Referral', 'Outbound LinkedIn', 'Conference', 'Instagram DM', 'Trade fair'];
export const INDUSTRIES = ['Architecture', 'Banking', 'Food & beverage', 'Freight & logistics', 'Furniture retail', 'Hospitality', 'Pharmaceuticals', 'Renewable energy', 'Wine', 'Other'];
export const TEAM_SIZES = ['1–10 staff', '11–50 staff', '51–200 staff', '201–1,000 staff', '1,000+ staff'];
/**
 * Overview date filter: ranges over each deal's closing date (calendar months; quarters and years
 * of the workspace's fiscal year, see closeRangeOf). The first entry means "no date filter" and is
 * the only one that includes deals without a closing date. These are the filter values; see
 * dateRangeLabel for how they read.
 */
export const DATE_RANGES = ['Any closing date', 'Closing in 30 days', 'Closing this month', 'Closing this quarter', 'Closing next quarter', 'Closing this year', 'Closing date passed'];
/** How a date filter reads: "Closing this fiscal quarter" when the fiscal year doesn't start in January. */
export const dateRangeLabel = (value: string, fiscalMonth: number): string =>
  fiscalMonth === 1 ? value : value.replace(/ (quarter|year)$/, ' fiscal $1');
export const VALUE_BANDS = ['Value', 'Under €25k', '€25k–€100k', 'Over €100k'];
/** How a value band reads in the workspace currency ("Under $25k"); the values above stay the filter keys. */
export const valueBandLabel = (value: string, symbol: string): string => value.split('€').join(symbol);
export const TEAM_ROLES = ['Owner', 'Admin', 'Member'] as const;

/** Playbook rules (design props). */
export const AUTO_GENERATE_DOCS = true;
export const GATE_STAGE_ADVANCE = true;

export const SCRIPTS: Record<string, string> = {
  'Personalized email': 'Subject: {{company}} — the 3 things we noticed\n\nHi {{first}}, I went through your last two campaigns before writing this. Two things stood out and one looks like a quick win. Worth 20 minutes next week?',
  'LinkedIn touch': 'Hi {{first}} — saw the {{industry}} push you launched. We ran the same play for two firms your size; happy to share what we\'d do differently. Open to a short call?',
  'Discovery call': 'Open: what does a win look like 6 months from now?\nThen: current owner of brand, current spend, what has failed before.\nClose: confirm decision process and book the proposal walkthrough.',
  'Discovery workshop': '90 minutes, 3 stakeholders minimum. Agenda: current state, brand gaps, measurement, procurement path. Leave with a named sponsor and a signing timeline.',
  'Multi-thread to stakeholders': 'Hi {{first}} — you mentioned marketing and procurement both weigh in. I\'ll send a one-pager each of them can read in two minutes. Who else should see it?',
  'Send proposal + walkthrough': 'Hi {{first}}, the proposal is attached and it follows exactly what we agreed in discovery. I\'d rather walk you through page 4 than have you read it cold — 20 minutes Thursday?',
  'Procurement follow-up': 'Hi {{first}}, checking where the proposal sits with procurement. If it helps, I can send our standard terms and insurance certificate ahead of review.',
  'Negotiation call': 'Anchor on scope, not price. Offer phasing before discount. Confirm start date on the call.',
  'WhatsApp check-in': 'Hi {{first}}, quick one — still aiming to decide this month? Happy to hold the team\'s start date.',
  'Qualify & research': 'Check: size, category, existing agency, budget signals, decision maker. Score before you touch them.',
  'Kickoff scheduling': 'Hi {{first}}, congratulations — sending three kickoff slots and the onboarding brief.',
};

export const OBJECTIONS = [
  { q: '“It\'s more than we budgeted.”', a: 'Phase it. Offer stage one only, same price per stage, decision on stage two after the first readout.' },
  { q: '“We need to think about it.”', a: 'Ask what specifically is unresolved, then name the next step and date on the call. Never leave without a date.' },
  { q: '“We already have an agency.”', a: 'Position as the gap, not the replacement: one workstream your incumbent is not covering.' },
];

export const CHAMP = [
  { key: 'C', name: 'Challenges', prompt: 'Is there a named problem we are proven at solving?' },
  { key: 'H', name: 'Authority', prompt: 'Are we talking to the person who signs, or a path to them?' },
  { key: 'M', name: 'Money', prompt: 'Is there a budget range, and does it clear our floor?' },
  { key: 'P', name: 'Prioritisation', prompt: 'Is there a date that forces a decision?' },
] as const;
export const CHAMP_LEVELS = [{ label: 'None', v: 0 }, { label: 'Weak', v: 8 }, { label: 'Partial', v: 17 }, { label: 'Strong', v: 25 }];

/** Pipeline board views: lost deals are hidden by default. */
export const LOST_VIEWS = ['Open & won deals', 'Include lost deals', 'Lost deals only'] as const;
export const DEFAULT_FILTERS: Filters = { audience: 'Audience', owner: 'Salesperson', dates: 'Any closing date', source: 'Source', stage: 'Stage', industry: 'Industry', stalled: 'Status', band: 'Value', lost: LOST_VIEWS[0] };

export function initialState(): State {
  return {
    // Business records start empty: the workspace's own come from the API before any screen
    // renders (store/remote.ts), so nothing here can ever show as someone's data (CD-103).
    funnels: {},
    segment: '',
    leads: [],
    extraCompanies: [],
    extraPeople: [],
    links: {},
    catalog: [],
    dealLines: {},
    champ: {},
    tasks: {},
    extraTodos: {},
    extraTodoIds: {},
    leadTasks: [],
    log: {},
    versions: {},
    changedAt: {},
    team: [], // loaded from the API
    integrations: [
      { id: 'i1', name: 'Gmail', desc: 'Sync email threads onto lead timelines', on: true },
      { id: 'i2', name: 'Google Calendar', desc: 'Push discovery calls and follow-ups', on: true },
      { id: 'i3', name: 'WhatsApp Business', desc: 'Log WhatsApp check-ins as activity', on: false },
      { id: 'i4', name: 'LinkedIn', desc: 'Capture LinkedIn touches from Sales Navigator', on: false },
      { id: 'i5', name: 'Slack', desc: 'Post won deals to #sales', on: true },
      { id: 'i6', name: 'Google Drive', desc: 'Store generated documents', on: true },
    ],
    // Replaced by the saved custom fields and values when the workspace loads (store/remote.ts).
    customFields: [],
    customValues: { deal: {}, company: {}, contact: {} },
    // Replaced by the saved settings when the workspace loads (store/remote.ts).
    workspace: { name: '', currency: 'EUR', timezone: 'Europe/Belgrade', fiscalMonth: 1 },
    profile: { name: '', title: '', email: '', phone: '', language: 'en', dateFormat: 'DD.MM.YYYY', startPage: 'pipeline', defaultFunnelId: '', digest: true, dealAssigned: true },
    onboarding: null,
    bonusRules: null,
    bonusTrigger: 'On contract signed',
    filters: { ...DEFAULT_FILTERS },
    toast: '',
    templates: null,
    dealDocs: {},

    genOpen: false,
    genLead: null,
    genDocId: null,
    docOpen: false,
    docLeadId: null,
    showMerge: true,
    sent: false,
    newLeadOpen: false,
    newLeadType: '',
    taskOpen: false,
    taskLeadId: '',
    taskEditId: null,
    contactOpen: false,
    contactCompany: '',
    contactCompanyId: null,
    newContact: { name: '', role: '', email: '', phone: '', linkedin: '', buyerRole: 'Influencer', notes: '' },
    personaOpen: false,
    personaBase: '',
    templateOpen: false,
    templateType: 'Proposal',

    fieldOpen: false,
    newField: { label: '', type: 'text', entity: 'deal', required: false, options: '' },
    productOpen: false,
    productEditId: null,
    newLeadCompanyId: null,
    newLeadContactId: null,
    paletteOpen: false,
    dealProductsId: null,
    drill: null,
    lostLeadId: null,
    stageHistory: null,
  };
}
