import type { BuyerRole, Channel, LostReason } from '../../../shared/database/schema';

/**
 * The records "Load sample data" creates (CD-68): a small, realistic set to explore the app with.
 * No figures of its own: amounts come from the deal lines, and Overview computes its metrics from
 * these records like from any others. Emails use example.com, which can't belong to anyone.
 */
export const SAMPLE_SOURCE = 'Sample data';

export const SAMPLE_PRODUCTS = [
  { key: 'workshop', name: 'Onboarding workshop', description: 'A day on site to set up the team', unit: 'day', unitPrice: '1200.00', quantity: '1.00', vatRate: '20', billingFrequency: 'one_time', billingCycles: null },
  { key: 'licence', name: 'Annual licence', description: 'One seat for a year', unit: 'seat', unitPrice: '4800.00', quantity: '1.00', vatRate: '20', billingFrequency: 'annually', billingCycles: 1 },
  { key: 'support', name: 'Support hours', description: 'Help after go-live', unit: 'hour', unitPrice: '90.00', quantity: '10.00', vatRate: '20', billingFrequency: 'one_time', billingCycles: null },
] as const;
export type SampleProductKey = (typeof SAMPLE_PRODUCTS)[number]['key'];

export const SAMPLE_COMPANIES = [
  { key: 'brightline', name: 'Brightline Studio', industry: 'Design agency', hq: 'Novi Sad', teamSize: '11–50 staff', domain: 'brightline.example.com' },
  { key: 'kestrel', name: 'Kestrel Logistics', industry: 'Logistics', hq: 'Belgrade', teamSize: '51–200 staff', domain: 'kestrel.example.com' },
  { key: 'orchard', name: 'Orchard Dental Group', industry: 'Healthcare', hq: 'Niš', teamSize: '11–50 staff', domain: 'orchard.example.com' },
  { key: 'tidewater', name: 'Tidewater Foods', industry: 'Food production', hq: 'Subotica', teamSize: '201–500 staff', domain: 'tidewater.example.com' },
] as const;
export type SampleCompanyKey = (typeof SAMPLE_COMPANIES)[number]['key'];

export const SAMPLE_CONTACTS: { key: string; company: SampleCompanyKey; fullName: string; jobTitle: string; email: string; phone: string; buyerRole: BuyerRole }[] = [
  { key: 'mila', company: 'brightline', fullName: 'Mila Petrović', jobTitle: 'Managing director', email: 'mila@brightline.example.com', phone: '+381 21 555 0142', buyerRole: 'Decision maker' },
  { key: 'stefan', company: 'kestrel', fullName: 'Stefan Ilić', jobTitle: 'Operations manager', email: 'stefan@kestrel.example.com', phone: '+381 11 555 0187', buyerRole: 'Champion' },
  { key: 'jelena', company: 'kestrel', fullName: 'Jelena Marković', jobTitle: 'CFO', email: 'jelena@kestrel.example.com', phone: '+381 11 555 0110', buyerRole: 'Economic buyer' },
  { key: 'nikola', company: 'orchard', fullName: 'Nikola Jovanović', jobTitle: 'Practice manager', email: 'nikola@orchard.example.com', phone: '+381 18 555 0163', buyerRole: 'Decision maker' },
  { key: 'ana', company: 'tidewater', fullName: 'Ana Kovač', jobTitle: 'Head of purchasing', email: 'ana@tidewater.example.com', phone: '+381 24 555 0129', buyerRole: 'Gatekeeper' },
];

/** Where a deal sits: an open stage by position (clamped to the funnel), or the won stage. */
export type SampleStage = { open: number } | 'won';

export interface SampleDeal {
  title: string;
  company: SampleCompanyKey;
  contact: string;
  /** Other people on the deal, besides the primary contact. */
  others?: string[];
  stage: SampleStage;
  lost?: { reason: LostReason; note: string };
  lines: { product: SampleProductKey; quantity: number }[];
  /** Days since the deal was created, and since the last contact. */
  ageDays: number;
  lastContactDays: number;
  /** Days from today; negative is in the past. */
  closeInDays: number;
  headline?: string;
  need?: string;
  activity?: { channel: Channel; title: string; detail: string; daysAgo: number };
  /** A task from the "New task" dialog, assigned to whoever loads the sample data. */
  task?: { label: string; dueInDays: number; channel: Channel };
}

export const SAMPLE_DEALS: SampleDeal[] = [
  {
    title: 'Brightline Studio · studio rollout',
    company: 'brightline',
    contact: 'mila',
    stage: { open: 0 },
    lines: [{ product: 'workshop', quantity: 1 }],
    ageDays: 2,
    lastContactDays: 2,
    closeInDays: 45,
    headline: 'Inbound from the website',
    task: { label: 'Book a discovery call with Mila', dueInDays: 1, channel: 'EM' },
  },
  {
    title: 'Kestrel Logistics · fleet licences',
    company: 'kestrel',
    contact: 'stefan',
    others: ['jelena'],
    stage: { open: 1 },
    lines: [
      { product: 'licence', quantity: 3 },
      { product: 'workshop', quantity: 2 },
    ],
    ageDays: 12,
    lastContactDays: 4,
    closeInDays: 30,
    headline: 'Dispatch team loses hours to spreadsheets',
    need: 'One place for routes, customers and follow-ups across three depots',
    activity: { channel: 'MT', title: 'Discovery call · 30 min', detail: 'Stefan walked through the dispatch process; Jelena joins the next call for budget.', daysAgo: 4 },
    task: { label: 'Send pricing for three depots', dueInDays: -1, channel: 'EM' },
  },
  {
    title: 'Orchard Dental Group · pilot',
    company: 'orchard',
    contact: 'nikola',
    stage: { open: 2 },
    lines: [
      { product: 'licence', quantity: 1 },
      { product: 'support', quantity: 10 },
    ],
    ageDays: 20,
    lastContactDays: 6,
    closeInDays: 14,
    activity: { channel: 'PH', title: 'Call with Nikola', detail: 'Pilot at one practice first; decision after four weeks.', daysAgo: 6 },
    task: { label: 'Call Nikola about the pilot scope', dueInDays: 0, channel: 'PH' },
  },
  {
    title: 'Tidewater Foods · annual licence',
    company: 'tidewater',
    contact: 'ana',
    stage: { open: 99 },
    lines: [{ product: 'licence', quantity: 5 }],
    ageDays: 34,
    lastContactDays: 3,
    closeInDays: 7,
    task: { label: 'Follow up on the contract draft', dueInDays: 3, channel: 'EM' },
  },
  {
    title: 'Brightline Studio · support hours',
    company: 'brightline',
    contact: 'mila',
    stage: 'won',
    lines: [{ product: 'support', quantity: 40 }],
    ageDays: 40,
    lastContactDays: 9,
    closeInDays: -9,
  },
  {
    title: 'Orchard Dental Group · second site',
    company: 'orchard',
    contact: 'nikola',
    stage: { open: 1 },
    lost: { reason: 'Timing', note: 'Revisit after the pilot at the first practice.' },
    lines: [{ product: 'licence', quantity: 1 }],
    ageDays: 25,
    lastContactDays: 15,
    closeInDays: -5,
  },
];
