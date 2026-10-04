import { describe, expect, it } from 'vitest';
import { canManageMeeting, isNotClosed, meetingChangeError } from '../src/modules/crm/meetings/meeting-rules';
import { formatTimeRange, zonedParts } from '../src/shared/time/zoned-time';

const now = new Date('2026-10-05T12:00:00Z');
const past = new Date('2026-10-05T09:00:00Z');
const future = new Date('2026-10-05T15:00:00Z');

describe('meeting status rules (spec 4.3)', () => {
  it('marks a planned meeting as held once it has started, never before', () => {
    expect(meetingChangeError('held', { status: 'planned', startsAt: past }, now)).toBeNull();
    expect(meetingChangeError('held', { status: 'planned', startsAt: now }, now)).toBeNull();
    expect(meetingChangeError('held', { status: 'planned', startsAt: future }, now)).toBe("A meeting can't be marked as held before it starts.");
  });

  it('marks as held only planned meetings', () => {
    expect(meetingChangeError('held', { status: 'held', startsAt: past }, now)).toMatch(/already marked as held/);
    expect(meetingChangeError('held', { status: 'cancelled', startsAt: past }, now)).toMatch(/Restore it first/);
  });

  it('cancels planned meetings any time, but not held or cancelled ones', () => {
    expect(meetingChangeError('cancel', { status: 'planned', startsAt: future }, now)).toBeNull();
    expect(meetingChangeError('cancel', { status: 'planned', startsAt: past }, now)).toBeNull();
    expect(meetingChangeError('cancel', { status: 'held', startsAt: past }, now)).toMatch(/Undo held first/);
    expect(meetingChangeError('cancel', { status: 'cancelled', startsAt: past }, now)).toMatch(/already cancelled/);
  });

  it('undoes held only on held meetings and restores only cancelled ones', () => {
    expect(meetingChangeError('undo-held', { status: 'held', startsAt: past }, now)).toBeNull();
    expect(meetingChangeError('undo-held', { status: 'planned', startsAt: past }, now)).not.toBeNull();
    expect(meetingChangeError('restore', { status: 'cancelled', startsAt: past }, now)).toBeNull();
    expect(meetingChangeError('restore', { status: 'held', startsAt: past }, now)).not.toBeNull();
  });

  it('keeps a cancelled meeting read-only; a held one can still be corrected', () => {
    expect(meetingChangeError('edit', { status: 'cancelled', startsAt: past }, now)).toMatch(/Restore it before changing it/);
    expect(meetingChangeError('edit', { status: 'held', startsAt: past }, now)).toBeNull();
    expect(meetingChangeError('edit', { status: 'planned', startsAt: future }, now)).toBeNull();
  });

  it('calls a planned meeting "Not closed" more than 24 hours after its end', () => {
    const ended = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
    expect(isNotClosed({ status: 'planned', endsAt: ended(25) }, now)).toBe(true);
    expect(isNotClosed({ status: 'planned', endsAt: ended(24) }, now)).toBe(false);
    expect(isNotClosed({ status: 'planned', endsAt: ended(1) }, now)).toBe(false);
    expect(isNotClosed({ status: 'held', endsAt: ended(48) }, now)).toBe(false);
    expect(isNotClosed({ status: 'cancelled', endsAt: ended(48) }, now)).toBe(false);
  });
});

describe('who may change a meeting (spec 10.1)', () => {
  const meeting = { organizerUserId: 'org', internalUserIds: ['org', 'ana'] };
  it('lets owners and admins change any meeting', () => {
    expect(canManageMeeting({ role: 'owner', userId: 'x' }, meeting)).toBe(true);
    expect(canManageMeeting({ role: 'admin', userId: 'x' }, meeting)).toBe(true);
  });

  it('lets members change only meetings they organize or take part in', () => {
    expect(canManageMeeting({ role: 'member', userId: 'org' }, meeting)).toBe(true);
    expect(canManageMeeting({ role: 'member', userId: 'ana' }, meeting)).toBe(true);
    expect(canManageMeeting({ role: 'member', userId: 'bo' }, meeting)).toBe(false);
  });

  it('leaves a meeting whose organizer left to its participants and admins', () => {
    const orphan = { organizerUserId: null, internalUserIds: ['ana'] };
    expect(canManageMeeting({ role: 'member', userId: 'ana' }, orphan)).toBe(true);
    expect(canManageMeeting({ role: 'member', userId: 'bo' }, orphan)).toBe(false);
  });
});

describe('meeting times in the workspace time zone', () => {
  it('formats a meeting on one day', () => {
    expect(formatTimeRange(new Date('2026-10-06T08:00:00Z'), new Date('2026-10-06T09:00:00Z'), 'Europe/Belgrade')).toBe('Tue 6 Oct 2026, 10:00–11:00');
    expect(formatTimeRange(new Date('2026-10-06T08:00:00Z'), new Date('2026-10-06T09:30:00Z'), 'America/New_York')).toBe('Tue 6 Oct 2026, 04:00–05:30');
  });

  it('names both days when a meeting crosses midnight', () => {
    expect(formatTimeRange(new Date('2026-10-23T21:00:00Z'), new Date('2026-10-23T23:00:00Z'), 'Europe/Belgrade')).toBe('Fri 23 Oct 2026, 23:00 – Sat 24 Oct, 01:00');
    expect(formatTimeRange(new Date('2026-12-31T22:30:00Z'), new Date('2026-12-31T23:30:00Z'), 'Europe/Belgrade')).toBe('Thu 31 Dec 2026, 23:30 – Fri 1 Jan 2027, 00:30');
  });

  it('follows the daylight saving change (Europe/Belgrade, 25 October 2026)', () => {
    // Clocks go back from 03:00 CEST to 02:00 CET: 00:30Z is 02:30 CEST, 02:30Z is 03:30 CET.
    expect(formatTimeRange(new Date('2026-10-25T00:30:00Z'), new Date('2026-10-25T02:30:00Z'), 'Europe/Belgrade')).toBe('Sun 25 Oct 2026, 02:30–03:30');
    // The same wall-clock hour on either side of the change is a different instant.
    expect(zonedParts(new Date('2026-10-24T08:00:00Z'), 'Europe/Belgrade').time).toBe('10:00');
    expect(zonedParts(new Date('2026-10-26T09:00:00Z'), 'Europe/Belgrade').time).toBe('10:00');
    // Spring forward (29 March 2026): 01:30Z is 03:30 CEST.
    expect(zonedParts(new Date('2026-03-29T01:30:00Z'), 'Europe/Belgrade')).toMatchObject({ date: '2026-03-29', time: '03:30' });
  });

  it('reads the date of an instant on the zone clock, and treats an unknown zone as UTC', () => {
    expect(zonedParts(new Date('2026-10-05T22:30:00Z'), 'Europe/Belgrade')).toMatchObject({ date: '2026-10-06', time: '00:30', weekday: 'Tue' });
    expect(zonedParts(new Date('2026-10-05T22:30:00Z'), 'Not/AZone')).toMatchObject({ date: '2026-10-05', time: '22:30' });
  });
});
