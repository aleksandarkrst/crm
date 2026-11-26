// Unit tests of the Companies list (CD-533): the Last activity text, the amber note under an
// incomplete lead, the default order and the top bar search. `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayAgo, incompleteNote, LIST_STATUS_ORDER, lastActivityText, matchesSearch } from '../src/store/companyList.ts';

describe('Last activity', () => {
  it('says what and when, short as lists do', () => {
    assert.equal(lastActivityText({ channel: 'MT', day: '2026-11-22' }, '2026-11-24'), 'Meeting, 2 days ago');
    assert.equal(lastActivityText({ channel: 'PH', day: '2026-11-24' }, '2026-11-24'), 'Call, today');
    assert.equal(lastActivityText({ channel: 'EM', day: '2026-11-23' }, '2026-11-24'), 'Email, yesterday');
    assert.equal(lastActivityText({ channel: 'EM', day: '2026-10-30' }, '2026-11-24'), 'Email, 30 Oct');
    assert.equal(lastActivityText(null, '2026-11-24'), 'No activity yet');
  });

  it('counts calendar days across a month end', () => {
    assert.equal(dayAgo('2026-10-31', '2026-11-03'), '3 days ago');
    assert.equal(dayAgo('2026-11-11', '2026-11-24'), '13 days ago');
    assert.equal(dayAgo('2026-11-10', '2026-11-24'), '10 Nov');
  });
});

describe('the incomplete note', () => {
  it('names what a lead misses of its PIB, address and contact', () => {
    assert.equal(incompleteNote({ pib: true, address: true, contact: true }), 'Incomplete record, no PIB, address or contact');
    assert.equal(incompleteNote({ pib: true, address: false, contact: true }), 'Incomplete record, no PIB or contact');
    assert.equal(incompleteNote({ pib: false, address: true, contact: false }), 'Incomplete record, no address');
    assert.equal(incompleteNote({ pib: false, address: false, contact: false }), null);
  });
});

describe('the default order', () => {
  it('is clients, opportunities, past clients, leads, then not interested', () => {
    const order = (['lead', 'not_interested', 'client', 'past_client', 'opportunity'] as const).slice().sort((a, b) => LIST_STATUS_ORDER[a] - LIST_STATUS_ORDER[b]);
    assert.deepEqual(order, ['client', 'opportunity', 'past_client', 'lead', 'not_interested']);
  });
});

describe('the top bar search', () => {
  it('finds every word in any of the texts, without accents', () => {
    const vega = ['Vega Logistika', '104532877', 'Logistics', 'Šabac', 'Đorđe Petrović'];
    assert.ok(matchesSearch('vega sabac', vega));
    assert.ok(matchesSearch('djordje', vega));
    assert.ok(matchesSearch('dorde', vega));
    assert.ok(matchesSearch('1045', vega));
    assert.ok(matchesSearch('  ', vega));
    assert.ok(!matchesSearch('vega beograd', vega));
  });
});
