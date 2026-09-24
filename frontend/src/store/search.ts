import { allPeople, companyOfPerson, companyRecords, initialsOf, stageOf } from './selectors';
import type { State } from './types';

/**
 * Global search (the header box, CD-63) over the loaded workspace. The store holds every deal,
 * company and contact (remote.ts pages through them all), so this runs in the browser. If the
 * lists ever stop being complete, this has to become an API search.
 */
export type SearchKind = 'deal' | 'company' | 'contact';

export interface SearchHit {
  kind: SearchKind;
  /** Deal id, company id or person id: what the record's route takes. */
  id: string;
  title: string;
  subtitle: string;
  initials: string;
  score: number;
}

export interface SearchGroup {
  kind: SearchKind;
  label: string;
  hits: SearchHit[];
}

const GROUPS: { kind: SearchKind; label: string }[] = [
  { kind: 'deal', label: 'Deals' },
  { kind: 'company', label: 'Companies' },
  { kind: 'contact', label: 'Contacts' },
];

/** Lower case without accents, so "markovic" finds "Marković". */
export const fold = (v: string | null | undefined): string =>
  (v ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'dj')
    .replace(/Đ/g, 'Dj')
    .toLowerCase()
    .trim();

const digits = (v: string | null | undefined): string => (v ?? '').replace(/\D/g, '');

/** Joins the parts that have a value; the design shows "—" for an empty field, which isn't one. */
const joinParts = (parts: (string | null | undefined)[]): string => parts.filter((x) => x && x.trim() !== '—').join(' · ');

/**
 * How well one field matches: 3 = starts with the query, 2 = a word starts with it,
 * 1 = contains it, 0 = no match. Phone numbers match on their digits.
 */
function fieldScore(value: string | null | undefined, q: string, qDigits: string, phone = false): number {
  if (phone) {
    const d = digits(value);
    return qDigits.length >= 3 && d.includes(qDigits) ? (d.startsWith(qDigits) ? 3 : 1) : 0;
  }
  const v = fold(value);
  if (!v) return 0;
  if (v.startsWith(q)) return 3;
  const at = v.indexOf(q);
  if (at < 0) return 0;
  return /[\s.@,·/()-]/.test(v[at - 1] ?? '') ? 2 : 1;
}

/** The best field score; the name (first field) counts a little more than the others. */
function best(fields: { value: string | null | undefined; phone?: boolean }[], q: string, qDigits: string): number {
  let top = 0;
  fields.forEach((f, i) => {
    const sc = fieldScore(f.value, q, qDigits, f.phone);
    if (sc) top = Math.max(top, sc * 2 + (i === 0 ? 1 : 0));
  });
  return top;
}

/** Deals, companies and contacts matching `query` by name, email or phone, best first per group. */
export function searchWorkspace(s: State, query: string, perGroup = 5): SearchGroup[] {
  const q = fold(query);
  if (!q) return [];
  const qDigits = digits(query);
  const hits: SearchHit[] = [];

  for (const l of s.leads) {
    const score = best(
      [{ value: l.title || l.company }, { value: l.company }, { value: l.contact }, { value: l.email }, { value: l.phone, phone: true }],
      q,
      qDigits,
    );
    if (!score) continue;
    const outcome = l.outcome === 'lost' ? 'Lost' : l.outcome === 'won' ? 'Won' : stageOf(s, l).name;
    const title = l.title || l.company || 'Untitled deal';
    hits.push({
      kind: 'deal',
      id: l.id,
      title,
      subtitle: joinParts([title !== l.company ? l.company : '', l.contact, outcome, l.value]),
      initials: initialsOf(l.company || title),
      score,
    });
  }

  for (const c of companyRecords(s)) {
    const score = best([{ value: c.name }], q, qDigits);
    if (!score) continue;
    const deals = c.oppCount === 1 ? '1 deal' : `${c.oppCount} deals`;
    hits.push({ kind: 'company', id: c.id, title: c.name, subtitle: joinParts([c.industry, c.hq, deals]), initials: initialsOf(c.name), score });
  }

  for (const p of allPeople(s)) {
    const score = best([{ value: p.name }, { value: p.email }, { value: p.phone, phone: true }], q, qDigits);
    if (!score) continue;
    const company = companyOfPerson(s, p);
    hits.push({
      kind: 'contact',
      id: p.id,
      title: p.name || p.email || 'Unnamed contact',
      subtitle: joinParts([p.role, company, p.email]),
      initials: p.initials || initialsOf(p.name),
      score,
    });
  }

  return GROUPS.map((g) => ({
    ...g,
    hits: hits
      .filter((h) => h.kind === g.kind)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, perGroup),
  })).filter((g) => g.hits.length > 0);
}
