/**
 * The employee card's one draft (CD-225): every field the caller may change is an input, and one
 * Save in the header sends what changed. Pure functions without React or the store, so
 * `frontend/test` runs them in Node.
 *
 * Values are strings for inputs (dates and numbers too, as typed) and booleans for switches. The
 * draft only holds what the person touched; the rest comes from the card as it is now, so a live
 * update of another field shows at once and is never sent back.
 */

export type Draft = Record<string, string | boolean>;

/** The current values: the card's, overlaid with what was typed. */
export const draftValues = (initial: Draft, edits: Draft): Draft => ({ ...initial, ...edits });

/** What changed and may be saved: typed values that differ from the card, for fields the caller may change. */
export function changedFields(initial: Draft, edits: Draft, editable: ReadonlySet<string>): Draft {
  const out: Draft = {};
  for (const [k, v] of Object.entries(edits)) if (editable.has(k) && v !== (initial[k] ?? '')) out[k] = v;
  return out;
}

/** Whether anything would be saved. */
export const isDirty = (initial: Draft, edits: Draft, editable: ReadonlySet<string>) => Object.keys(changedFields(initial, edits, editable)).length > 0;

/** Changed values as the API takes them: text trimmed, empty text clears the field (null). */
export function patchOf(changed: Draft): Record<string, string | boolean | null> {
  const out: Record<string, string | boolean | null> = {};
  for (const [k, v] of Object.entries(changed)) out[k] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v;
  return out;
}
