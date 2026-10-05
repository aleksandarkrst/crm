/**
 * Bank account numbers in the browser (milestone 13, spec 4.4), for the preview while typing on the
 * employee card: a Serbian domestic account number becomes its IBAN before saving. The same rules
 * as the server (backend/src/modules/people/iban.ts), which checks again on save.
 */

export const INVALID_ACCOUNT_MESSAGE = 'This is not a valid IBAN or Serbian account number';

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28,
  CZ: 24, DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23,
  GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32,
  LI: 21, LT: 20, LU: 20, LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18,
  NO: 15, OM: 23, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19,
  SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

export interface ParsedAccount {
  iban: string;
  country: string;
  foreign: boolean;
  convertedFromDomestic: boolean;
}

function mod97(digits: string): number {
  let rest = 0;
  for (let i = 0; i < digits.length; i += 7) rest = Number(`${rest}${digits.slice(i, i + 7)}`) % 97;
  return rest;
}
const lettersToDigits = (s: string) => s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const length = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!length || iban.length !== length) return false;
  return mod97(lettersToDigits(iban.slice(4) + iban.slice(0, 4))) === 1;
}

function parseDomesticAccount(input: string): string | null {
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
  return 98 - mod97(`${digits.slice(0, 16)}00`) === Number(digits.slice(16)) ? digits : null;
}

/** An IBAN in any spacing or a Serbian domestic account number, as an IBAN; null when it is neither. */
export function parseBankAccount(input: string): ParsedAccount | null {
  const compact = input.replace(/[\s-]+/g, '').toUpperCase();
  if (/^[A-Z]{2}/.test(compact)) {
    if (!isValidIban(compact)) return null;
    const country = compact.slice(0, 2);
    return { iban: compact, country, foreign: country !== 'RS', convertedFromDomestic: false };
  }
  const domestic = parseDomesticAccount(input);
  if (!domestic) return null;
  const iban = `RS${String(98 - mod97(lettersToDigits(`${domestic}RS00`))).padStart(2, '0')}${domestic}`;
  return isValidIban(iban) ? { iban, country: 'RS', foreign: false, convertedFromDomestic: true } : null;
}

/** Grouped by four: "RS35 2600 0560 1001 6113 79". */
export const formatIban = (iban: string): string => iban.replace(/(.{4})(?=.)/g, '$1 ');

/** "260-0056010016113-79" for a Serbian IBAN; null otherwise. */
export function domesticFromIban(iban: string): string | null {
  if (!/^RS\d{20}$/.test(iban)) return null;
  const d = iban.slice(4);
  return `${d.slice(0, 3)}-${d.slice(3, 16)}-${d.slice(16)}`;
}

/** SWIFT/BIC: 8 or 11 characters. */
export const isSwiftBic = (input: string): boolean => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(input.replace(/\s+/g, '').toUpperCase());
