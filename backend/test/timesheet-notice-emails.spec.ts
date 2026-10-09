import { describe, expect, it } from 'vitest';
import { autoSubmittedEmail, lateEmail, lateSummaryEmail, missingText, reminderEmail } from '../src/modules/timesheet/notice-emails';

const common = { to: 'dragan@example.test', recipientName: 'Dragan Milić', workspaceName: 'West Balkans Machinery', appUrl: 'https://app.pultly.com/', timeFormat: 'decimal' as const };
const week = { weekStart: '2026-10-05', weekNumber: 41, deadline: { date: '2026-10-09', time: '17:00' }, enteredMinutes: 1890, expectedMinutes: 1920, missing: ['2026-10-09'] };

describe('timesheet emails (CD-154)', () => {
  it('the reminder names the week, the deadline, the hours so far and what is missing', () => {
    const m = reminderEmail(common, week);
    expect(m.subject).toBe('Reminder: submit your timesheet for week 41 by Fri 17:00');
    expect(m.text).toContain('Hi Dragan,');
    expect(m.text).toContain('Your timesheet for week 41 (5 to 11 Oct) is due Fri 9 Oct at 17:00.');
    expect(m.text).toContain('Entered so far: 31.5 of 32 h');
    expect(m.text).toContain('Missing: Friday');
    expect(m.text).toContain('Open timesheet: https://app.pultly.com/timesheet?week=2026-10-05');
    expect(m.html).toContain('Open timesheet');
  });

  it('the late email says submitting is still possible but marked late', () => {
    const m = lateEmail({ ...common, timeFormat: 'clock' }, { ...week, enteredMinutes: 720, missing: ['2026-10-07', '2026-10-08', '2026-10-09'] });
    expect(m.subject).toBe('Your timesheet for week 41 is late');
    expect(m.text).toContain('You can still submit, but the week will be marked as submitted late.');
    expect(m.text).toContain('Entered so far: 12:00 of 32:00 h');
    expect(m.text).toContain('Missing: Wed, Thu, Fri');
  });

  it('the auto-submitted email', () => {
    const m = autoSubmittedEmail(common, week);
    expect(m.subject).toBe('Your timesheet for week 41 was submitted automatically');
    expect(m.text).toContain('It is marked as submitted late.');
  });

  it("the approver's summary lists each late person", () => {
    const m = lateSummaryEmail({ ...common, recipientName: 'Marko Ilić' }, week, [
      { name: 'Bojan Đurić', enteredMinutes: 720, autoSubmitted: false },
      { name: 'Ivan Popović', enteredMinutes: 2280, autoSubmitted: true },
    ]);
    expect(m.subject).toBe('Late timesheets for week 41');
    expect(m.text).toContain('These people you approve for missed the deadline for week 41 (5 to 11 Oct).');
    expect(m.text).toContain('Bojan Đurić: not submitted · 12 h');
    expect(m.text).toContain('Ivan Popović: auto-submitted (late)');
    expect(m.html).not.toContain('<script');
  });

  it('escapes names in the HTML', () => {
    const m = lateSummaryEmail(common, week, [{ name: '<b>Eve</b>', enteredMinutes: 0, autoSubmitted: false }]);
    expect(m.html).toContain('&lt;b&gt;Eve&lt;/b&gt;');
  });

  it('names one missing day in full, several short', () => {
    expect(missingText(['2026-10-09'])).toBe('Friday');
    expect(missingText(['2026-10-05', '2026-10-06'])).toBe('Mon, Tue');
  });
});
