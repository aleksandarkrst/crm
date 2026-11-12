// Unit tests of Time off's tabs (CD-503): a manager without the admin role sees Approvals once their own
// access is read, with the People directory never loaded. `npm test` in frontend.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ApiPeopleAccess } from '../src/lib/api.ts';
import type { PeopleState } from '../src/store/people.ts';
import { timeOffAccess, timeOffTab, withCallerAccess } from '../src/store/timeOffTabs.ts';

const emptyPeople = (): PeopleState => ({ employees: [], levels: [], units: [], access: null, loaded: false, loading: false, error: null });
const managerAccess: ApiPeopleAccess = { employeeId: 'e-1', roles: ['employee', 'manager'], directReportIds: ['e-2'], reportIds: ['e-2'] };
const employeeAccess: ApiPeopleAccess = { employeeId: 'e-3', roles: ['employee'], directReportIds: [], reportIds: [] };

describe('Time off tabs', () => {
  it('stores the caller access without marking the directory read', () => {
    const people = withCallerAccess(emptyPeople(), managerAccess);
    assert.deepEqual(people.access?.roles, ['employee', 'manager']);
    assert.equal(people.loaded, false);
    assert.deepEqual(people.employees, []);
  });

  it('shows Approvals to a manager without the admin role, from the caller access alone', () => {
    const people = withCallerAccess(emptyPeople(), managerAccess);
    const viewer = { admin: false, access: people.access, country: 'RS' };
    assert.deepEqual(timeOffAccess(viewer), { approvals: true, decisions: false });
    assert.equal(timeOffTab('approvals', viewer), 'approvals');
    assert.equal(timeOffTab('requests', viewer), 'approvals');
    assert.equal(timeOffTab('balances', viewer), 'balances');
    assert.equal(timeOffTab('decisions', viewer), 'my');
  });

  it('opens My time off for Approvals until the access is read, and for an employee', () => {
    assert.equal(timeOffTab('approvals', { admin: false, access: null, country: null }), 'my');
    assert.equal(timeOffTab('approvals', { admin: false, access: employeeAccess, country: null }), 'my');
    assert.equal(timeOffTab('timeline', { admin: false, access: employeeAccess, country: null }), 'timeline');
  });

  it('shows Approvals to Admins and Decisions only in Serbia', () => {
    assert.deepEqual(timeOffAccess({ admin: true, access: null, country: 'RS' }), { approvals: true, decisions: true });
    assert.equal(timeOffTab('decisions', { admin: true, access: null, country: 'DE' }), 'my');
  });
});
