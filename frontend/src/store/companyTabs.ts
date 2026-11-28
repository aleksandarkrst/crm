// The company page's KPI row and tabs (CD-534, boards C-Company and C-Company-Client, 28 Nov): the
// five figures over the tabs, the opportunities split into open, won and lost, the to-do and
// meeting rows. Pure (no React, no store imports), so it is unit-tested with Node's runner
// (test/companyTabs.test.ts).
import { ACTIVITY_WHAT, dayAgo } from './companyList.ts';
import type { CompanyStatus, Lead, LeadTask } from './types';

export type CompanyTab = 'details' | 'contacts' | 'opportunities' | 'meetings' | 'tasks' | 'projects' | 'history';
export const COMPANY_TABS: { key: CompanyTab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'opportunities', label: 'Opportunities' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'projects', label: 'Projects' },
  { key: 'history', label: 'History' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "12 Oct 2026" for an ISO instant on the workspace's calendar (three-letter months, as the boards write them). */
export function longDate(at: string, tz?: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    return `${part('day')} ${MONTHS[part('month') - 1]} ${part('year')}`;
  } catch {
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
}

export interface OppRow {
  id: string;
  name: string;
  /** The stage for an open one, "Won 14 Mar 2026", "Lost 20 Jun 2026". */
  line: string;
  /** "Closes 18 Dec" on an open one; the lost reason on a lost one; '' otherwise. */
  extra: string;
  ownerId: string | null;
  ownerName: string;
  valueNum: number;
}
export interface OppGroup {
  key: 'open' | 'won' | 'lost';
  title: 'Open' | 'Won' | 'Lost';
  rows: OppRow[];
  total: number;
}

/**
 * The company's opportunities split into open, won and lost (empty groups left out), each with its
 * rows and its total; `stageName` and `ownerName` are the page's own lookups.
 */
export function opportunityGroups(leads: Lead[], look: { stageName: (l: Lead) => string; ownerName: (l: Lead) => string; valueNum: (l: Lead) => number; tz?: string; dayLabel: (iso: string) => string }): OppGroup[] {
  const row = (l: Lead): OppRow => {
    const line = l.outcome === 'won' ? `Won${l.stageSince ? ' ' + longDate(l.stageSince, look.tz) : ''}` : l.outcome === 'lost' ? `Lost${l.lostAt ? ' ' + longDate(l.lostAt, look.tz) : ''}` : look.stageName(l);
    const extra = l.outcome === 'open' ? (l.closeDate ? `Closes ${look.dayLabel(l.closeDate)}` : '') : l.outcome === 'lost' ? (l.lostReason ?? '') : '';
    return { id: l.id, name: l.title?.trim() || l.company, line, extra, ownerId: l.ownerId ?? null, ownerName: look.ownerName(l), valueNum: look.valueNum(l) };
  };
  const groups: OppGroup[] = (
    [
      ['open', 'Open'],
      ['won', 'Won'],
      ['lost', 'Lost'],
    ] as const
  ).map(([key, title]) => {
    const rows = leads.filter((l) => l.outcome === key).map(row);
    return { key, title, rows, total: rows.reduce((a, r) => a + r.valueNum, 0) };
  });
  return groups.filter((g) => g.rows.length > 0);
}

/** "Win rate 67%, 2 won, 1 lost"; '' until something was won or lost. */
export function winRateLine(won: number, lost: number): string {
  if (won + lost === 0) return '';
  return `Win rate ${Math.round((100 * won) / (won + lost))}%, ${won} won, ${lost} lost`;
}

/** The Opportunities tab's empty state. */
export function opportunitiesEmpty(status: CompanyStatus, name: string, missing: number): { title: string; text: string } {
  if (status === 'lead') return { title: 'Leads cannot have opportunities yet', text: `Complete the ${missing === 1 ? '1 missing item' : `${missing} missing items`} in the banner above. ${name} then becomes an opportunity by itself.` };
  return { title: 'No opportunities yet', text: `Add the first opportunity for ${name}.` };
}

/** The KPI row's Open value and Lifetime value lines under the figures. */
export const openValueLine = (open: number): string => (open === 0 ? 'No open opportunities' : open === 1 ? '1 open opportunity' : `${open} open opportunities`);
export const lifetimeLine = (won: number, lost: number): string => (won + lost === 0 ? 'Nothing won yet' : `${won} won, ${lost} lost`);

/** The to-dos on the company's opportunities: open ones first by due date, then the done ones. */
export function companyTasks(tasks: LeadTask[], leadIds: readonly string[]): LeadTask[] {
  const ids = new Set(leadIds);
  return tasks.filter((t) => ids.has(t.leadId)).sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
}

/** "4 open, 1 late" for the Tasks tab; the KPI shows the open count and "N late" or "None late". */
export function taskSummary(tasks: readonly LeadTask[], today: string): { open: number; late: number; line: string; kpiSub: string } {
  const open = tasks.filter((t) => !t.done);
  const late = open.filter((t) => !!t.due && t.due < today).length;
  return { open: open.length, late, line: `${open.length} open${late ? `, ${late} late` : ''}`, kpiSub: late ? `${late} late` : 'None late' };
}

/** The Last activity KPI: the day and what it was ("Call", or the timeline entry's title when known). */
export function lastActivityKpi(last: { channel: string; at: string } | null | undefined, titles: { at?: string; title: string }[], day: (at: string) => string, today: string): { value: string; sub: string } {
  if (!last) return { value: 'None', sub: 'Nothing yet' };
  const hit = titles.find((t) => t.at && Math.abs(Date.parse(t.at) - Date.parse(last.at)) < 1000);
  const when = dayAgo(day(last.at), today);
  return { value: when.charAt(0).toUpperCase() + when.slice(1), sub: hit?.title ?? ACTIVITY_WHAT[last.channel] ?? 'Activity' };
}

/** The Next meeting KPI from the planned meetings still to come, earliest first. */
export function nextMeetingKpi(planned: { title: string; startsAt: string }[], now: number, day: (at: string) => string, today: string): { value: string; sub: string } {
  const next = planned.filter((m) => Date.parse(m.startsAt) >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (!next) return { value: 'None', sub: 'Nothing planned yet' };
  const d = day(next.startsAt);
  return { value: d === today ? 'Today' : `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`, sub: next.title };
}
