// Profile settings (CD-525): what a phone and a name may be, and which notification switches a
// module that is off disables.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NOTIFICATION_MODULE, nameProblem, notificationOff, phoneProblem } from '../src/lib/account.ts';

describe('phoneProblem', () => {
  it('takes digits, spaces, parentheses and a leading +', () => {
    for (const ok of ['+381 60 123 456', '060123456', '(011) 123 4567', '+1 (555) 010 0199', '  +381 60  ']) assert.equal(phoneProblem(ok), '', ok);
  });
  it('takes an empty phone (clears it)', () => {
    assert.equal(phoneProblem(''), '');
    assert.equal(phoneProblem('   '), '');
  });
  it('refuses dashes, letters, a + that is not first, and no digit at all', () => {
    for (const bad of ['060-123-456', '+381 60 abc', '381+60', '++381 60', '+', '()', '060.123.456', '060/123']) assert.equal(phoneProblem(bad), 'Use digits and spaces, with a + for the country code.', bad);
  });
});

describe('nameProblem', () => {
  it('refuses an empty or blank name', () => {
    assert.equal(nameProblem(''), 'Enter your name.');
    assert.equal(nameProblem('   '), 'Enter your name.');
    assert.equal(nameProblem('Olga'), '');
  });
});

describe('notificationOff', () => {
  const all = ['crm', 'projects', 'employees', 'timesheet', 'timeoff'];
  it('keeps every switch on while every module is on', () => {
    for (const id of Object.keys(NOTIFICATION_MODULE)) assert.equal(notificationOff(id, all), false, id);
  });
  it('disables the switches of a module that is off, and only those', () => {
    const noCrm = all.filter((m) => m !== 'crm');
    const off = Object.keys(NOTIFICATION_MODULE).filter((id) => notificationOff(id, noCrm));
    assert.deepEqual(off.sort(), ['assigned', 'meetings', 'proposal-approvals', 'visit-plans']);
    const noTimeOff = all.filter((m) => m !== 'timeoff');
    assert.deepEqual(Object.keys(NOTIFICATION_MODULE).filter((id) => notificationOff(id, noTimeOff)).sort(), ['sick-leave', 'timeoff-approvals', 'timeoff-balance']);
    assert.deepEqual(Object.keys(NOTIFICATION_MODULE).filter((id) => notificationOff(id, ['crm', 'timeoff'])).sort(), ['hour-limits', 'org-changes', 'task-assignments']);
  });
  it('never disables the daily digest', () => {
    assert.equal(notificationOff('digest', []), false);
  });
});
