// Unit tests of the company page's History (CD-534): one sentence per change, the merge with the
// activity, "Show N more" and the time text. `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activitySentence, changeSentence, historyRows, visibleRows, whenText } from '../src/store/companyHistory.ts';

const nikola = { userId: 'u1', name: 'Nikola Kostić' };
const change = (over: Record<string, unknown>) => ({ id: 'x', action: 'updated' as const, field: 'name', oldValue: null, newValue: null, oldLabel: null, newLabel: null, label: null, actor: nikola, changedAt: '2026-10-30T10:02:00Z', ...over });

describe('one sentence per change', () => {
  it('names the field, the old and the new value, "empty" for none', () => {
    assert.equal(changeSentence(change({ field: 'address', newValue: 'Industrijska 2' })), 'Nikola Kostić changed Street from empty to Industrijska 2');
    assert.equal(changeSentence(change({ field: 'postalCode', oldValue: '21000', newValue: '21400' })), 'Nikola Kostić changed Postal code from 21000 to 21400');
    assert.equal(changeSentence(change({ field: 'ownershipType', oldValue: 'private', newValue: 'state' })), 'Nikola Kostić changed Ownership from Private to Public');
    assert.equal(changeSentence(change({ field: 'ownerUserId', oldValue: 'u1', newValue: 'u2', oldLabel: 'Nikola Kostić', newLabel: 'Ana Petrović' })), 'Nikola Kostić changed Company owner from Nikola Kostić to Ana Petrović');
    assert.equal(changeSentence(change({ field: 'source', newValue: 'Trade fair', actor: null })), 'System changed Source from empty to Trade fair');
    assert.equal(changeSentence(change({ action: 'created', label: 'Tarkett' })), 'Nikola Kostić created the company');
  });

  it('says who added or removed a contact, and a role change (the contacts trigger, CD-534)', () => {
    const marko = { id: 'c1', name: 'Marko Stanić' };
    assert.equal(changeSentence(change({ field: 'contact', newValue: marko })), 'Nikola Kostić added Marko Stanić as a contact');
    assert.equal(changeSentence(change({ field: 'contact', oldValue: marko })), 'Nikola Kostić removed Marko Stanić as a contact');
    assert.equal(changeSentence(change({ field: 'contactRole', label: 'Marko Stanić', oldValue: null, newValue: 'User' })), "Nikola Kostić changed Marko Stanić's role in the decision from empty to User");
    assert.equal(changeSentence(change({ action: 'deleted' })), null);
  });

  it('reads an activity or status entry as one line with a comma, not a middle dot', () => {
    assert.equal(activitySentence({ title: 'Status: Opportunity · automatic', detail: 'Was Lead.' }), 'Status: Opportunity, automatic (was Lead)');
    assert.equal(activitySentence({ title: 'Call with Dragana Popov', detail: '  interested in floor waste analytics ' }), 'Call with Dragana Popov: interested in floor waste analytics');
    assert.equal(activitySentence({ title: 'Email sent', detail: '' }), 'Email sent');
  });
});

describe('the list', () => {
  it('merges changes and activity newest first, entries without a time on top', () => {
    const rows = historyRows(
      [change({ id: 'a', field: 'city', newValue: 'Bačka Palanka', changedAt: '2026-10-29T15:00:00Z' }), change({ id: 'b', action: 'deleted', changedAt: '2026-10-31T15:00:00Z' })],
      [
        { date: '30 Oct', channel: 'PH', title: 'Call', detail: 'ok', actor: 'Nikola Kostić', at: '2026-10-30T09:00:00Z' },
        { date: 'Today', channel: 'NT', title: 'Note', detail: '', actor: 'Ana', at: undefined },
      ],
    );
    assert.deepEqual(
      rows.map((r) => r.text),
      ['Note', 'Call: ok', 'Nikola Kostić changed City from empty to Bačka Palanka'],
    );
  });

  it('shows four rows, then "Show N more" counts the rest and the pages not loaded yet', () => {
    const rows = [1, 2, 3, 4, 5, 6];
    assert.deepEqual(visibleRows(rows, false), { shown: [1, 2, 3, 4], hidden: 2 });
    assert.deepEqual(visibleRows(rows, false, 4, 30), { shown: [1, 2, 3, 4], hidden: 32 });
    assert.deepEqual(visibleRows(rows, true), { shown: rows, hidden: 0 });
    assert.deepEqual(visibleRows([1, 2], false), { shown: [1, 2], hidden: 0 });
  });

  it('writes the time as "30 Oct, 11:02" in the workspace time zone', () => {
    assert.equal(whenText('2026-10-30T10:02:00Z', 'Europe/Belgrade'), '30 Oct, 11:02');
    assert.equal(whenText('9'), '');
    assert.equal(whenText(''), '');
  });
});
