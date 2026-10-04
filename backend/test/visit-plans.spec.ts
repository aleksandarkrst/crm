import { describe, expect, it } from 'vitest';
import { fiscalQuarter, isPeriodStart, periodLabel, periodOf, periodStartOf, shiftPeriod } from '../src/modules/crm/visit-plans/periods';
import { visitPlanEmail } from '../src/modules/notifications/visit-plan-email';

describe('visit plan periods (CD-134)', () => {
  it('months start on the 1st and end on the 1st of the next month', () => {
    expect(periodOf('month', '2026-10-01', 1)).toEqual({ type: 'month', start: '2026-10-01', end: '2026-11-01', label: 'October 2026' });
    expect(periodOf('month', '2026-12-01', 7)).toEqual({ type: 'month', start: '2026-12-01', end: '2027-01-01', label: 'December 2026' });
    expect(periodOf('month', '2026-10-02', 1)).toBeNull();
    expect(periodOf('month', '2026-02-30', 1)).toBeNull();
    expect(periodOf('month', 'October', 1)).toBeNull();
  });

  it('calendar quarters when the fiscal year starts in January', () => {
    expect(periodOf('quarter', '2026-10-01', 1)).toEqual({ type: 'quarter', start: '2026-10-01', end: '2027-01-01', label: 'Q4 2026' });
    expect(periodOf('quarter', '2026-01-01', 1)?.label).toBe('Q1 2026');
    expect(isPeriodStart('quarter', '2026-11-01', 1)).toBe(false);
    expect(isPeriodStart('quarter', '2026-04-01', 1)).toBe(true);
  });

  it('fiscal quarters when the fiscal year starts in July', () => {
    // FY2027 runs July 2026 – June 2027.
    expect(periodOf('quarter', '2026-07-01', 7)).toEqual({ type: 'quarter', start: '2026-07-01', end: '2026-10-01', label: 'Q1 FY2027 (Jul–Sep 2026)' });
    expect(periodOf('quarter', '2026-10-01', 7)?.label).toBe('Q2 FY2027 (Oct–Dec 2026)');
    expect(periodOf('quarter', '2027-01-01', 7)?.label).toBe('Q3 FY2027 (Jan–Mar 2027)');
    expect(periodOf('quarter', '2027-04-01', 7)).toEqual({ type: 'quarter', start: '2027-04-01', end: '2027-07-01', label: 'Q4 FY2027 (Apr–Jun 2027)' });
    expect(periodOf('quarter', '2026-08-01', 7)).toBeNull();
    expect(fiscalQuarter(2026, 7, 7)).toEqual({ quarter: 1, fiscalYear: 2027 });
  });

  it('fiscal quarters when the fiscal year starts in October, and quarters across the new year', () => {
    expect(periodOf('quarter', '2026-10-01', 10)?.label).toBe('Q1 FY2027 (Oct–Dec 2026)');
    expect(periodOf('quarter', '2027-07-01', 10)?.label).toBe('Q4 FY2027 (Jul–Sep 2027)');
    expect(periodOf('quarter', '2026-11-01', 11)).toEqual({ type: 'quarter', start: '2026-11-01', end: '2027-02-01', label: 'Q1 FY2027 (Nov 2026–Jan 2027)' });
    expect(periodOf('quarter', '2027-01-01', 10)?.label).toBe('Q2 FY2027 (Jan–Mar 2027)');
  });

  it('a quarter that no longer lines up with the fiscal year reads by its months', () => {
    expect(periodLabel('quarter', '2026-10-01', '2027-01-01', 2)).toBe('Oct–Dec 2026');
  });

  it('finds the period of a day, and the previous and next periods', () => {
    expect(periodStartOf('month', '2026-10-17', 1)).toBe('2026-10-01');
    expect(periodStartOf('quarter', '2026-10-17', 1)).toBe('2026-10-01');
    expect(periodStartOf('quarter', '2026-09-30', 7)).toBe('2026-07-01');
    expect(periodStartOf('quarter', '2027-02-14', 10)).toBe('2027-01-01');
    expect(periodStartOf('quarter', '2027-01-14', 11)).toBe('2026-11-01');
    expect(shiftPeriod('month', '2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftPeriod('month', '2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftPeriod('quarter', '2026-11-01', -1)).toBe('2026-08-01');
    expect(shiftPeriod('quarter', '2026-11-01', 1)).toBe('2027-02-01');
  });
});

describe('visitPlanEmail', () => {
  const plan = {
    id: 'p1',
    periodLabel: 'October 2026',
    note: 'Focus on <renewals>',
    lines: [
      { companyName: 'Globex & Sons', plannedVisits: 2 },
      { companyName: 'Initech', plannedVisits: 1 },
    ],
  };
  const input = { to: 'bo@example.com', salespersonName: 'Bo Jensen', actorName: 'Ana Petrović', workspaceName: 'Acme Studio', appUrl: 'https://app.example.com/', plan };

  it('lists the customers and planned visits, with a link to the plan', () => {
    const mail = visitPlanEmail({ ...input, kind: 'created' });
    expect(mail.to).toBe('bo@example.com');
    expect(mail.subject).toBe('Your visit plan for October 2026');
    expect(mail.text).toContain('Hi Bo,');
    expect(mail.text).toContain('Ana Petrović made a visit plan for you for October 2026 in Acme Studio: 3 visits at 2 customers.');
    expect(mail.text).toContain('- Globex & Sons: 2 visits\n- Initech: 1 visit');
    expect(mail.text).toContain('Note: Focus on <renewals>');
    expect(mail.text).toContain('Open the plan: https://app.example.com/visit-plans/p1');
    expect(mail.html).toContain('Globex &amp; Sons');
    expect(mail.html).toContain('Focus on &lt;renewals&gt;');
    expect(mail.html).not.toContain('<renewals>');
    expect(mail.html).toContain('href="https://app.example.com/visit-plans/p1"');
  });

  it('says when the plan was changed', () => {
    const mail = visitPlanEmail({ ...input, kind: 'changed', salespersonName: null, plan: { ...plan, note: null, lines: [plan.lines[0]!] } });
    expect(mail.subject).toBe('Your visit plan for October 2026 was changed');
    expect(mail.text).toContain('Hi,');
    expect(mail.text).toContain('Ana Petrović changed your visit plan for October 2026 in Acme Studio. It now has 2 visits at 1 customer.');
    expect(mail.text).not.toContain('Note:');
  });
});
