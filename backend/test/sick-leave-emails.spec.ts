import { describe, expect, it } from 'vitest';
import { interruptedEmail, sickEndedEmail, sickReportedEmail, weeklyCheckEmail } from '../src/modules/timeoff/sick-leave-emails';

const base = { workspaceName: 'WBM', appUrl: 'https://app.pultly.com/' };

describe('sick leave emails (spec 15.2)', () => {
  it('reported: who reported for whom, open or with an end; the Admin line only for Admins', () => {
    const m = sickReportedEmail({ ...base, to: 'mgr@x.test', recipientName: 'Marko Ilić', employeeName: 'Ana Petrović', reporterName: 'Ana Petrović', startDate: '2026-11-02', endDate: null, admin: false });
    expect(m.subject).toBe('Sick leave reported: Ana Petrović, 2 Nov 2026, until return');
    expect(m.text).toContain('Ana Petrović reported sick leave in WBM');
    expect(m.text).not.toContain('Confirm it');
    const a = sickReportedEmail({ ...base, to: 'admin@x.test', recipientName: 'Ivana', employeeName: 'Ana Petrović', reporterName: 'Marko Ilić', startDate: '2026-11-02', endDate: '2026-11-04', admin: true });
    expect(a.text).toContain('Marko Ilić reported sick leave for Ana Petrović');
    expect(a.text).toContain('Confirm it with its type');
    expect(a.text).toContain('https://app.pultly.com/timeoff?tab=sick');
  });

  it('ended names the return day; interrupted lists the days and never a type', () => {
    expect(sickEndedEmail({ ...base, to: 'm@x.test', recipientName: 'Marko', employeeName: 'Ana Petrović', startDate: '2026-11-02', endDate: '2026-11-06', returnDate: '2026-11-09' }).subject).toBe('Sick leave ended: Ana Petrović, back on 9 Nov 2026');
    const self = interruptedEmail({ ...base, to: 'ana@x.test', recipientName: 'Ana Petrović', self: true, employeeName: 'Ana Petrović', what: 'vacation', dates: ['2026-11-03', '2026-11-04'], vacation: true });
    expect(self.subject).toBe('Time off interrupted by sick leave: Ana Petrović, 2 days');
    expect(self.text).toContain('Sick leave interrupted your vacation in WBM: 2 days (3 Nov 2026, 4 Nov 2026). The days are back in the vacation balance.');
    const approver = interruptedEmail({ ...base, to: 'm@x.test', recipientName: 'Marko', self: false, employeeName: 'Ana Petrović', what: 'unpaid leave', dates: ['2026-11-03'], vacation: false });
    expect(approver.text).toContain("interrupted Ana Petrović's unpaid leave");
    expect(approver.text).not.toContain('balance');
  });

  it('the weekly check lists each record with what to do', () => {
    const m = weeklyCheckEmail({ ...base, to: 'a@x.test', recipientName: 'Ivana', records: [{ employeeName: 'Ana', startDate: '2026-10-01', endDate: null, status: 'confirmed', stale: true }, { employeeName: 'Bo', startDate: '2026-11-02', endDate: '2026-11-03', status: 'reported', stale: false }] });
    expect(m.subject).toBe('Sick leave to check: 2 records');
    expect(m.text).toContain('Ana: 1 Oct 2026, until return, still open: check the end date');
    expect(m.text).toContain('Bo: 2 Nov 2026 to 3 Nov 2026, not confirmed yet');
  });
});
