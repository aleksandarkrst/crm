/**
 * Bank account numbers (spec 4.4): IBAN validation (ISO 13616, mod 97), the Serbian domestic
 * account number (bank-account-control, mod 97) and its conversion to an IBAN, and the masked
 * forms the app shows. Pure functions, unit-tested with the spec's vectors (test/people-iban.spec.ts).
 */

export const INVALID_ACCOUNT_MESSAGE = 'This is not a valid IBAN or Serbian account number';

/** IBAN length per country (SWIFT IBAN registry). Serbia: RS, 22 characters. */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18,
  NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19,
  SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

export interface ParsedAccount {
  /** Electronic form: upper case, no spaces, e.g. "RS35260005601001611379". */
  iban: string;
  /** ISO country code, e.g. "RS". */
  country: string;
  /** Not a Serbian account (the card shows "Foreign account"). */
  foreign: boolean;
  /** The input was a Serbian domestic account number, converted to this IBAN. */
  convertedFromDomestic: boolean;
}

/** n mod 97 for a long string of digits, without big numbers. */
function mod97(digits: string): number {
  let rest = 0;
  for (let i = 0; i < digits.length; i += 7) rest = Number(`${rest}${digits.slice(i, i + 7)}`) % 97;
  return rest;
}

/** Letters become numbers (A = 10 … Z = 35), as ISO 13616 requires. */
const lettersToDigits = (s: string) => s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

/** True when an electronic-form IBAN has a known country, that country's length and a valid check. */
export function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const length = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!length || iban.length !== length) return false;
  return mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/** The two check digits of an IBAN for a country and BBAN. */
function ibanCheckDigits(country: string, bban: string): string {
  return String(98 - mod97(lettersToDigits(`${bban}${country}00`))).padStart(2, '0');
}

/**
 * A Serbian domestic account number as its 18 digits (bank 3, account 13, control 2), or null.
 * Accepts "260-0056010016113-79", "260-56010016113-79" (the middle part padded with leading
 * zeros) and "260005601001611379". Valid when control = 98 − (first 16 digits × 100 mod 97).
 */
export function parseDomesticAccount(input: string): string | null {
  const s = input.replace(/\s+/g, '');
  let digits: string;
  const parts = s.split('-');
  if (parts.length === 3) {
    const [bank, account, control] = parts as [string, string, string];
    if (!/^\d{3}$/.test(bank) || !/^\d{1,13}$/.test(account) || !/^\d{2}$/.test(control)) return null;
    digits = bank + account.padStart(13, '0') + control;
  } else if (parts.length === 1 && /^\d{18}$/.test(s)) {
    digits = s;
  } else {
    return null;
  }
  const control = 98 - mod97(`${digits.slice(0, 16)}00`);
  return control === Number(digits.slice(16)) ? digits : null;
}

/**
 * What the user typed (IBAN in any spacing, or a Serbian domestic account number) as an IBAN, or
 * null when it is neither (show INVALID_ACCOUNT_MESSAGE). Spaces and hyphens in an IBAN are ignored.
 */
export function parseBankAccount(input: string): ParsedAccount | null {
  const compact = input.replace(/[\s-]+/g, '').toUpperCase();
  if (/^[A-Z]{2}/.test(compact)) {
    if (!isValidIban(compact)) return null;
    const country = compact.slice(0, 2);
    return { iban: compact, country, foreign: country !== 'RS', convertedFromDomestic: false };
  }
  const domestic = parseDomesticAccount(input);
  if (!domestic) return null;
  const iban = `RS${ibanCheckDigits('RS', domestic)}${domestic}`;
  return isValidIban(iban) ? { iban, country: 'RS', foreign: false, convertedFromDomestic: true } : null;
}

/** Grouped by four: "RS35 2600 0560 1001 6113 79". */
export const formatIban = (iban: string): string => iban.replace(/(.{4})(?=.)/g, '$1 ');

/** The domestic form of a Serbian IBAN: "260-0056010016113-79"; null for other countries. */
export function domesticFromIban(iban: string): string | null {
  if (!/^RS\d{20}$/.test(iban)) return null;
  const d = iban.slice(4);
  return `${d.slice(0, 3)}-${d.slice(3, 16)}-${d.slice(16)}`;
}

/** Grouped, with everything but the country, check digits and last four hidden: "RS35 •••• •••• •••• ••13 79". */
export function maskIban(iban: string): string {
  const hidden = iban
    .split('')
    .map((c, i) => (i < 4 || i >= iban.length - 4 ? c : '•'))
    .join('');
  return formatIban(hidden);
}

/** The short mask stored for history and emails: "RS35 •••• 1379". */
export const shortMaskIban = (iban: string): string => `${iban.slice(0, 4)} •••• ${iban.slice(-4)}`;

/** SWIFT/BIC: 8 or 11 characters, bank (4 letters), country (2 letters), location (2), branch (3, optional). */
export function parseSwiftBic(input: string): string | null {
  const s = input.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(s) ? s : null;
}
