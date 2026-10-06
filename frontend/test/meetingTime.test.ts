// Unit tests of the meeting time helpers (CD-221): `npm test` in frontend (Node's test runner,
// TypeScript run as is by Node 24's type stripping).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultStart, endSlots, keepLength, lengthLabel, parseDate, parseTime, startInPeriod } from '../src/store/meetingTime.ts';
import { zonedToInstant } from '../src/store/time.ts';

const TZ = 'Europe/Belgrade';
const at = (date: string, time: string) => zonedToInstant(date, time, TZ);
const HOUR = 3_600_000;

describe('defaultStart (B8)', () => {
  it('is the next full hour during working hours', () => {
    assert.deepEqual(defaultStart(at('2026-10-06', '10:20'), TZ), { date: '2026-10-06', time: '11:00' });
    assert.deepEqual(defaultStart(at('2026-10-06', '15:59'), TZ), { date: '2026-10-06', time: '16:00' });
  });
  it('is 09:00 the same day before working hours', () => {
    assert.deepEqual(defaultStart(at('2026-10-06', '00:40'), TZ), { date: '2026-10-06', time: '09:00' });
    assert.deepEqual(defaultStart(at('2026-10-06', '07:10'), TZ), { date: '2026-10-06', time: '09:00' });
  });
  it('is 09:00 the next working day after working hours and at weekends', () => {
    assert.deepEqual(defaultStart(at('2026-10-06', '16:10'), TZ), { date: '2026-10-07', time: '09:00' });
    assert.deepEqual(defaultStart(at('2026-10-06', '23:50'), TZ), { date: '2026-10-07', time: '09:00' });
    // Friday evening, Saturday and Sunday: Monday.
    assert.deepEqual(defaultStart(at('2026-10-09', '18:00'), TZ), { date: '2026-10-12', time: '09:00' });
    assert.deepEqual(defaultStart(at('2026-10-10', '11:00'), TZ), { date: '2026-10-12', time: '09:00' });
    assert.deepEqual(defaultStart(at('2026-10-11', '08:00'), TZ), { date: '2026-10-12', time: '09:00' });
  });
});

describe('startInPeriod (B9)', () => {
  it('is the first working day of a later period at 09:00', () => {
    // November 2026 starts on a Sunday: Monday 2 November.
    assert.deepEqual(startInPeriod('2026-11-01', '2026-12-01', at('2026-10-06', '10:00'), TZ), { date: '2026-11-02', time: '09:00' });
    assert.deepEqual(startInPeriod('2026-10-01', '2027-01-01', at('2026-09-20', '10:00'), TZ), { date: '2026-10-01', time: '09:00' });
  });
  it('is the default start when today is in the period', () => {
    assert.deepEqual(startInPeriod('2026-10-01', '2026-11-01', at('2026-10-06', '10:20'), TZ), { date: '2026-10-06', time: '11:00' });
  });
  it('stays in the period when today is its last day after hours', () => {
    assert.deepEqual(startInPeriod('2026-10-01', '2026-11-01', at('2026-10-30', '18:00'), TZ), { date: '2026-10-01', time: '09:00' });
  });
});

describe('keepLength (B7)', () => {
  it('moves the end with the start', () => {
    assert.equal(keepLength(at('2026-10-06', '00:30'), at('2026-10-06', '09:30'), at('2026-10-06', '10:00')), at('2026-10-06', '19:00'));
  });
  it('makes an hour of a length that is not valid', () => {
    assert.equal(keepLength(at('2026-10-06', '10:00'), at('2026-10-06', '09:30'), at('2026-10-06', '11:00')), at('2026-10-06', '12:00'));
  });
});

describe('endSlots', () => {
  it('lists quarter hours after the start with the length, marking the next day', () => {
    const slots = endSlots(at('2026-10-06', '23:00'), TZ);
    assert.deepEqual(slots[0], { at: at('2026-10-06', '23:15'), time: '23:15', label: '15 min', nextDay: false });
    assert.equal(slots[3]!.time, '00:00');
    assert.equal(slots[3]!.nextDay, true);
    assert.equal(slots[5]!.label, '1 h 30 min');
    assert.equal(slots.length, 96);
    assert.equal(slots.at(-1)!.at - at('2026-10-06', '23:00'), 24 * HOUR);
  });
  it('labels lengths', () => {
    assert.equal(lengthLabel(45), '45 min');
    assert.equal(lengthLabel(60), '1 h');
    assert.equal(lengthLabel(150), '2 h 30 min');
  });
});

describe('parseTime', () => {
  it('reads 24-hour times in many spellings', () => {
    for (const [text, time] of [
      ['9', '09:00'],
      ['09', '09:00'],
      ['930', '09:30'],
      ['0930', '09:30'],
      ['9:30', '09:30'],
      ['9.30', '09:30'],
      ['21:15', '21:15'],
      ['0:00', '00:00'],
      ['9:30 pm', '21:30'],
      ['12am', '00:00'],
      ['12 pm', '12:00'],
    ])
      assert.equal(parseTime(text!), time, text);
  });
  it('refuses what is not a time', () => {
    for (const text of ['', '24:00', '9:75', 'noon', '13pm', '1:2']) assert.equal(parseTime(text), null, text);
  });
});

describe('parseDate', () => {
  const today = '2026-10-06';
  it('reads ISO, day-first numbers and words', () => {
    for (const [text, iso] of [
      ['2026-10-09', '2026-10-09'],
      ['9.10.2026', '2026-10-09'],
      ['09.10.2026.', '2026-10-09'],
      ['9/10/26', '2026-10-09'],
      ['9.10.', '2026-10-09'],
      ['9 Oct 2026', '2026-10-09'],
      ['Fri 9 Oct 2026', '2026-10-09'],
      ['Oct 9, 2026', '2026-10-09'],
      ['9 october', '2026-10-09'],
    ])
      assert.equal(parseDate(text!, today), iso, text);
  });
  it('refuses what is not a date', () => {
    for (const text of ['', '31.2.2026', '2026-13-01', 'tomorrow', '9 foo 2026']) assert.equal(parseDate(text, today), null, text);
  });
});
