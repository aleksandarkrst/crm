// Unit tests of the shared filter row's logic (CD-366): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allOpen, applyFilters, canClear, chipLabel, clearAll, collapseVals, type FilterField, fold, type FilterValue, GROUP, markSeen, matchField, notApplied, presetRange, rangeInput, rangeProblem, pruneList, restoreValue, valueText, withNewSubs } from '../src/store/filters.ts';

interface Rec {
  stage: string;
  owner: string | null;
  people: string[];
  site: string;
  done: boolean;
  value: number | null;
  close: string;
  funnel: string;
}

const STAGES = [
  { id: 'new', name: 'New', sub: true },
  { id: 'proposal', name: 'Proposal', sub: true },
  { id: 'won', name: 'Won' },
  { id: 'lost', name: 'Lost' },
];
const fields: FilterField<Rec>[] = [
  { id: 'funnel', label: 'Funnel', group: 'Opportunity', kind: 'list', single: true, pinned: true, options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], get: (r) => r.funnel },
  { id: 'owner', label: 'Salesperson', group: 'Opportunity', kind: 'person', pinned: true, get: (r) => r.owner },
  { id: 'stage', label: 'Status', group: 'Opportunity', kind: 'list', groupLabel: 'Open', options: STAGES, get: (r) => r.stage },
  { id: 'people', label: 'People', group: 'Meeting', kind: 'person', get: (r) => r.people },
  { id: 'site', label: 'Website', group: 'Company', kind: 'text', get: (r) => r.site },
  { id: 'done', label: 'Done', group: 'Task', kind: 'checkbox', get: (r) => r.done },
  { id: 'value', label: 'Value', group: 'Opportunity', kind: 'number', unit: '€', get: (r) => r.value },
  { id: 'close', label: 'Closing date', group: 'Opportunity', kind: 'date', get: (r) => r.close },
];
const fd = (id: string) => fields.find((f) => f.id === id)! as FilterField<never>;
const ctx = { today: '2026-10-24' };
const rec = (o: Partial<Rec>): Rec => ({ stage: 'new', owner: 'u1', people: [], site: '', done: false, value: null, close: '', funnel: 'a', ...o });

describe('list filters', () => {
  it('is keeps the ticked values, is not leaves them out', () => {
    assert.equal(matchField(fd('stage'), { op: 'is', vals: ['won'] }, 'won', ctx), true);
    assert.equal(matchField(fd('stage'), { op: 'is', vals: ['won'] }, 'new', ctx), false);
    assert.equal(matchField(fd('stage'), { op: 'isnot', vals: ['lost'] }, 'lost', ctx), false);
    assert.equal(matchField(fd('stage'), { op: 'isnot', vals: ['lost'] }, 'new', ctx), true);
  });

  it('nothing ticked matches everything, also with is not', () => {
    assert.equal(matchField(fd('stage'), { op: 'isnot', vals: [] }, 'lost', ctx), true);
  });

  it('the label says the operator, the value groups the open stages', () => {
    assert.equal(chipLabel(fd('stage'), { op: 'isnot', vals: ['lost'] }), 'Status is not');
    assert.equal(valueText(fd('stage'), { op: 'is', vals: ['new', 'proposal', 'won'] }), 'Open, Won');
    assert.equal(valueText(fd('stage'), { op: 'is', vals: ['new', 'won', 'lost'] }), '3 selected');
    assert.equal(valueText(fd('stage'), { op: 'is', vals: [] }), 'Any');
  });
});

describe('person filters', () => {
  it('matches the owner, or any of several people on the record', () => {
    assert.equal(matchField(fd('owner'), { vals: ['u1', 'u2'] }, 'u2', ctx), true);
    assert.equal(matchField(fd('owner'), { vals: ['u1'] }, null, ctx), false);
    assert.equal(matchField(fd('people'), { vals: ['u3'] }, ['u1', 'u3'], ctx), true);
  });

  it('matches a text without accents or case (CD-478)', () => {
    assert.equal(matchField(fd('site'), { op: 'contains', text: 'sabac' }, 'Mlekara Šabac', ctx), true);
    assert.equal(matchField(fd('site'), { op: 'contains', text: 'ŠABAC' }, 'mlekara sabac', ctx), true);
    assert.equal(matchField(fd('site'), { op: 'contains', text: 'djordje' }, 'Đorđe d.o.o.', ctx), true);
    assert.equal(matchField(fd('site'), { op: 'contains', text: 'novi sad' }, 'Mlekara Šabac', ctx), false);
  });

  it('folds đ the way people type it, as d or dj (CD-504)', () => {
    for (const typed of ['Dordevic', 'djordjevic', 'Đorđević', 'DJORĐEVIĆ']) assert.equal(fold(typed), 'dordevic', typed);
    assert.ok(fold('Ana Đorđević').includes(fold('Ana Dor')));
    assert.ok(fold('Ana Petrović').includes(fold('Petrovic')));
    assert.equal(matchField(fd('site'), { op: 'contains', text: 'dorde' }, 'Đorđe d.o.o.', ctx), true);
  });

  it('says Me for the current user, first names for others, then a count', () => {
    const personName = (id: string) => ({ u1: 'Aleksandar Krstić', u2: 'Ana Petrović', u3: 'Marko Jovanović' })[id] ?? id;
    assert.equal(valueText(fd('owner'), { vals: ['u1', 'u2'] }, { me: 'u1', personName }), 'Me, Ana');
    assert.equal(valueText(fd('owner'), { vals: ['u1', 'u2', 'u3'] }, { me: 'u1', personName }), '3 people');
  });
});

describe('text filters', () => {
  it('contains ignores case and spaces around the text', () => {
    assert.equal(matchField(fd('site'), { op: 'contains', text: ' ACME ' }, 'www.acme.com', ctx), true);
    assert.equal(matchField(fd('site'), { op: 'contains', text: 'acme' }, 'other.com', ctx), false);
    assert.equal(chipLabel(fd('site'), { op: 'contains', text: 'acme' }), 'Website contains');
    assert.equal(chipLabel(fd('site'), { op: 'contains', text: '' }), 'Website');
  });

  it('is empty and is not empty', () => {
    assert.equal(matchField(fd('site'), { op: 'isempty' }, '', ctx), true);
    assert.equal(matchField(fd('site'), { op: 'isempty' }, null, ctx), true);
    assert.equal(matchField(fd('site'), { op: 'isempty' }, 'acme.com', ctx), false);
    assert.equal(matchField(fd('site'), { op: 'notempty' }, 'acme.com', ctx), true);
    assert.equal(matchField(fd('site'), { op: 'notempty' }, '  ', ctx), false);
  });
});

describe('checkbox filters', () => {
  it('Yes matches ticked, No matches unticked and unset', () => {
    assert.equal(matchField(fd('done'), { vals: ['yes'] }, true, ctx), true);
    assert.equal(matchField(fd('done'), { vals: ['yes'] }, false, ctx), false);
    assert.equal(matchField(fd('done'), { vals: ['no'] }, undefined, ctx), true);
    assert.equal(valueText(fd('done'), { vals: ['no'] }), 'No');
  });
});

describe('number filters', () => {
  it('at least and at most, inclusive; no value never matches', () => {
    assert.equal(matchField(fd('value'), { min: '1000' }, 1000, ctx), true);
    assert.equal(matchField(fd('value'), { min: '1000' }, 999, ctx), false);
    assert.equal(matchField(fd('value'), { max: '5000' }, 5001, ctx), false);
    assert.equal(matchField(fd('value'), { min: '1000', max: '5000' }, 3000, ctx), true);
    assert.equal(matchField(fd('value'), { min: '1' }, null, ctx), false);
  });

  it('writes the range short, in the currency', () => {
    assert.equal(valueText(fd('value'), { min: '10000', max: '25000' }), '€10k–€25k');
    assert.equal(valueText(fd('value'), { min: '1500' }), 'at least €1.5k');
    assert.equal(valueText(fd('value'), { max: '900' }), 'at most €900');
  });
});

describe('date presets', () => {
  it('weeks run Monday to Sunday, also across a month end', () => {
    assert.deepEqual(presetRange('week', '2026-10-24'), { from: '2026-10-19', to: '2026-10-25' });
    assert.deepEqual(presetRange('week', '2026-10-19'), { from: '2026-10-19', to: '2026-10-25' });
    assert.deepEqual(presetRange('week', '2026-10-25'), { from: '2026-10-19', to: '2026-10-25' });
    assert.deepEqual(presetRange('week', '2026-11-01'), { from: '2026-10-26', to: '2026-11-01' });
    assert.deepEqual(presetRange('week', '2026-12-31'), { from: '2026-12-28', to: '2027-01-03' });
  });

  it('month, quarter (fiscal too), last and next 30 days, before today', () => {
    assert.deepEqual(presetRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(presetRange('quarter', '2026-10-24'), { from: '2026-10-01', to: '2026-12-31' });
    assert.deepEqual(presetRange('quarter', '2026-10-24', 4), { from: '2026-10-01', to: '2026-12-31' });
    assert.deepEqual(presetRange('quarter', '2026-01-15', 2), { from: '2025-11-01', to: '2026-01-31' });
    assert.deepEqual(presetRange('last30', '2026-10-24'), { from: '2026-09-24', to: '2026-10-24' });
    assert.deepEqual(presetRange('next30', '2026-10-24'), { from: '2026-10-24', to: '2026-11-23' });
    assert.deepEqual(presetRange('before', '2026-10-24'), { from: '0000-01-01', to: '2026-10-23' });
  });

  it('a relative preset follows today; records with no date never match', () => {
    const today = { preset: 'today' as const };
    assert.equal(matchField(fd('close'), today, '2026-10-24', { today: '2026-10-24' }), true);
    assert.equal(matchField(fd('close'), today, '2026-10-24', { today: '2026-10-25' }), false);
    assert.equal(matchField(fd('close'), today, '', ctx), false);
    assert.equal(matchField(fd('close'), { preset: 'before' }, '2026-10-23T09:00:00Z', ctx), true);
  });

  it('a custom range may be open on one side', () => {
    assert.equal(matchField(fd('close'), { preset: 'custom', from: '2026-10-01' }, '2026-12-01', ctx), true);
    assert.equal(matchField(fd('close'), { preset: 'custom', to: '2026-10-01' }, '2026-12-01', ctx), false);
    assert.equal(matchField(fd('close'), { preset: 'custom' }, '', ctx), true); // no dates yet: not active
    assert.equal(valueText(fd('close'), { preset: 'custom', from: '2026-10-01' }), 'From 1 Oct');
    assert.equal(valueText(fd('close'), { preset: 'custom', to: '2026-10-01' }), 'Until 1 Oct');
    assert.equal(valueText(fd('close'), { preset: 'custom', from: '2026-10-01', to: '2026-12-31' }), '1 Oct – 31 Dec');
  });
});

describe('the whole "Open" group', () => {
  const later = [...STAGES.slice(0, 2), { id: 'negotiation', name: 'Negotiation', sub: true }, ...STAGES.slice(2)];
  const status = (options: typeof STAGES) => ({ ...fd('stage'), options }) as FilterField<never>;

  it('is saved as one value, so a stage added later is still part of Open', () => {
    assert.deepEqual(collapseVals(fd('stage'), ['new', 'proposal', 'won']), [GROUP, 'won']);
    const saved = { op: 'is' as const, vals: [GROUP, 'won'] };
    assert.equal(matchField(status(later), saved, 'negotiation', ctx), true);
    assert.equal(matchField(status(later), saved, 'lost', ctx), false);
    assert.equal(valueText(status(later), saved), 'Open, Won');
  });

  it('a saved value drops stages its funnel no longer has, keeping Open; nothing left gives the fallback', () => {
    const rows: FilterField<Rec>[] = [{ ...fields[2]!, options: later }];
    const value: FilterValue = { order: ['stage'], f: { stage: { op: 'is', vals: [GROUP, 'gone', 'won'] } } };
    assert.deepEqual(pruneList(rows, value, 'stage').f.stage?.vals, [GROUP, 'won']);
    const stale: FilterValue = { order: ['stage'], f: { stage: { op: 'is', vals: ['gone'] } } };
    assert.deepEqual(pruneList(rows, stale, 'stage', [GROUP, 'won']).f.stage?.vals, [GROUP, 'won']);
  });
});

describe('new stages and another funnel (owner, 25 Oct)', () => {
  const later = [...STAGES.slice(0, 2), { id: 'negotiation', name: 'Negotiation', sub: true }, ...STAGES.slice(2)];
  const before: FilterField<Rec>[] = [fields[2]!];
  const after: FilterField<Rec>[] = [{ ...fields[2]!, options: later }];

  it('a stage added after saving is ticked, even when only some stages were', () => {
    const saved = markSeen(before, { order: ['stage'], f: { stage: { op: 'is', vals: ['new', 'won'] } } }, 'stage');
    assert.deepEqual(withNewSubs(after, saved, 'stage').f.stage?.vals, ['new', 'won', 'negotiation']);
    // Saved before stages were remembered: every stage not ticked counts as new.
    const old: FilterValue = { order: ['stage'], f: { stage: { op: 'is', vals: ['new', 'proposal', 'won'] } } };
    assert.deepEqual(withNewSubs(after, old, 'stage').f.stage?.vals, [GROUP, 'won']);
    // Not for "is not": that would hide the new stage.
    const not: FilterValue = { order: ['stage'], f: { stage: { op: 'isnot', vals: ['new'] } } };
    assert.equal(withNewSubs(after, not, 'stage'), not);
  });

  it('another funnel ticks all of its Open stages and keeps Won and Lost', () => {
    const value: FilterValue = { order: ['stage'], f: { stage: { op: 'is', vals: ['new', '__won', '__lost'] } } };
    assert.deepEqual(allOpen(value, 'stage').f.stage?.vals, [GROUP, '__won', '__lost']);
  });
});

describe('the row', () => {
  const value: FilterValue = {
    order: ['funnel', 'owner', 'stage', 'site'],
    f: { funnel: { vals: ['b'] }, owner: { vals: ['u1'] }, stage: { op: 'isnot', vals: ['lost'] }, site: { op: 'contains', text: 'acme' } },
  };

  it('combines every chip with AND', () => {
    const rows = [rec({ funnel: 'b', site: 'acme.com' }), rec({ funnel: 'b', site: 'acme.com', stage: 'lost' }), rec({ funnel: 'a', site: 'acme.com' }), rec({ funnel: 'b', site: 'acme.com', owner: 'u2' })];
    assert.equal(applyFilters(rows, fields, value, ctx).length, 1);
  });

  it('Clear filters empties the pinned chips and removes added ones', () => {
    assert.equal(canClear(fields, value), true);
    const cleared = clearAll(fields);
    assert.deepEqual(cleared.order, ['funnel', 'owner']);
    assert.deepEqual(cleared.f.owner, { op: 'is', vals: [] });
    assert.equal(canClear(fields, cleared), false);
  });

  it('a saved value keeps the pinned chips first and falls back to the defaults when unreadable', () => {
    const defaults: FilterValue = { order: ['funnel', 'owner'], f: { funnel: { vals: ['a'] }, owner: { vals: ['u1'] } } };
    assert.equal(restoreValue('nonsense', defaults), defaults);
    assert.equal(restoreValue({ order: 'x', f: {} }, defaults), defaults);
    const restored = restoreValue({ order: ['site', 'owner', 'site'], f: { owner: { vals: [] }, site: { op: 'isempty' } } }, defaults);
    assert.deepEqual(restored.order, ['funnel', 'owner', 'site']);
    assert.deepEqual(restored.f.owner, { vals: [] });
    assert.deepEqual(restored.f.funnel, { vals: ['a'] });
  });
});

describe('invalid ranges (CD-507)', () => {
  const recs = [rec({ value: 50, close: '2026-06-01' }), rec({ value: 500, close: '2026-12-31' })];
  const row = (id: string, v: Record<string, string>): FilterValue => ({ order: [id], f: { [id]: v } });
  const closeRange = (from: string, to: string) => ({ preset: 'custom' as const, from, to });

  it('does not apply a custom range whose From is after its To, and says so', () => {
    const v = closeRange('2026-12-31', '2026-01-01');
    assert.match(rangeProblem(fd('close'), v) ?? '', /From is after To/);
    assert.equal(notApplied(fd('close'), v), true);
    assert.equal(valueText(fd('close'), v), 'Not applied');
    assert.equal(applyFilters(recs, fields, row('close', v), ctx).length, 2);
  });

  it('does not apply a date with a five-digit year', () => {
    const v = closeRange('2026-01-01', '99999-12-31');
    assert.match(rangeProblem(fd('close'), v) ?? '', /four-digit year/);
    assert.equal(valueText(fd('close'), v), 'Not applied');
  });

  it('does not apply At least above At most', () => {
    const v = { min: '1000', max: '100' };
    assert.match(rangeProblem(fd('value'), v) ?? '', /more than/);
    assert.equal(valueText(fd('value'), v), 'Not applied');
    assert.equal(applyFilters(recs, fields, row('value', v), ctx).length, 2);
  });

  it('refuses an amount above the largest value', () => {
    assert.match(rangeProblem(fd('value'), { min: '100000000000000000000' }) ?? '', /at most 999,999,999,999.99/);
    assert.equal(rangeProblem(fd('value'), { max: '999999999999' }), null);
    assert.equal(valueText(fd('value'), { max: '999999999999' }), 'at most €1000bn');
  });

  it('keeps the minus of -5 and refuses it for Value', () => {
    assert.equal(rangeInput('-5'), '-5');
    assert.equal(rangeInput('€ 1 500,5x'), '1500,5');
    assert.match(rangeProblem(fd('value'), { min: '-5' }) ?? '', /can't be negative/);
    assert.match(rangeProblem(fd('value'), { min: '5-' }) ?? '', /numbers only/);
  });

  it('still applies a valid range, with a decimal comma', () => {
    assert.equal(rangeProblem(fd('value'), { min: '12,5', max: '600' }), null);
    assert.equal(applyFilters(recs, fields, row('value', { min: '12,5', max: '100' }), ctx).length, 1);
  });

  it('keeps Clear filters for a pinned range that is not applied', () => {
    const pinned = fields.map((f) => (f.id === 'value' ? { ...f, pinned: true } : f));
    assert.equal(canClear(pinned, row('value', { min: '1000', max: '100' })), true);
    assert.equal(canClear(pinned, row('value', {})), false);
  });

  it('names the year when a range is not all in this one', () => {
    assert.equal(valueText(fd('close'), closeRange('2026-10-01', '2026-12-31'), { today: '2026-11-11' }), '1 Oct – 31 Dec');
    assert.equal(valueText(fd('close'), closeRange('2026-12-01', '2027-01-15'), { today: '2026-11-11' }), '1 Dec 2026 – 15 Jan 2027');
    assert.equal(valueText(fd('close'), { preset: 'custom', from: '2027-03-01' }, { today: '2026-11-11' }), 'From 1 Mar 2027');
  });
});
