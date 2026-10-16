import { describe, expect, it } from 'vitest';
import { orthodoxEaster, serbianHolidayDates, serbianHolidays } from '../src/modules/timesheet/serbian-holidays';

describe('Orthodox Easter (spec 4.3)', () => {
  it('matches the known dates from 2026 to 2035', () => {
    const known: Record<number, string> = {
      2026: '2026-04-12',
      2027: '2027-05-02',
      2028: '2028-04-16',
      2029: '2029-04-08',
      2030: '2030-04-28',
      2031: '2031-04-13',
      2032: '2032-05-02',
      2033: '2033-04-24',
      2034: '2034-04-09',
      2035: '2035-04-29',
    };
    for (const [year, date] of Object.entries(known)) expect(orthodoxEaster(Number(year)), year).toBe(date);
  });
});

describe('Serbian non-working days (A13, A14; the spec’s table)', () => {
  const only = (year: number, monthDays: string[]) => monthDays.map((md) => `${year}-${md}`);

  it('2026: Sretenje on a Sunday moves to 17 February (16 is already a holiday)', () => {
    expect(serbianHolidayDates(2026)).toEqual(only(2026, ['01-01', '01-02', '01-07', '02-15', '02-16', '02-17', '04-10', '04-12', '04-13', '05-01', '05-02', '11-11']));
  });

  it('2027: Labour Day’s second day on a Sunday moves past Easter Monday to 4 May', () => {
    expect(serbianHolidayDates(2027)).toEqual(only(2027, ['01-01', '01-02', '01-07', '02-15', '02-16', '04-30', '05-01', '05-02', '05-03', '05-04', '11-11']));
  });

  it('2028: 2 January on a Sunday moves to 3 January', () => {
    expect(serbianHolidayDates(2028)).toEqual(only(2028, ['01-01', '01-02', '01-03', '01-07', '02-15', '02-16', '04-14', '04-16', '04-17', '05-01', '05-02', '11-11']));
  });

  it('2029: Christmas on a Sunday does not move; Armistice Day does, to 12 November', () => {
    expect(serbianHolidayDates(2029)).toEqual(only(2029, ['01-01', '01-02', '01-07', '02-15', '02-16', '04-06', '04-08', '04-09', '05-01', '05-02', '11-11', '11-12']));
  });

  it('fixed holidays repeat yearly as spans; Easter and moved days hold for one year', () => {
    const h = serbianHolidays(2026);
    expect(h.find((x) => x.name.startsWith('Nova godina'))).toMatchObject({ date: '2026-01-01', endDate: '2026-01-02', repeats: true });
    expect(h.find((x) => x.name.startsWith('Dan primirja'))).toMatchObject({ date: '2026-11-11', endDate: null, repeats: true });
    expect(h.find((x) => x.name.startsWith('Vaskrs ('))).toMatchObject({ date: '2026-04-12', repeats: false });
    expect(h.find((x) => x.name.startsWith('Neradni dan'))).toMatchObject({ date: '2026-02-17', name: 'Neradni dan (moved: Sretenje (Statehood Day))', repeats: false });
  });
});
