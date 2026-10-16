import { describe, expect, it } from 'vitest';
import { balanceAdjustedEmail, carryOverExpiringEmail } from '../src/modules/timeoff/balance-emails';

describe('balance emails (spec 15.2)', () => {
  it('"Balance adjusted" names the change, the reason and what remains', () => {
    const m = balanceAdjustedEmail({ to: 'ana@example.test', employeeName: 'Ana Petrović', actorName: 'Marko Ilić', workspaceName: 'WBM', appUrl: 'https://app.pultly.com/', poolYear: 2026, days: -3, kind: 'opening_balance', reason: 'Used before Pultly', remaining: 17, available: 15 });
    expect(m.subject).toBe('Your vacation balance for 2026 was adjusted: -3 days');
    expect(m.text).toContain('Hi Ana,');
    expect(m.text).toContain('Marko Ilić adjusted your vacation balance in WBM.');
    expect(m.text).toContain('- Opening balance: -3 days on the 2026 pool');
    expect(m.text).toContain('- Reason: Used before Pultly');
    expect(m.text).toContain('Remaining now: 17 days (15 days available to request)');
    expect(m.text).toContain('https://app.pultly.com/timeoff');
    expect(m.html).toContain('Marko Ilić');
    expect(balanceAdjustedEmail({ to: 'a', employeeName: 'A B', actorName: null, workspaceName: 'W', appUrl: 'http://x', poolYear: 2026, days: 1, kind: 'extra_days', reason: 'r', remaining: 1, available: 1 }).text).toContain('Pultly adjusted');
  });

  it('"Carry-over expiring" says how many days and until when', () => {
    const m = carryOverExpiringEmail({ to: 'ana@example.test', employeeName: 'Ana Petrović', workspaceName: 'WBM', appUrl: 'https://app.pultly.com', year: 2026, expiring: 1 });
    expect(m.subject).toBe('1 vacation day from 2025 expire on 30 June');
    expect(m.text).toContain('You still have 1 day carried over from 2025 in WBM. They can be used until 30 June 2026; after that they expire.');
    expect(m.text).toContain('"Time off balance" setting');
  });
});
