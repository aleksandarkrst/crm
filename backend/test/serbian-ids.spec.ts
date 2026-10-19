import { describe, expect, it } from 'vitest';
import { mbValid, pibCheckDigit, pibValid } from '../src/shared/validation/serbian-ids';

describe('Serbian company ids (CD-357)', () => {
  it('PIB: nine digits with the MOD 11,10 check digit', () => {
    for (const pib of ['100002887', '104052135', '100001378']) expect(pibValid(pib)).toBe(true);
    expect(pibValid('104052136')).toBe(false);
    expect(pibValid('10405213')).toBe(false);
    expect(pibValid('1040521350')).toBe(false);
    expect(pibValid('10405213a')).toBe(false);
    expect(pibValid('')).toBe(false);
  });

  it('pibCheckDigit completes any eight digits to a valid PIB', () => {
    for (const first8 of ['10405213', '00000000', '99999999', '12345678']) expect(pibValid(first8 + pibCheckDigit(first8))).toBe(true);
  });

  it('MB: eight digits with the MOD 11 check digit', () => {
    for (const mb of ['20084693', '17162543']) expect(mbValid(mb)).toBe(true);
    expect(mbValid('20084694')).toBe(false);
    expect(mbValid('2008469')).toBe(false);
    expect(mbValid('2008469x')).toBe(false);
  });
});
