/** A Serbian PIB (tax id): nine digits, the last the ISO 7064 MOD 11,10 check digit. */
export function pibValid(pib: string): boolean {
  if (!/^\d{9}$/.test(pib)) return false;
  return pibCheckDigit(pib.slice(0, 8)) === Number(pib[8]);
}

/** The ninth digit that makes `first8` a valid PIB. */
export function pibCheckDigit(first8: string): number {
  let r = 10;
  for (const ch of first8) {
    r = (r + Number(ch)) % 10 || 10;
    r = (r * 2) % 11;
  }
  return (11 - r) % 10;
}

/** A Serbian MB (registration number): eight digits, the last a MOD 11 check digit (weights 2, 7, 6, 5, 4, 3, 2). */
export function mbValid(mb: string): boolean {
  if (!/^\d{8}$/.test(mb)) return false;
  const weights = [2, 7, 6, 5, 4, 3, 2];
  const r = [...mb.slice(0, 7)].reduce((sum, ch, i) => sum + Number(ch) * weights[i]!, 0) % 11;
  const check = 11 - r > 9 ? 0 : 11 - r;
  return check === Number(mb[7]);
}

export const PIB_MESSAGE = 'PIB is 9 digits with a valid check digit';
export const MB_MESSAGE = 'MB is 8 digits with a valid check digit';
