import { PDFParse } from 'pdf-parse';
import { describe, expect, it } from 'vitest';
import { renderPdf } from '../src/modules/hr-documents';
import { mbValid, pibValid } from '../src/modules/identity/settings.schemas';
import { buildVacationDecision, missingCompanyDetails, srDate, type VacationDecisionData } from '../src/modules/timeoff/decision-document';
import { DEFAULT_LEGAL_BASIS } from '../src/shared/database/schema';

const company = { legalName: 'Zapadni Balkan Mašine d.o.o.', address: 'Bulevar oslobođenja 12, 21000 Novi Sad', pib: '104052135', mb: '20084693', place: 'Novi Sad', signatoryName: 'Petar Jovanović', signatoryTitle: 'Direktor', legalBasis: DEFAULT_LEGAL_BASIS };

const base: VacationDecisionData = {
  company,
  issuedOn: '2026-10-16',
  requestedOn: '2026-10-12',
  employee: { fullName: 'Đorđe Šćepanović', jobTitle: 'Serviser' },
  year: 2026,
  entitlement: { totalDays: 23, baseDays: 20, experienceDays: 3, experienceYears: 12, individualDays: 0, individualReason: null, monthsWorked: null },
  whole: false,
  startDate: '2026-11-09',
  endDate: '2026-11-13',
  workingDays: 4,
  returnDate: '2026-11-16',
  pools: [{ year: 2026, days: 4 }],
  holidays: [{ date: '2026-11-11', name: 'Dan primirja' }],
};

/** The PDF's text with whitespace collapsed (pdf-parse breaks lines where the layout wraps). */
async function textOf(data: VacationDecisionData, number = 'GO-2026-0007'): Promise<string> {
  const pdf = await renderPdf(buildVacationDecision(data, number));
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const parser = new PDFParse({ data: pdf });
  try {
    const parsed = await parser.getText();
    expect(parsed.total).toBe(1);
    return parsed.text.replace(/\s+/g, ' ');
  } finally {
    await parser.destroy();
  }
}

describe('the vacation decision PDF (spec 11.2, 11.6)', () => {
  it('a period with a holiday: company, number, employee, days, return date and the holiday, with Serbian diacritics', async () => {
    const text = await textOf(base);
    for (const part of [
      'Zapadni Balkan Mašine d.o.o.',
      'Bulevar oslobođenja 12, 21000 Novi Sad',
      'PIB: 104052135',
      'MB: 20084693',
      'Broj: GO-2026-0007',
      'Novi Sad, 16.10.2026.',
      'zahteva zaposlenog od 12.10.2026.',
      'R E Š E N J E', // the title is letter-spaced; pdf-parse reads the gaps as spaces
      'o korišćenju godišnjeg odmora za 2026. godinu',
      'Zaposlenom Đorđe Šćepanović, raspoređenom na poslove Serviser',
      'u trajanju od 23 radna dana',
      'deo godišnjeg odmora u trajanju od 4 radna dana, u periodu od 09.11.2026. do 13.11.2026. godine',
      'da se vrati na rad dana 16.11.2026. godine',
      '20 radnih dana po osnovu zakona',
      'uvećano za 3 radna dana po osnovu 12 godina radnog iskustva',
      'Dan primirja (11.11.2026.)',
      'Pouka o pravnom leku',
      'Petar Jovanović, Direktor',
    ]) {
      expect(text, part).toContain(part);
    }
  });

  it('across New Year with carry-over: one decision naming both pool years', async () => {
    const text = await textOf({ ...base, year: 2026, startDate: '2026-12-28', endDate: '2027-01-08', workingDays: 8, returnDate: '2027-01-11', pools: [{ year: 2026, days: 3 }, { year: 2027, days: 5 }], holidays: [] });
    expect(text).toContain('Od toga se 3 radna dana koristi na ime godišnjeg odmora za 2026. godinu, a 5 radnih dana na ime godišnjeg odmora za 2027. godinu.');
    expect(text).toContain('u periodu od 28.12.2026. do 08.01.2027. godine');
    expect(text).not.toContain('praznici koji su neradni dani:');
  });

  it('the whole remaining entitlement and a first-year proportional entitlement', async () => {
    const text = await textOf({ ...base, whole: true, entitlement: { ...base.entitlement!, totalDays: 7, experienceDays: 0, monthsWorked: 4 }, workingDays: 7 });
    expect(text).toContain('ceo godišnji odmor u trajanju od 7 radnih dana');
    expect(text).toContain('srazmerni deo godišnjeg odmora za 4 meseca rada u 2026. godini');
    expect(text).not.toContain('u delovima');
  });

  it('refuses without the company details, naming what is missing', () => {
    expect(missingCompanyDetails({ ...company, pib: null, signatoryName: ' ' })).toEqual(['PIB', 'signatory name']);
    expect(() => buildVacationDecision({ ...base, company: { ...company, pib: null } }, 'GO-2026-0001')).toThrow('Company details are missing: PIB');
  });

  it('Serbian dates, PIB and MB check digits', () => {
    expect(srDate('2026-01-05')).toBe('05.01.2026.');
    expect(pibValid('104052135')).toBe(true);
    expect(pibValid('104052136')).toBe(false);
    expect(pibValid('10405213')).toBe(false);
    expect(mbValid('20084693')).toBe(true);
    expect(mbValid('20084694')).toBe(false);
  });
});
