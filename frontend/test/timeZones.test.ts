// The time-zone picker's list (CD-488): `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allTimeZones, matchesZone, parseOffset, timeZoneOption, zoneSections } from '../src/lib/timeZones.ts';

const JAN = new Date('2026-01-15T12:00:00Z');

describe('time zones (CD-488)', () => {
  it('reads Intl offsets', () => {
    assert.deepEqual(parseOffset('GMT+1'), { offset: 'UTC+1', minutes: 60 });
    assert.deepEqual(parseOffset('GMT+5:30'), { offset: 'UTC+5:30', minutes: 330 });
    assert.deepEqual(parseOffset('GMT-3'), { offset: 'UTC-3', minutes: -180 });
    assert.deepEqual(parseOffset('GMT'), { offset: 'UTC', minutes: 0 });
  });

  it('labels a zone with its city, region and offset; old names show as today', () => {
    assert.deepEqual(timeZoneOption('Europe/Belgrade', JAN), { id: 'Europe/Belgrade', city: 'Belgrade', region: 'Europe', offset: 'UTC+1', minutes: 60 });
    const asmera = timeZoneOption('Africa/Asmera', JAN);
    assert.equal(asmera.id, 'Africa/Asmera');
    assert.equal(asmera.city, 'Asmara');
    assert.equal(timeZoneOption('America/Argentina/Buenos_Aires', JAN).city, 'Argentina / Buenos Aires');
    assert.equal(timeZoneOption('UTC', JAN).city, 'UTC');
  });

  it('searches by city, old name, region or offset', () => {
    const kiev = timeZoneOption('Europe/Kiev', JAN);
    assert.ok(matchesZone(kiev, 'kyiv'));
    assert.ok(matchesZone(kiev, 'Kiev'));
    assert.ok(matchesZone(timeZoneOption('America/New_York', JAN), 'new york'));
    assert.ok(matchesZone(timeZoneOption('Europe/Belgrade', JAN), 'utc+1'));
    assert.ok(!matchesZone(timeZoneOption('Europe/Belgrade', JAN), 'london'));
  });

  it('puts the suggested zones first and lists the rest once', () => {
    const all = allTimeZones(JAN);
    assert.ok(all.length > 300);
    assert.ok(all.some((z) => z.id === 'UTC'));
    const [suggested, rest] = zoneSections(all, '', ['Europe/Belgrade', 'Europe/Belgrade', 'UTC', 'Not/AZone']);
    assert.equal(suggested!.label, 'Suggested');
    assert.deepEqual(suggested!.zones.map((z) => z.id), ['Europe/Belgrade', 'UTC']);
    assert.equal(rest!.label, 'All time zones');
    assert.ok(!rest!.zones.some((z) => z.id === 'Europe/Belgrade'));
    const found = zoneSections(all, 'belgr', ['UTC']);
    assert.deepEqual(found.map((s) => [s.label, s.zones.map((z) => z.id)]), [['Other matches', ['Europe/Belgrade']]]);
  });
});
