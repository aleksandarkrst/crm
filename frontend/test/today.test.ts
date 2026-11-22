// Today's groups, due tags and ticked to-dos (CD-532): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { daysBetween, dueTag, groupOf, leftText, minutesSuggestion, tickedToday } from '../src/store/today.ts';

const today = '2026-11-22'; // a Sunday

describe('Today groups (CD-532)', () => {
  it('Late is past its date, Today is today and later, After the win is any won opportunity', () => {
    assert.equal(groupOf({ dueIso: '2026-11-21', won: false, approval: false }, today), 'late');
    assert.equal(groupOf({ dueIso: today, won: false, approval: false }, today), 'today');
    assert.equal(groupOf({ dueIso: '2026-11-27', won: false, approval: false }, today), 'today');
    assert.equal(groupOf({ dueIso: '2026-11-01', won: true, approval: false }, today), 'won');
  });
  it('an approval waiting for you is today, however long ago it was asked for', () => {
    assert.equal(groupOf({ dueIso: '2026-11-18', won: false, approval: true }, today), 'today');
  });
});

describe('Due tags (CD-532)', () => {
  it('says how late, today, the weekday this week and the date further out', () => {
    assert.deepEqual(dueTag('2026-11-21', today), { text: '1 day late', tone: 'late' });
    assert.deepEqual(dueTag('2026-11-19', today), { text: '3 days late', tone: 'late' });
    assert.deepEqual(dueTag(today, today), { text: 'Today', tone: 'today' });
    assert.deepEqual(dueTag('2026-11-27', today), { text: 'Fri', tone: 'later' });
    assert.deepEqual(dueTag('2026-11-30', today), { text: '30 Nov', tone: 'later' });
    assert.deepEqual(dueTag('2026-11-19', today, true), { text: 'Done', tone: 'done' });
  });
  it('counts whole days across a month end', () => {
    assert.equal(daysBetween('2026-11-30', '2026-12-02'), 2);
  });
});

describe('Ticked to-dos stay until the day ends (CD-532)', () => {
  it('in the person’s own time zone', () => {
    // 23:30 UTC on the 21st is already the 22nd in Belgrade (UTC+1) but still the 21st in New York.
    const t = { done: true, doneAt: '2026-11-21T23:30:00Z' };
    assert.equal(tickedToday(t, today, 'Europe/Belgrade'), true);
    assert.equal(tickedToday(t, today, 'America/New_York'), false);
  });
  it('an open to-do, or one ticked yesterday, is not a ticked-today one', () => {
    assert.equal(tickedToday({ done: false, doneAt: '2026-11-22T09:00:00Z' }, today, 'UTC'), false);
    assert.equal(tickedToday({ done: true, doneAt: '2026-11-21T09:00:00Z' }, today, 'UTC'), false);
    assert.equal(tickedToday({ done: true }, today, 'UTC'), false);
  });
});

describe('Today texts (CD-532)', () => {
  it('counts what is left', () => {
    assert.equal(leftText(0), 'all done for today');
    assert.equal(leftText(1), '1 to-do left');
    assert.equal(leftText(4), '4 to-dos left');
  });
  it('suggests writing the minutes only when some are missing', () => {
    assert.equal(minutesSuggestion(0), null);
    assert.match(minutesSuggestion(1)!, /^1 meeting last week still has no minutes\./);
    assert.match(minutesSuggestion(2)!, /^2 meetings last week still have no minutes\. Clients get the PDF minutes the day you send them\.$/);
  });
});
