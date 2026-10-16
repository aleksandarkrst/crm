import { describe, expect, it } from 'vitest';
import { approvalReminderEmail, changedEmail, decidedEmail, managerAbsentEmail, withdrawnEmail } from '../src/modules/timeoff/request-emails';

const base = { workspaceName: 'WBM', appUrl: 'https://app.pultly.com/' };

describe('request emails (spec 15.2)', () => {
  it('approved and rejected go to the employee with the comment and the days left', () => {
    const ok = decidedEmail({ ...base, to: 'ana@example.test', employeeName: 'Ana Petrović', deciderName: 'Marko Ilić', decision: 'approved', what: 'vacation', startDate: '2026-11-02', endDate: '2026-11-06', workingDays: 5, comment: null, remaining: 12 });
    expect(ok.subject).toBe('Time off approved: 2 Nov 2026 to 6 Nov 2026 (5 working days)');
    expect(ok.text).toContain('Marko Ilić approved your vacation in WBM');
    expect(ok.text).toContain('Vacation days left: 12');
    const no = decidedEmail({ ...base, to: 'ana@example.test', employeeName: 'Ana Petrović', deciderName: 'Marko Ilić', decision: 'rejected', what: 'paid leave (Marriage)', startDate: '2026-11-02', endDate: '2026-11-02', workingDays: 1, comment: 'Too busy that week', remaining: null });
    expect(no.subject).toBe('Time off rejected: 2 Nov 2026 (1 working day)');
    expect(no.text).toContain('rejected your paid leave (Marriage)');
    expect(no.text).toContain('- Comment: Too busy that week');
    expect(no.text).toContain('back in your balance');
  });

  it('withdrawn goes to the approver and can be turned off', () => {
    const m = withdrawnEmail({ ...base, to: 'marko@example.test', approverName: 'Marko Ilić', employeeName: 'Ana Petrović', what: 'vacation', startDate: '2026-11-02', endDate: '2026-11-06' });
    expect(m.subject).toBe('Request withdrawn: Ana Petrović, 2 Nov 2026 to 6 Nov 2026');
    expect(m.text).toContain('"Approval reminders" setting');
  });

  it('cancelled and shortened name the actor, the days returned and the new end', () => {
    const c = changedEmail({ ...base, to: 'ana@example.test', recipientName: 'Ana Petrović', self: true, employeeName: 'Ana Petrović', actorName: 'Marko Ilić', change: 'cancelled', what: 'vacation', startDate: '2026-11-02', endDate: '2026-11-06', newEndDate: null, returnedDays: 5, comment: 'Project launch' });
    expect(c.subject).toBe('Time off cancelled: 2 Nov 2026 to 6 Nov 2026');
    expect(c.text).toContain('Marko Ilić cancelled your vacation for 2 Nov 2026 to 6 Nov 2026 in WBM. 5 working days went back to the balance.');
    const s = changedEmail({ ...base, to: 'marko@example.test', recipientName: 'Marko Ilić', self: false, employeeName: 'Ana Petrović', actorName: 'Admin Adams', change: 'shortened', what: 'vacation', startDate: '2026-11-02', endDate: '2026-11-06', newEndDate: '2026-11-04', returnedDays: 2, comment: 'Back early' });
    expect(s.subject).toBe("Time off shortened: Ana Petrović, 2 Nov 2026 to 6 Nov 2026");
    expect(s.text).toContain("Admin Adams shortened Ana Petrović's vacation in WBM: it now ends on 4 Nov 2026 instead of 6 Nov 2026. 2 working days went back to the balance.");
  });

  it('the reminder and the manager-absent notice list the requests', () => {
    const r = approvalReminderEmail({ ...base, to: 'marko@example.test', approverName: 'Marko Ilić', requests: [{ employeeName: 'Ana Petrović', what: 'vacation', startDate: '2026-11-02', endDate: '2026-11-06', workingDays: 5, submittedAt: '2026-10-10T08:00:00.000Z' }] });
    expect(r.subject).toBe('1 time off request waiting for you');
    expect(r.text).toContain('- Ana Petrović: vacation, 2 Nov 2026 to 6 Nov 2026 (5 working days), submitted 10 Oct 2026');
    const a = managerAbsentEmail({ ...base, to: 'admin@example.test', adminName: 'Admin Adams', requests: [{ employeeName: 'Ana Petrović', what: 'vacation', startDate: '2026-11-02', endDate: '2026-11-06', workingDays: 5, submittedAt: '2026-10-10T08:00:00.000Z', managerName: 'Marko Ilić' }] });
    expect(a.subject).toBe('1 time off request waiting while the manager is away');
    expect(a.text).toContain('their manager Marko Ilić is away');
  });
});
