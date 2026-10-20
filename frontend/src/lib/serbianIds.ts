import type { Checked } from './validate';

/**
 * Serbian company ids (CD-357), the same rules as the backend's shared/validation/serbian-ids.ts:
 * the form says what is wrong before the API refuses it.
 */

/** A PIB (tax id): nine digits, the last the ISO 7064 MOD 11,10 check digit. */
export function pibValid(pib: string): boolean {
  if (!/^\d{9}$/.test(pib)) return false;
  let r = 10;
  for (const ch of pib.slice(0, 8)) {
    r = (r + Number(ch)) % 10 || 10;
    r = (r * 2) % 11;
  }
  return (11 - r) % 10 === Number(pib[8]);
}

/** An MB (registration number): eight digits, the last a MOD 11 check digit (weights 2, 7, 6, 5, 4, 3, 2). */
export function mbValid(mb: string): boolean {
  if (!/^\d{8}$/.test(mb)) return false;
  const weights = [2, 7, 6, 5, 4, 3, 2];
  const r = [...mb.slice(0, 7)].reduce((sum, ch, i) => sum + Number(ch) * weights[i]!, 0) % 11;
  const check = 11 - r > 9 ? 0 : 11 - r;
  return check === Number(mb[7]);
}

/** Why a PIB is not valid, in words; null when it is. */
export function pibProblem(input: string): string | null {
  const v = input.replace(/\s/g, '');
  if (!v) return 'The PIB is required.';
  if (!/^\d+$/.test(v)) return 'A PIB has digits only.';
  if (v.length !== 9) return `A PIB has 9 digits; this one has ${v.length}.`;
  return pibValid(v) ? null : 'This PIB fails its check digit. Check it for a typo.';
}

/**
 * Company identity (CD-357). The PIB can't be cleared once a company has one; spaces are dropped
 * ("104 052 135" is saved as 104052135).
 */
export function checkPib(input: string): Checked {
  const value = input.replace(/\s/g, '');
  const problem = pibProblem(value);
  return problem ? { ok: false, error: problem } : { ok: true, value };
}

export function checkMb(input: string): Checked {
  const value = input.replace(/\s/g, '');
  if (!value) return { ok: true, value: '' };
  return mbValid(value) ? { ok: true, value } : { ok: false, error: 'An MB has 8 digits with a valid check digit.' };
}

export function checkActivityCode(input: string): Checked {
  const value = input.trim();
  if (!value) return { ok: true, value: '' };
  return /^\d{4}$/.test(value) ? { ok: true, value } : { ok: false, error: 'The activity code (šifra delatnosti) is 4 digits, e.g. 6201.' };
}
