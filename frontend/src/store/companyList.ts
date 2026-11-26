// The Companies list (CD-533): its default order, the Last activity text, the amber note under an
// incomplete lead and the top bar search. Pure (no React, no store imports), so it is unit-tested with
// Node's runner (test/companyList.test.ts).
import { fold, foldIncludes } from './filters.ts';
import type { CompanyStatus } from './types';

/** The default order: clients, opportunities, past clients, leads, then not interested. */
export const LIST_STATUS_ORDER: Record<CompanyStatus, number> = { client: 0, opportunity: 1, past_client: 2, lead: 3, not_interested: 4 };

/** What happened, by timeline channel ("Meeting, 2 days ago"). */
export const ACTIVITY_WHAT: Record<string, string> = { EM: 'Email', PH: 'Call', MT: 'Meeting', LI: 'LinkedIn message', WA: 'WhatsApp message', NT: 'Note', RS: 'Research' };

const dayNumber = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);

/** A day in a list: "today", "yesterday", "5 days ago" within two weeks, else "30 Oct" (CD-530 dates). */
export function dayAgo(day: string, today: string): string {
  const ago = dayNumber(today) - dayNumber(day);
  if (ago <= 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 14) return `${ago} days ago`;
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "Meeting, 2 days ago"; `day` is the activity's date in the workspace's time zone. */
export function lastActivityText(activity: { channel: string; day: string } | null | undefined, today: string): string {
  if (!activity) return 'No activity yet';
  return `${ACTIVITY_WHAT[activity.channel] ?? 'Activity'}, ${dayAgo(activity.day, today)}`;
}

/** The amber line under a lead that misses its PIB, address or contact: "Incomplete record, no PIB or contact". */
export function incompleteNote(missing: { pib: boolean; address: boolean; contact: boolean }): string | null {
  const gaps = [missing.pib && 'PIB', missing.address && 'address', missing.contact && 'contact'].filter((g): g is string => !!g);
  if (!gaps.length) return null;
  const list = gaps.length > 1 ? `${gaps.slice(0, -1).join(', ')} or ${gaps[gaps.length - 1]}` : gaps[0];
  return `Incomplete record, no ${list}`;
}

/**
 * The top bar search on this page: every word is in the name, PIB, industry, city or owner, without
 * accents as the filters match ("sabac" finds "Šabac", "dordevic" and "djordjevic" find "Đorđević").
 */
export function matchesSearch(query: string, texts: (string | null | undefined)[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = texts.filter(Boolean).join(' ');
  return words.every((w) => foldIncludes(hay, w));
}
