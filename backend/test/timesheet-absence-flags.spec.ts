import { describe, expect, it } from 'vitest';
import { absenceFlags } from '../src/modules/timesheet/timesheet.service';

const ev = (kind: string, comment: string | null = null) => ({ kind, comment });

describe('absence flags (spec 14.3)', () => {
  it('a Draft or Rejected day carries no flags', () => {
    expect(absenceFlags('draft', [ev('absence_changed', 'Vacation added')], true, 0, 480)).toEqual([]);
    expect(absenceFlags('rejected', [ev('submitted'), ev('returned'), ev('absence_changed', 'Vacation added')], true, 0, 480)).toEqual([]);
  });

  it('changes since the last submission or approval, in order', () => {
    expect(absenceFlags('submitted', [ev('submitted'), ev('absence_changed', 'Vacation added')], true, 0, 480)).toEqual(['Changed after submission: Vacation added']);
    // A change before the approval isn't news after it.
    expect(absenceFlags('approved', [ev('submitted'), ev('absence_changed', 'Vacation added'), ev('approved')], true, 0, 480)).toEqual([]);
    expect(absenceFlags('approved', [ev('approved'), ev('absence_changed', 'Sick leave added'), ev('absence_changed', 'Sick leave removed')], false, 0, 480)).toEqual([
      'Changed after approval: Sick leave added, Sick leave removed',
      'Missing hours after absence removed',
    ]);
  });

  it('an approved day with an absence and task hours is a conflict; one with hours left isn\'t missing any', () => {
    expect(absenceFlags('approved', [ev('approved'), ev('absence_changed', 'Sick leave added')], true, 480, 480)).toEqual(['Changed after approval: Sick leave added', 'Conflict: absence and task hours']);
    expect(absenceFlags('approved', [ev('approved'), ev('absence_changed', 'Vacation removed')], false, 240, 480)).toEqual(['Changed after approval: Vacation removed']);
  });
});
