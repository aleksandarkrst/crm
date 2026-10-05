import { describe, expect, it } from 'vitest';
import { reportingLineEmail } from '../src/modules/people/org-email';

describe('"New manager" and "New direct report" (spec 10.2)', () => {
  const base = {
    to: 'ana@example.test',
    employee: { id: 'e1', fullName: 'Ana Petrović', jobTitle: 'Technician' },
    manager: { id: 'm1', fullName: 'Marko Ilić', jobTitle: null },
    actorName: 'Jelena Hr',
    workspaceName: 'WBM',
    appUrl: 'https://app.example.test/',
  };

  it('tells the employee who their manager is now, with a link to the manager', () => {
    const mail = reportingLineEmail({ ...base, recipient: 'employee' });
    expect(mail.subject).toBe('Your new manager in WBM: Marko Ilić');
    expect(mail.text).toContain('Hi Ana,');
    expect(mail.text).toContain('Jelena Hr changed who you report to in WBM. Your manager is now Marko Ilić.');
    expect(mail.text).toContain('https://app.example.test/people/m1');
    expect(mail.text).toContain('"Org changes" is on');
  });

  it('tells the manager about the new direct report, with the job title', () => {
    const mail = reportingLineEmail({ ...base, to: 'marko@example.test', recipient: 'manager', actorName: null });
    expect(mail.subject).toBe('New direct report in WBM: Ana Petrović');
    expect(mail.text).toContain('Hi Marko,');
    expect(mail.text).toContain('An administrator made Ana Petrović (Technician) your direct report in WBM.');
    expect(mail.text).toContain('https://app.example.test/people/e1');
    expect(mail.html).toContain('Ana Petrović (Technician)');
  });
});
