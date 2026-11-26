// The company page's History (CD-534, board C-Company): one list of the company's field changes,
// its contacts coming and going, its status changes and the activity on its opportunities, newest
// first, each as one sentence ("Nikola Kostić changed Street from empty to Industrijska 2") with the
// date and time under it; four rows, then "Show N more". Pure (no React, no store imports), so it is
// unit-tested with Node's runner (test/companyHistory.test.ts).
import type { ApiHistoryEntry } from '../lib/api';
import type { LogEntry } from './types';

/** One row of the list. */
export interface HistoryRow {
  key: string;
  /** ISO time; entries just made (no time yet) sort on top. */
  at: string;
  /** Who did it; null for the system. */
  actor: string | null;
  text: string;
}

/** How the page names a company field (the API's field names). */
export const COMPANY_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  pib: 'PIB',
  mb: 'MB',
  address: 'Street',
  city: 'City',
  postalCode: 'Postal code',
  activityCode: 'Activity code',
  industry: 'Industry',
  ownershipType: 'Ownership',
  ownerUserId: 'Company owner',
  source: 'Source',
  hq: 'HQ',
  teamSize: 'Team size',
  domain: 'Domain',
  notes: 'Notes',
};
const OWNERSHIP: Record<string, string> = { private: 'Private', state: 'Public' };
const SYSTEM = 'System';

/** A value in a sentence: "empty" when there is none, a name when the API gave one, Private/Public for ownership. */
export function valueText(field: string, value: unknown, label: string | null): string {
  if (label) return label;
  if (value === null || value === undefined || value === '') return 'empty';
  if (field === 'ownershipType' && typeof value === 'string') return OWNERSHIP[value] ?? value;
  const text = String(value);
  return text.length > 90 ? text.slice(0, 88) + '…' : text;
}

const personName = (v: unknown): string => ((v as { name?: string } | null)?.name ?? 'a contact');

/** A field change as one sentence; null for a row the page doesn't show (a deleted company, a line). */
export function changeSentence(e: Pick<ApiHistoryEntry, 'action' | 'field' | 'oldValue' | 'newValue' | 'oldLabel' | 'newLabel' | 'label' | 'actor'>): string | null {
  const who = e.actor?.name ?? SYSTEM;
  if (e.action === 'created') return `${who} created the company`;
  if (e.action !== 'updated' || !e.field) return null;
  if (e.field === 'contact') {
    if (e.newValue && !e.oldValue) return `${who} added ${personName(e.newValue)} as a contact`;
    if (e.oldValue && !e.newValue) return `${who} removed ${personName(e.oldValue)} as a contact`;
    return null;
  }
  if (e.field === 'contactRole') return `${who} changed ${e.label ?? 'a contact'}'s role in the decision from ${valueText(e.field, e.oldValue, null)} to ${valueText(e.field, e.newValue, null)}`;
  const name = COMPANY_FIELD_LABELS[e.field] ?? e.field;
  return `${who} changed ${name} from ${valueText(e.field, e.oldValue, e.oldLabel)} to ${valueText(e.field, e.newValue, e.newLabel)}`;
}

/** An activity or status entry (the timeline's LogEntry) as one sentence: "Status: Opportunity, automatic (was Lead)", "Call: interested in …". */
export function activitySentence(a: Pick<LogEntry, 'title' | 'detail'>): string {
  const title = a.title.replace(/ · /g, ', ');
  const detail = a.detail.trim().replace(/\s+/g, ' ');
  // A status change's detail is "Was Lead." (CD-358): said in brackets, not as a second sentence.
  const was = /^Was (.+)\.$/.exec(detail);
  if (was) return `${title} (was ${was[1]})`;
  return detail ? `${title}: ${detail}` : title;
}

/** Field changes and activity merged, newest first; entries just made (no time) on top. */
export function historyRows(changes: Pick<ApiHistoryEntry, 'id' | 'action' | 'field' | 'oldValue' | 'newValue' | 'oldLabel' | 'newLabel' | 'label' | 'actor' | 'changedAt'>[], activity: LogEntry[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const e of changes) {
    const text = changeSentence(e);
    if (text) rows.push({ key: 'c' + e.id, at: e.changedAt, actor: e.actor?.name ?? null, text });
  }
  activity.forEach((a, i) => rows.push({ key: 'a' + i + (a.at ?? ''), at: a.at ?? '9', actor: a.actor, text: activitySentence(a) }));
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** The first `limit` rows and how many stay hidden behind "Show N more" (`extra`: pages not loaded yet). */
export function visibleRows<T>(rows: T[], expanded: boolean, limit = 4, extra = 0): { shown: T[]; hidden: number } {
  if (expanded) return { shown: rows, hidden: extra };
  return { shown: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit) + extra };
}

/** "30 Oct, 11:02" in the workspace's time zone; '' for an entry without a time yet. */
export function whenText(at: string, tz?: string): string {
  if (!at || at === '9') return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }).format(new Date(at)).replace(/,?\s(\d{2}:\d{2})$/, ', $1');
  } catch {
    return new Date(at).toLocaleString('en-GB');
  }
}
