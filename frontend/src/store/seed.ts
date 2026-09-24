/**
 * Reference data and demo records from the Mini CRM v2 design. The UI runs on these until each
 * screen is switched to the API (see src/store/README.md).
 */
import type { CatalogItem, Filters, Funnel, Lead, LogEntry, SegKey, Stage, State } from './types';

export const ACTIVITIES = ['Qualify & research', 'Personalized email', 'LinkedIn touch', 'WhatsApp check-in', 'Discovery call', 'Discovery workshop', 'Multi-thread to stakeholders', 'Send proposal + walkthrough', 'Procurement follow-up', 'Negotiation call', 'Kickoff scheduling'];
export const CHANNELS = ['RS', 'EM', 'LI', 'WA', 'MT'] as const;
export const CHANNEL_LABELS: Record<string, string> = { RS: 'Research task', EM: 'Email', LI: 'LinkedIn message', WA: 'WhatsApp message', MT: 'Meeting', PH: 'Call', NT: 'Note' };
export const DOCS = ['None', 'Proposal', 'Quote', 'Contract', 'Invoice'];
export const OWNERS = ['Mila Jovanović', 'Stefan Popović', 'Nina Đorđević'];
export const DOC_TYPES = ['Proposal', 'Quote', 'Contract', 'NDA', 'Onboarding brief', 'Invoice'];
export const BUYER_ROLES = ['Decision maker', 'Economic buyer', 'Champion', 'Influencer', 'Gatekeeper', 'End user'];
export const FIELD_TYPES = ['Text', 'Number', 'Currency', 'Date', 'Dropdown', 'Checkbox'];
export const SOURCES = ['Inbound web form', 'Referral', 'Outbound LinkedIn', 'Conference', 'Instagram DM', 'Trade fair'];
export const INDUSTRIES = ['Architecture', 'Banking', 'Food & beverage', 'Freight & logistics', 'Furniture retail', 'Hospitality', 'Pharmaceuticals', 'Renewable energy', 'Wine', 'Other'];
export const TEAM_SIZES = ['1–10 staff', '11–50 staff', '51–200 staff', '201–1,000 staff', '1,000+ staff'];
export const DATE_RANGES = ['Last 30 days', 'Last 7 days', 'This quarter', 'Year to date', 'All time'];
export const VALUE_BANDS = ['Value', 'Under €25k', '€25k–€100k', 'Over €100k'];
export const PARAM_SOURCES: Record<string, string> = { '{{company}}': 'Lead · company', '{{contact_name}}': 'Lead · primary contact', '{{price}}': 'Lead · deal value' };
export const PRODUCT_TYPES = ['Service', 'Product'];
export const BILLING_KINDS = ['One-off', 'Monthly', 'Yearly', 'Hourly'];
export const SCHEDULE_TYPES = ['Full amount on one date', 'Custom milestones', 'Equal monthly instalments', 'Recurring subscription'];
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

export const CATALOG: CatalogItem[] = [
  { id: 'c1', name: 'Brand identity sprint', type: 'Service', kind: 'One-off', price: 6500, vat: 20 },
  { id: 'c2', name: 'Website design & build', type: 'Service', kind: 'One-off', price: 14000, vat: 20 },
  { id: 'c3', name: 'Content retainer', type: 'Service', kind: 'Monthly', price: 1800, vat: 20 },
  { id: 'c4', name: 'Campaign management', type: 'Service', kind: 'Monthly', price: 2400, vat: 20 },
  { id: 'c5', name: 'Senior consulting', type: 'Service', kind: 'Hourly', price: 95, vat: 20 },
  { id: 'c6', name: 'Cadence CRM licence', type: 'Product', kind: 'Yearly', price: 1200, vat: 20 },
  { id: 'c7', name: 'Analytics dashboard', type: 'Product', kind: 'One-off', price: 3200, vat: 20 },
  { id: 'c8', name: 'Training workshop', type: 'Service', kind: 'Hourly', price: 120, vat: 20 },
];

export const CHAMP = [
  { key: 'C', name: 'Challenges', prompt: 'Is there a named problem we are proven at solving?' },
  { key: 'H', name: 'Authority', prompt: 'Are we talking to the person who signs, or a path to them?' },
  { key: 'M', name: 'Money', prompt: 'Is there a budget range, and does it clear our floor?' },
  { key: 'P', name: 'Prioritisation', prompt: 'Is there a date that forces a decision?' },
] as const;
export const CHAMP_LEVELS = [{ label: 'None', v: 0 }, { label: 'Weak', v: 8 }, { label: 'Partial', v: 17 }, { label: 'Strong', v: 25 }];

const DEFAULT_PROB: Record<string, number> = { new: 10, touch: 15, qualify: 20, discovery: 30, stakeholders: 40, proposal: 50, review: 65, negotiation: 75, won: 100 };
export function mkStage(id: string, name: string, activity: string, channel: Stage['channel'], doc: string, checklist: string[]): Stage {
  return { id, name, activity, channel, doc, checklist, prob: DEFAULT_PROB[id] ?? 25, won: id === 'won' };
}

export const BASE_FUNNELS: Record<SegKey, Funnel> = {
  smb: {
    label: 'SMB — CEO decides',
    note: 'One decision maker. Short funnel, no procurement loop, proposal goes out right after the discovery call.',
    stages: [
      mkStage('new', 'New deal', 'Qualify & research', 'RS', 'None', ['Fit score entered', 'Website + socials reviewed']),
      mkStage('touch', 'First touch', 'Personalized email', 'EM', 'None', ['Email sent', 'Reply or second touch logged']),
      mkStage('discovery', 'Discovery call', 'Discovery call', 'MT', 'None', ['Goals captured', 'Budget range confirmed']),
      mkStage('proposal', 'Proposal', 'Send proposal + walkthrough', 'EM', 'Proposal', ['Proposal sent', 'Walkthrough booked']),
      mkStage('negotiation', 'Negotiation', 'Negotiation call', 'MT', 'None', ['Scope agreed', 'Start date agreed']),
      mkStage('won', 'Won', 'Kickoff scheduling', 'MT', 'None', ['Kickoff booked']),
    ],
  },
  ent: {
    label: 'Enterprise — buying committee',
    note: 'Multiple approvers. Extra stages for stakeholder mapping and procurement review; the proposal is written for people who were not in the room.',
    stages: [
      mkStage('new', 'New deal', 'Qualify & research', 'RS', 'None', ['Fit score entered', 'Account mapped']),
      mkStage('qualify', 'Qualification', 'LinkedIn touch', 'LI', 'None', ['Mandate confirmed', 'Budget owner named']),
      mkStage('discovery', 'Discovery workshop', 'Discovery workshop', 'MT', 'None', ['3+ stakeholders attended', 'Sponsor named']),
      mkStage('stakeholders', 'Stakeholder map', 'Multi-thread to stakeholders', 'LI', 'None', ['Committee mapped', 'One-pager sent to each']),
      mkStage('proposal', 'Proposal', 'Send proposal + walkthrough', 'EM', 'Proposal', ['Proposal sent', 'Walkthrough booked', 'Sponsor aligned']),
      mkStage('review', 'Procurement review', 'Procurement follow-up', 'EM', 'None', ['Terms submitted', 'Legal contact engaged']),
      mkStage('negotiation', 'Negotiation', 'Negotiation call', 'MT', 'None', ['Scope agreed', 'Signing path confirmed']),
      mkStage('won', 'Won', 'Kickoff scheduling', 'MT', 'None', ['Kickoff booked']),
    ],
  },
};

export const LEADS: Lead[] = [
  { id: 'l1', company: 'Bellhaus Interiors', contact: 'Ana Marković', role: 'Founder & CEO', initials: 'AM', email: 'ana@bellhaus.rs', phone: '+381 63 118 204', segment: 'smb', stage: 'touch', value: '€14,000', score: 82, stall: 1, industry: 'Furniture retail', hq: 'Novi Sad', size: '11–50 staff', source: 'Inbound web form', need: 'a brand refresh before the spring showroom launch, plus a PR push in design press.', constraint: 'the showroom opens in 14 weeks', decisionMaker: 'you as founder', discoveryDate: '12 Sep', headline: 'A brand that carries the new showroom', lines: [['Brand refresh & guidelines', '€8,000'], ['Launch PR programme', '€4,500'], ['Photography direction', '€1,500']], total: '€14,000' },
  { id: 'l2', company: 'Nordvik Logistics', contact: 'Petar Ilić', role: 'Marketing Director', initials: 'PI', email: 'p.ilic@nordvik.com', phone: '+381 11 402 771', segment: 'ent', stage: 'discovery', value: '€62,000', score: 74, stall: 6, industry: 'Freight & logistics', hq: 'Belgrade', size: '1,000+ staff', source: 'Referral', need: 'a repositioning across six markets with one message the sales team can actually use.', constraint: 'procurement requires three approvals', decisionMaker: 'the CMO with CFO sign-off', discoveryDate: '03 Sep', headline: 'One story across six markets', lines: [['Positioning & messaging', '€24,000'], ['Market rollout toolkit', '€21,000'], ['Sales enablement programme', '€17,000']], total: '€62,000' },
  { id: 'l3', company: 'Ferma Organik', contact: 'Jelena Pavlović', role: 'Owner', initials: 'JP', email: 'jelena@fermaorganik.rs', phone: '+381 64 255 190', segment: 'smb', stage: 'discovery', value: '€9,500', score: 68, stall: 2, industry: 'Food & beverage', hq: 'Šabac', size: '11–50 staff', source: 'Instagram DM', need: 'packaging that survives the shelf next to imported brands, and a retail PR story.', constraint: 'listing deadline with two chains in November', decisionMaker: 'you as owner', discoveryDate: '15 Sep', headline: 'Packaging that wins the shelf', lines: [['Packaging system', '€6,000'], ['Retail launch PR', '€3,500']], total: '€9,500' },
  { id: 'l4', company: 'Adriatic Bank', contact: 'Marko Simić', role: 'Head of Brand', initials: 'MS', email: 'marko.simic@adriatic.bank', phone: '+381 11 330 550', segment: 'ent', stage: 'stakeholders', value: '€145,000', score: 91, stall: 3, industry: 'Banking', hq: 'Belgrade', size: '1,000+ staff', source: 'Outbound LinkedIn', need: 'a brand platform for the retail arm and a PR reset after last year\'s coverage.', constraint: 'regulatory review of all public messaging', decisionMaker: 'a committee of brand, retail and compliance', discoveryDate: '28 Aug', headline: 'Rebuilding trust in retail banking', lines: [['Brand platform', '€58,000'], ['Campaign development', '€49,000'], ['PR & reputation programme', '€38,000']], total: '€145,000' },
  { id: 'l5', company: 'Voltek Energy', contact: 'Ivana Radić', role: 'Communications Lead', initials: 'IR', email: 'i.radic@voltek.eu', phone: '+381 21 660 118', segment: 'ent', stage: 'proposal', value: '€78,000', score: 79, stall: 1, industry: 'Renewable energy', hq: 'Novi Sad', size: '201–1,000 staff', source: 'Conference', need: 'an ESG communications programme that holds up with investors and local press at once.', constraint: 'investor day in March', decisionMaker: 'the CEO with board visibility', discoveryDate: '05 Sep', headline: 'An ESG story investors can verify', lines: [['Communications strategy', '€29,000'], ['Investor narrative & materials', '€27,000'], ['Local press programme', '€22,000']], total: '€78,000', docs: [{ name: 'Proposal — ESG communications', state: 'sent', meta: 'v1 · generated 16 Sep · viewed 4 times' }] },
  { id: 'l6', company: 'Studio Kap', contact: 'Nikola Đurić', role: 'Managing Partner', initials: 'ND', email: 'nikola@studiokap.rs', phone: '+381 62 448 021', segment: 'smb', stage: 'new', value: '€6,800', score: 54, stall: 0, industry: 'Architecture', hq: 'Belgrade', size: '1–10 staff', source: 'Inbound web form', need: 'visibility in architecture press and a portfolio site that converts enquiries.', constraint: 'two-person marketing capacity', decisionMaker: 'you and your partner', discoveryDate: '—', headline: 'Press and portfolio, working together', lines: [['Press programme', '€4,300'], ['Portfolio narrative', '€2,500']], total: '€6,800' },
  { id: 'l7', company: 'Meridian Pharma', contact: 'Sofija Nikolić', role: 'Brand Manager', initials: 'SN', email: 's.nikolic@meridian.pharma', phone: '+381 11 771 004', segment: 'ent', stage: 'negotiation', value: '€96,000', score: 85, stall: 2, industry: 'Pharmaceuticals', hq: 'Belgrade', size: '1,000+ staff', source: 'Referral', need: 'a patient-facing campaign that clears medical and legal review without losing its edge.', constraint: 'medical review on every asset', decisionMaker: 'brand, medical affairs and legal', discoveryDate: '22 Aug', headline: 'A campaign that clears review', lines: [['Campaign platform', '€41,000'], ['Asset production', '€35,000'], ['Review & compliance workflow', '€20,000']], total: '€96,000', docs: [{ name: 'Proposal — patient campaign', state: 'signed', meta: 'v2 · generated 02 Sep · signed 17 Sep' }] },
  { id: 'l8', company: 'Hotel Sava', contact: 'Dragan Kostić', role: 'General Manager', initials: 'DK', email: 'gm@hotelsava.rs', phone: '+381 11 260 400', segment: 'smb', stage: 'proposal', value: '€22,000', score: 77, stall: 4, industry: 'Hospitality', hq: 'Belgrade', size: '51–200 staff', source: 'Inbound web form', need: 'direct bookings over OTA dependence, and a repositioning for the renovated wing.', constraint: 'renovation reopens in June', decisionMaker: 'you with the owner group', discoveryDate: '09 Sep', headline: 'Direct bookings, better guests', lines: [['Repositioning', '€11,000'], ['Direct booking campaign', '€8,000'], ['PR for reopening', '€3,000']], total: '€22,000', docs: [{ name: 'Proposal — direct bookings', state: 'draft', meta: 'v1 · generated 18 Sep · not sent' }] },
  { id: 'l9', company: 'Kalemi Wines', contact: 'Teodora Vuković', role: 'Export Manager', initials: 'TV', email: 'teodora@kalemi.rs', phone: '+381 63 900 712', segment: 'smb', stage: 'won', value: '€18,500', score: 88, stall: 0, industry: 'Wine', hq: 'Vršac', size: '11–50 staff', source: 'Trade fair', need: 'an export-ready brand story for German and Austrian distributors.', constraint: 'distributor meetings in February', decisionMaker: 'you and the owner', discoveryDate: '18 Aug', headline: 'Export-ready, distributor-first', lines: [['Export brand story', '€11,500'], ['Trade materials', '€7,000']], total: '€18,500', docs: [{ name: 'Proposal — export brand', state: 'signed', meta: 'v1 · generated 26 Aug · signed 08 Sep' }] },
];

export const DEFAULT_TIMELINE: LogEntry[] = [
  { date: '18 Sep', channel: 'EM', title: 'Proposal sent', detail: 'Generated from Proposal template v4, 14 fields merged from this record.' },
  { date: '15 Sep', channel: 'MT', title: 'Discovery call · 38 min', detail: 'Goals, budget range and decision process captured against the stage checklist.' },
  { date: '11 Sep', channel: 'LI', title: 'LinkedIn touch', detail: 'Stage script used as sent, no edits.' },
  { date: '09 Sep', channel: 'RS', title: 'Lead created', detail: 'Inbound web form. Fit score 77 — funnel assigned automatically.' },
];

export const ROADMAP_STATUSES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'planned', name: 'Planned' },
  { id: 'progress', name: 'In progress' },
  { id: 'done', name: 'Done' },
];

export const DEFAULT_FILTERS: Filters = { audience: 'Audience', owner: 'Salesperson', dates: 'Last 30 days', source: 'Source', stage: 'Stage', industry: 'Industry', stalled: 'Status', band: 'Value' };

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function initialState(): State {
  return {
    funnels: clone(BASE_FUNNELS),
    segment: 'smb',
    leads: clone(LEADS),
    extraCompanies: [],
    extraPeople: [],
    links: {},
    catalog: CATALOG.map((c) => ({ ...c })),
    dealLines: {},
    champ: {},
    tasks: {},
    extraTodos: {},
    extraTodoIds: {},
    leadTasks: [],
    log: {},
    roadmapItems: [
      { id: 'rm1', title: 'Automated proposal follow-up sequence', status: 'backlog' },
      { id: 'rm2', title: 'Client reporting templates', status: 'backlog' },
      { id: 'rm3', title: 'Retainer renewal reminders', status: 'planned' },
      { id: 'rm4', title: 'Contact enrichment from email', status: 'progress' },
      { id: 'rm5', title: 'Two-funnel pipeline split', status: 'done' },
    ],
    team: [], // loaded from the API
    notifs: [
      { id: 'n1', label: 'Stalled lead nudges', desc: 'Daily digest of leads with no contact for 4+ days', on: true },
      { id: 'n2', label: 'Task reminders', desc: 'Morning summary of tasks due today', on: true },
      { id: 'n3', label: 'Document activity', desc: 'Alert when a proposal or contract is opened or signed', on: true },
      { id: 'n4', label: 'Weekly pipeline report', desc: 'Monday email with stage conversion and open value', on: false },
    ],
    integrations: [
      { id: 'i1', name: 'Gmail', desc: 'Sync email threads onto lead timelines', on: true },
      { id: 'i2', name: 'Google Calendar', desc: 'Push discovery calls and follow-ups', on: true },
      { id: 'i3', name: 'WhatsApp Business', desc: 'Log WhatsApp check-ins as activity', on: false },
      { id: 'i4', name: 'LinkedIn', desc: 'Capture LinkedIn touches from Sales Navigator', on: false },
      { id: 'i5', name: 'Slack', desc: 'Post won deals to #sales', on: true },
      { id: 'i6', name: 'Google Drive', desc: 'Store generated documents', on: true },
    ],
    fields: [
      { id: 'f1', label: 'Industry', type: 'Text', entity: 'Leads', required: true, system: true },
      { id: 'f2', label: 'HQ', type: 'Text', entity: 'Leads', required: false, system: true },
      { id: 'f3', label: 'Team size', type: 'Number', entity: 'Leads', required: false, system: true },
      { id: 'f4', label: 'Deal value', type: 'Currency', entity: 'Leads', required: true, system: true },
      { id: 'f5', label: 'Source', type: 'Dropdown', entity: 'Leads', required: true, system: true },
      { id: 'f6', label: 'Renewal date', type: 'Date', entity: 'Leads', required: false, system: false },
      { id: 'f7', label: 'Role', type: 'Text', entity: 'Contacts', required: true, system: true },
      { id: 'f8', label: 'Email', type: 'Text', entity: 'Contacts', required: true, system: true },
      { id: 'f9', label: 'Phone', type: 'Text', entity: 'Contacts', required: false, system: true },
      { id: 'f10', label: 'LinkedIn', type: 'Text', entity: 'Contacts', required: false, system: true },
      { id: 'f11', label: 'Role in the decision', type: 'Dropdown', entity: 'Contacts', required: true, system: true },
      { id: 'f12', label: 'Company', type: 'Dropdown', entity: 'Contacts', required: true, system: true },
      { id: 'f13', label: 'Company', type: 'Dropdown', entity: 'Leads', required: true, system: true },
      { id: 'f14', label: 'Contacts', type: 'Dropdown', entity: 'Leads', required: true, system: true },
      { id: 'f15', label: 'Closing date', type: 'Date', entity: 'Leads', required: false, system: true },
      { id: 'f16', label: 'Funnel', type: 'Dropdown', entity: 'Leads', required: true, system: true },
    ].map((f) => ({ ...f, entity: f.entity as 'Leads' | 'Contacts', visible: true })),
    // Replaced by the saved settings when the workspace loads (store/remote.ts).
    workspace: { name: '', currency: 'EUR', timezone: 'Europe/Belgrade', fiscalMonth: 1 },
    profile: { name: '', title: '', email: '', phone: '', language: 'en', dateFormat: 'DD.MM.YYYY', startPage: 'pipeline', defaultFunnelId: '', digest: true },
    bonusRules: {},
    filters: { ...DEFAULT_FILTERS },
    toast: '',

    genOpen: false,
    genLead: null,
    genStep: 0,
    docOpen: false,
    docLeadId: null,
    showMerge: true,
    sent: false,
    newLeadOpen: false,
    newLeadType: 'smb',
    taskOpen: false,
    taskLeadId: '',
    contactOpen: false,
    contactCompany: 'Bellhaus Interiors',
    newContact: { name: '', role: '', email: '', phone: '', linkedin: '', buyerRole: 'Influencer' },
    personaOpen: false,
    personaBase: 'smb',
    templateOpen: false,
    templateType: 'Proposal',
    templateFile: null,
    fieldOpen: false,
    newField: { label: '', type: 'Text', entity: 'Leads', required: false },
    productOpen: false,
    newProduct: { name: '', type: 'Service', kind: 'One-off', price: '', vat: '20' },
    drill: null,
  };
}
