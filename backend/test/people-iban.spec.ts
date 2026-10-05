import { describe, expect, it } from 'vitest';
import { bankAccountEmail } from '../src/modules/people/bank-email';
import { domesticFromIban, formatIban, isValidIban, maskIban, parseBankAccount, parseDomesticAccount, parseSwiftBic, shortMaskIban } from '../src/modules/people/iban';
import { cleanName, normalizeForSearch, searchPattern } from '../src/modules/people/search';

describe('bank accounts (spec 4.4 vectors)', () => {
  it('accepts the valid Serbian IBAN', () => {
    expect(parseBankAccount('RS35260005601001611379')).toEqual({ iban: 'RS35260005601001611379', country: 'RS', foreign: false, convertedFromDomestic: false });
  });

  it('converts the domestic account number to the same IBAN', () => {
    expect(parseBankAccount('260-0056010016113-79')).toEqual({ iban: 'RS35260005601001611379', country: 'RS', foreign: false, convertedFromDomestic: true });
    // A shorter middle part is padded with leading zeros; 18 digits without hyphens work too.
    expect(parseBankAccount('260-56010016113-79')?.iban).toBe('RS35260005601001611379');
    expect(parseBankAccount('260005601001611379')?.iban).toBe('RS35260005601001611379');
  });

  it('refuses the invalid IBAN and a domestic number with a wrong control number', () => {
    expect(parseBankAccount('RS35260005601001611378')).toBeNull();
    expect(parseBankAccount('260-0056010016113-78')).toBeNull();
    expect(parseDomesticAccount('260-0056010016113-78')).toBeNull();
  });

  it('accepts a valid foreign IBAN and marks it foreign', () => {
    expect(parseBankAccount('DE89370400440532013000')).toEqual({ iban: 'DE89370400440532013000', country: 'DE', foreign: true, convertedFromDomestic: false });
  });

  it('ignores spaces and hyphens and upper-cases letters', () => {
    expect(parseBankAccount(' rs35 2600 0560 1001 6113 79 ')?.iban).toBe('RS35260005601001611379');
    expect(parseBankAccount('DE89-3704-0044-0532-0130-00')?.iban).toBe('DE89370400440532013000');
  });

  it('refuses unknown countries, wrong lengths and garbage', () => {
    expect(isValidIban('XX35260005601001611379')).toBe(false);
    expect(parseBankAccount('RS3526000560100161137')).toBeNull(); // 21 characters
    expect(parseBankAccount('DE8937040044053201300')).toBeNull();
    expect(parseBankAccount('hello')).toBeNull();
    expect(parseBankAccount('')).toBeNull();
    expect(parseBankAccount('12-34-56')).toBeNull();
  });

  it('formats, masks and shows the domestic form', () => {
    expect(formatIban('RS35260005601001611379')).toBe('RS35 2600 0560 1001 6113 79');
    expect(domesticFromIban('RS35260005601001611379')).toBe('260-0056010016113-79');
    expect(domesticFromIban('DE89370400440532013000')).toBeNull();
    expect(maskIban('RS35260005601001611379')).toBe('RS35 •••• •••• •••• ••13 79');
    expect(shortMaskIban('RS35260005601001611379')).toBe('RS35 •••• 1379');
  });

  it('checks SWIFT/BIC codes', () => {
    expect(parseSwiftBic('aikb rs 22')).toBe('AIKBRS22');
    expect(parseSwiftBic('DEUTDEFF500')).toBe('DEUTDEFF500');
    expect(parseSwiftBic('DEUTDEFF5')).toBeNull();
    expect(parseSwiftBic('1234RS22')).toBeNull();
  });
});

describe('search normalisation', () => {
  it('folds Serbian and other accents and case', () => {
    expect(normalizeForSearch('Petrović')).toBe('petrovic');
    expect(normalizeForSearch('ĐORĐEVIĆ Šćepan Žarko Čolić')).toBe('dordevic scepan zarko colic');
    expect(normalizeForSearch('Müller Ñoño Łukasz')).toBe('muller nono lukasz');
    expect(normalizeForSearch(null)).toBe('');
    expect(normalizeForSearch('petrovic')).toBe(normalizeForSearch('PETROVIĆ'));
  });

  it('escapes LIKE wildcards and cleans names', () => {
    expect(searchPattern('50%_off')).toBe('%50\\%\\_off%');
    expect(cleanName('  Ana   Marija ')).toBe('Ana Marija');
  });
});

describe('"Bank account changed" email', () => {
  const base = { to: 'ana@example.test', employeeName: 'Ana Petrović', workspaceName: 'WBM', appUrl: 'https://app.example.test', employeeId: 'e1' };

  it('shows masks and who changed it, never a full number', () => {
    const mail = bankAccountEmail({ ...base, actorName: 'Marko Ilić', self: false, changes: [{ account: 'iban', kind: 'changed', masked: 'RS35 •••• 1379' }] });
    expect(mail.subject).toBe('Your bank account in WBM was changed');
    expect(mail.text).toContain('Marko Ilić changed the bank account on your employee record in WBM.');
    expect(mail.text).toContain('New bank account: RS35 •••• 1379');
    expect(mail.text).toContain('https://app.example.test/people/e1');
    expect(mail.text).not.toMatch(/RS35\d{4}/);
    expect(mail.html).toContain('RS35 •••• 1379');
  });

  it('says "You" when the employee changed it, and names removals', () => {
    const mail = bankAccountEmail({ ...base, actorName: 'Ana Petrović', self: true, changes: [{ account: 'fxIban', kind: 'removed', masked: 'DE89 •••• 3000' }] });
    expect(mail.text).toContain('You changed the bank account');
    expect(mail.text).toContain('Removed foreign currency account: DE89 •••• 3000');
    expect(mail.text).toContain("If this wasn't you");
  });
});
