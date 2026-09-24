import type { Channel } from '../../../shared/database/schema';

export interface StageTemplate {
  key: string;
  name: string;
  activity: string;
  channel: Channel;
  documentOnEntry: string | null;
  winProbability: number;
  checklist: string[];
}

export interface FunnelTemplate {
  key: string;
  label: string;
  note: string;
  stages: StageTemplate[];
}

const stage = (
  key: string,
  name: string,
  activity: string,
  channel: Channel,
  documentOnEntry: string | null,
  winProbability: number,
  checklist: string[],
): StageTemplate => ({ key, name, activity, channel, documentOnEntry, winProbability, checklist });

/** Seeded for every new tenant. Mirrors the two personas in the Mini CRM v2 design. */
export const DEFAULT_FUNNELS: FunnelTemplate[] = [
  {
    key: 'smb',
    label: 'SMB — CEO decides',
    note: 'One decision maker. Short funnel, no procurement loop, proposal goes out right after the discovery call.',
    stages: [
      stage('new', 'New deal', 'Qualify & research', 'RS', null, 10, ['Fit score entered', 'Website + socials reviewed']),
      stage('touch', 'First touch', 'Personalized email', 'EM', null, 15, ['Email sent', 'Reply or second touch logged']),
      stage('discovery', 'Discovery call', 'Discovery call', 'MT', null, 30, ['Goals captured', 'Budget range confirmed']),
      stage('proposal', 'Proposal', 'Send proposal + walkthrough', 'EM', 'Proposal', 50, ['Proposal sent', 'Walkthrough booked']),
      stage('negotiation', 'Negotiation', 'Negotiation call', 'MT', null, 75, ['Scope agreed', 'Start date agreed']),
      stage('won', 'Won', 'Kickoff scheduling', 'MT', null, 100, ['Kickoff booked']),
    ],
  },
  {
    key: 'ent',
    label: 'Enterprise — buying committee',
    note: 'Multiple approvers. Extra stages for stakeholder mapping and procurement review; the proposal is written for people who were not in the room.',
    stages: [
      stage('new', 'New deal', 'Qualify & research', 'RS', null, 10, ['Fit score entered', 'Account mapped']),
      stage('qualify', 'Qualification', 'LinkedIn touch', 'LI', null, 20, ['Mandate confirmed', 'Budget owner named']),
      stage('discovery', 'Discovery workshop', 'Discovery workshop', 'MT', null, 30, ['3+ stakeholders attended', 'Sponsor named']),
      stage('stakeholders', 'Stakeholder map', 'Multi-thread to stakeholders', 'LI', null, 40, ['Committee mapped', 'One-pager sent to each']),
      stage('proposal', 'Proposal', 'Send proposal + walkthrough', 'EM', 'Proposal', 50, ['Proposal sent', 'Walkthrough booked', 'Sponsor aligned']),
      stage('review', 'Procurement review', 'Procurement follow-up', 'EM', null, 65, ['Terms submitted', 'Legal contact engaged']),
      stage('negotiation', 'Negotiation', 'Negotiation call', 'MT', null, 75, ['Scope agreed', 'Signing path confirmed']),
      stage('won', 'Won', 'Kickoff scheduling', 'MT', null, 100, ['Kickoff booked']),
    ],
  },
];

/** A new funnel that doesn't copy another one starts with these (CD-10). */
export const BLANK_FUNNEL_STAGES: StageTemplate[] = [
  stage('new', 'New deal', 'Qualify & research', 'RS', null, 10, ['Fit score entered']),
  stage('discovery', 'Discovery', 'Discovery call', 'MT', null, 30, ['Needs captured']),
  stage('proposal', 'Proposal', 'Send proposal + walkthrough', 'EM', 'Proposal', 50, ['Proposal sent']),
  stage('won', 'Won', 'Kickoff scheduling', 'MT', null, 100, ['Kickoff booked']),
];
